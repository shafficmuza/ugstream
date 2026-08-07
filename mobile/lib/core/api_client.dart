import 'dart:async';
import 'package:dio/dio.dart';
import 'package:meta/meta.dart';
import 'config.dart';
import 'token_store.dart';

/// Why a refresh attempt ended.
///
/// The distinction matters more than it looks: only [rejected] means the
/// session is genuinely over. Treating every failure as expiry is what made
/// users re-authenticate after pausing a movie — the access token had lapsed,
/// the refresh call hit a sleeping radio, and a perfectly valid 30-day
/// refresh token was discarded.
enum _RefreshOutcome {
  /// New token pair issued and stored.
  renewed,

  /// The server refused the refresh token (401/403). Sign the user out.
  rejected,

  /// Could not get an answer — offline, timeout, 5xx, proxy error. Keep the
  /// credentials and let the caller retry.
  unreachable,
}

/// HTTP client with automatic JWT refresh.
///
/// Access tokens live 15 minutes; on a 401 we transparently exchange the
/// 30-day refresh token for a new pair and retry the request once. Concurrent
/// 401s are deduped to a single refresh. This is what keeps a session alive
/// across long activity (watching a movie) instead of "timing out".
class ApiClient {
  ApiClient(this._tokens) {
    _dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBase,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
      // Don't throw on non-2xx; we inspect status ourselves.
      validateStatus: (_) => true,
    ));
  }

  final TokenStore _tokens;
  late final Dio _dio;

  /// Swap the transport so tests can exercise the refresh branches without a
  /// server. Nothing in the app calls this.
  @visibleForTesting
  set debugAdapter(HttpClientAdapter adapter) => _dio.httpClientAdapter = adapter;
  Future<(String?, _RefreshOutcome)>? _refreshing;

  /// Called when refresh fails (session truly expired) so the app can log out.
  void Function()? onSessionExpired;

  Future<Response> request(
    String path, {
    String method = 'GET',
    Object? data,
    Map<String, dynamic>? query,
    bool auth = true,
  }) async {
    Future<Response> send(String? token) => _dio.request(
          path,
          data: data,
          queryParameters: query,
          options: Options(
            method: method,
            headers: token != null ? {'Authorization': 'Bearer $token'} : null,
          ),
        );

    // A keychain read can fail on a locked handset; that is not a reason to
    // fail the whole request, so fall through unauthenticated and let the
    // refresh path below decide what it means.
    String? token;
    if (auth) {
      try {
        token = await _tokens.accessToken;
      } catch (_) {
        token = null;
      }
    }
    var res = await send(token);

    if (res.statusCode == 401 && auth) {
      final (fresh, outcome) = await _refresh();
      if (fresh != null) {
        res = await send(fresh);
      } else if (outcome == _RefreshOutcome.rejected) {
        // The server actively refused the refresh token: the session really is
        // over, so drop the credentials and send the user to sign in.
        await _tokens.clear();
        onSessionExpired?.call();
      }
      // Unreachable: the tokens are almost certainly still valid, we just
      // could not ask. Falling through raises the original 401 as a normal
      // error the caller can retry — signing the user out here is what made a
      // paused movie, a sleeping radio or a server blip look like a timeout.
    }

    if (res.statusCode != null && res.statusCode! >= 400) {
      throw ApiException(res.statusCode!, _message(res.data), res.data);
    }
    return res;
  }

  Future<(String?, _RefreshOutcome)> _refresh() {
    // Single in-flight refresh — a burst of 401s triggers exactly one call.
    return _refreshing ??= () async {
      try {
        final String? refresh;
        try {
          refresh = await _tokens.refreshToken;
        } catch (_) {
          // A keychain that will not answer is not a session that has ended.
          return (null, _RefreshOutcome.unreachable);
        }
        // No token to present. Only the server may end a session, so this
        // reports "could not ask" rather than "rejected": reading null from a
        // locked keychain used to wipe the credentials of a user who was still
        // perfectly signed in, and the caller still sees the original 401.
        if (refresh == null) return (null, _RefreshOutcome.unreachable);

        // One retry: a handset waking from sleep routinely fails its first
        // request while the radio reassociates, and that must not be mistaken
        // for an invalid token.
        for (var attempt = 0; attempt < 2; attempt++) {
          final Response res;
          try {
            res = await _dio.post('/auth/refresh', data: {'refreshToken': refresh});
          } on DioException {
            if (attempt == 0) {
              await Future.delayed(const Duration(seconds: 2));
              continue;
            }
            return (null, _RefreshOutcome.unreachable);
          }

          if (res.statusCode == 200 && res.data is Map) {
            final a = res.data['accessToken'] as String?;
            final r = res.data['refreshToken'] as String?;
            if (a != null && r != null) {
              await _tokens.save(a, r);
              return (a, _RefreshOutcome.renewed);
            }
            // 200 with an unusable body is a server fault, not a dead session.
            return (null, _RefreshOutcome.unreachable);
          }

          // Only the server saying "this token is no good" ends the session.
          // A 5xx or a proxy error is transient: clearing the tokens there
          // permanently logged people out over a momentary backend blip.
          if (res.statusCode == 401 || res.statusCode == 403) {
            return (null, _RefreshOutcome.rejected);
          }
          if (attempt == 0) {
            await Future.delayed(const Duration(seconds: 2));
            continue;
          }
          return (null, _RefreshOutcome.unreachable);
        }
        return (null, _RefreshOutcome.unreachable);
      } catch (_) {
        // Unexpected fault — assume the session is fine rather than throwing
        // the user out on something we did not anticipate.
        return (null, _RefreshOutcome.unreachable);
      } finally {
        _refreshing = null;
      }
    }();
  }

  String _message(dynamic data) {
    if (data is Map) {
      final m = data['message'];
      if (m is List && m.isNotEmpty) return m.first.toString();
      if (m != null) return m.toString();
      if (data['error'] != null) return data['error'].toString();
    }
    return 'Request failed';
  }
}

class ApiException implements Exception {
  ApiException(this.statusCode, this.message, this.body);
  final int statusCode;
  final String message;
  final dynamic body;
  @override
  String toString() => 'ApiException($statusCode): $message';
}
