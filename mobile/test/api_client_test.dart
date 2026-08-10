import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ham_watch/core/api_client.dart';
import 'package:ham_watch/core/token_store.dart';

/// Only the server may end a session.
///
/// The reported iPhone bug: the handset locks during a film, the keychain
/// stops answering because the tokens were stored as "accessible when
/// unlocked", the app reads null and concludes the user is signed out. The
/// server session was alive the whole time — the app threw its own credentials
/// away. These pin the rule that a token we cannot *read* is never a session
/// that has *ended*.
class _FakeTokens extends TokenStore {
  _FakeTokens({this.refresh = 'lookup.verifier', this.throws = false});

  final String? refresh;
  final bool throws;
  bool cleared = false;

  @override
  Future<String?> get accessToken async {
    if (throws) throw Exception('keychain locked');
    return 'access';
  }

  @override
  Future<String?> get refreshToken async {
    if (throws) throw Exception('keychain locked');
    return refresh;
  }

  @override
  Future<void> clear() async => cleared = true;

  String? savedAccess;
  @override
  Future<void> save(String access, String refresh) async => savedAccess = access;
}

/// Refresh succeeds and hands back a token pair. Separate from [_Adapter]
/// because that one answers with an empty body, which can only ever exercise
/// the failure branches.
class _RenewingAdapter implements HttpClientAdapter {
  _RenewingAdapter(this.refreshStatus);
  final int refreshStatus;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<List<int>>? stream,
      Future<void>? cancelFuture) async {
    if (options.path.contains('/auth/refresh')) {
      return ResponseBody.fromString(
        '{"accessToken":"fresh-access","refreshToken":"lookup.fresh"}',
        refreshStatus,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
      );
    }
    return ResponseBody.fromString('{}', 401, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType]
    });
  }

  @override
  void close({bool force = false}) {}
}

/// 401 on the ordinary call, so the refresh branch always runs; [refreshStatus]
/// is what the server says about the refresh token itself.
class _Adapter implements HttpClientAdapter {
  _Adapter(this.refreshStatus);
  final int refreshStatus;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<List<int>>? stream,
      Future<void>? cancelFuture) async {
    final status = options.path.contains('/auth/refresh') ? refreshStatus : 401;
    return ResponseBody.fromString('{}', status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType]
    });
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _clientFor(_FakeTokens tokens, int refreshStatus,
    {required void Function() onExpired}) {
  final api = ApiClient(tokens)..onSessionExpired = onExpired;
  api.debugAdapter = _Adapter(refreshStatus);
  return api;
}

void main() {
  test('a locked keychain does not sign the user out', () async {
    final tokens = _FakeTokens(throws: true);
    var expired = false;
    final api = _clientFor(tokens, 401, onExpired: () => expired = true);

    await expectLater(api.request('/me'), throwsA(isA<ApiException>()));
    expect(tokens.cleared, isFalse, reason: 'credentials must survive an unreadable keychain');
    expect(expired, isFalse);
  });

  test('a missing refresh token does not sign the user out', () async {
    final tokens = _FakeTokens(refresh: null);
    var expired = false;
    final api = _clientFor(tokens, 401, onExpired: () => expired = true);

    await expectLater(api.request('/me'), throwsA(isA<ApiException>()));
    expect(tokens.cleared, isFalse);
    expect(expired, isFalse);
  });

  test('a 500 on refresh does not sign the user out', () async {
    final tokens = _FakeTokens();
    var expired = false;
    final api = _clientFor(tokens, 500, onExpired: () => expired = true);

    await expectLater(api.request('/me'), throwsA(isA<ApiException>()));
    expect(tokens.cleared, isFalse);
    expect(expired, isFalse);
  });

  test('the server refusing the refresh token does sign the user out', () async {
    // The one case that legitimately ends a session, kept working.
    final tokens = _FakeTokens();
    var expired = false;
    final api = _clientFor(tokens, 401, onExpired: () => expired = true);

    await expectLater(api.request('/me'), throwsA(isA<ApiException>()));
    expect(tokens.cleared, isTrue);
    expect(expired, isTrue);
  });

  // The bug behind every "the app logged me out" report. NestJS answers a
  // @Post() with 201, so /auth/refresh returns 201 — and the client accepted
  // only 200. Refresh silently never took effect: the renewed pair was thrown
  // away, the session was never extended, and once the 15-minute access token
  // expired the app could not talk to the API at all. Every failure branch had
  // a test; the success path had none, which is why it survived.
  for (final status in [200, 201]) {
    test('a $status refresh renews the session and stores the new tokens', () async {
      final tokens = _FakeTokens();
      var expired = false;
      final api = ApiClient(tokens)..onSessionExpired = () => expired = true;
      api.debugAdapter = _RenewingAdapter(status);

      // The retried call still 401s in this fixture, so the call itself throws;
      // what matters is that the refresh was accepted and persisted.
      await expectLater(api.request('/me'), throwsA(isA<ApiException>()));

      expect(tokens.savedAccess, 'fresh-access',
          reason: 'a $status refresh must be treated as success and stored');
      expect(tokens.cleared, isFalse);
      expect(expired, isFalse);
    });
  }
}
