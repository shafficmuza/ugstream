import 'dart:async';
import 'package:dio/dio.dart';
import 'config.dart';
import 'token_store.dart';

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
  Future<String?>? _refreshing;

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

    final token = auth ? await _tokens.accessToken : null;
    var res = await send(token);

    if (res.statusCode == 401 && auth && (await _tokens.refreshToken) != null) {
      final fresh = await _refresh();
      if (fresh != null) {
        res = await send(fresh);
      } else {
        onSessionExpired?.call();
      }
    }

    if (res.statusCode != null && res.statusCode! >= 400) {
      throw ApiException(res.statusCode!, _message(res.data), res.data);
    }
    return res;
  }

  Future<String?> _refresh() {
    // Single in-flight refresh — a burst of 401s triggers exactly one call.
    return _refreshing ??= () async {
      try {
        final refresh = await _tokens.refreshToken;
        if (refresh == null) return null;
        final res = await _dio.post('/auth/refresh', data: {'refreshToken': refresh});
        if (res.statusCode == 200 && res.data is Map) {
          final a = res.data['accessToken'] as String?;
          final r = res.data['refreshToken'] as String?;
          if (a != null && r != null) {
            await _tokens.save(a, r);
            return a;
          }
        }
        await _tokens.clear();
        return null;
      } catch (_) {
        return null;
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
