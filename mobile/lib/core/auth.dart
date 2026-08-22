import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'push.dart';
import 'token_store.dart';
import '../models/models.dart';

/// Authentication state + phone-OTP flow.
class Auth extends ChangeNotifier {
  Auth() {
    _tokens = TokenStore();
    api = ApiClient(_tokens)..onSessionExpired = _onExpired;
    push = Push(api);
    _bootstrap();
  }

  late final TokenStore _tokens;
  late final ApiClient api;
  late final Push push;

  User? _user;
  bool _loading = true;

  /// A session is stored but could not be confirmed — the server was
  /// unreachable, not the session refused. The app shows a retry instead of
  /// the sign-in screen, because asking someone to sign in again over a
  /// dropped connection is how a perfectly good session gets thrown away.
  bool _sessionUnavailable = false;
  bool get sessionUnavailable => _sessionUnavailable;

  /// True from a code sign-in by someone with no PIN until they set one or
  /// skip. Deliberately not persisted: the prompt belongs to the sign-in that
  /// raised it, so skipping it does not turn into nagging on every cold start.
  /// Anyone who skips can still set a PIN from their profile.
  bool _promptForPin = false;
  bool get promptForPin => _promptForPin;

  void dismissPinPrompt() {
    _promptForPin = false;
    notifyListeners();
  }
  User? get user => _user;
  bool get loading => _loading;
  bool get isLoggedIn => _user != null;

  Future<void> _bootstrap() async {
    // Keyed off the REFRESH token, not the access token. The access token is
    // deliberately short-lived, so after any real spell of inactivity it is
    // expired — treating that as "signed out" sent returning users to the
    // login screen while a valid 30-day session sat in the keychain. The
    // refresh token is what says a session exists; `api.request` renews the
    // access token underneath.
    if (!await _hasStoredSession()) {
      _loading = false;
      notifyListeners();
      return;
    }
    await _restoreSession();
    _loading = false;
    notifyListeners();
    // Only after a session is known good: /devices is authenticated, so
    // registering earlier would just 401.
    if (_user != null) await push.onSignedIn();
  }

  /// Whether a refresh token is on disk.
  ///
  /// A keychain that will not answer is not an answer, so a throw is retried
  /// rather than believed — but it must NOT be reported as "yes" forever. Doing
  /// that stranded people on the offline screen with no way to sign in, because
  /// every later check threw too and the app never concluded anything. After
  /// the retries it answers with what it can actually read.
  Future<bool> _hasStoredSession() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final refresh = await _tokens.refreshToken;
        return refresh != null;
      } catch (_) {
        await Future.delayed(const Duration(milliseconds: 300));
      }
    }
    return false;
  }

  /// Confirm the stored session, retrying transient failures.
  ///
  /// A handset opened after a spell in a pocket routinely fails its first
  /// request while the radio reassociates, and a backend deploy takes a few
  /// seconds. Either used to land on the sign-in screen with a perfectly good
  /// session still in the keychain — the "it logs me out after a while"
  /// report. Only the server actually refusing the session ends it, and
  /// ApiClient clears the tokens itself when that happens, so their absence
  /// is the signal here.
  Future<void> _restoreSession() async {
    // Bounded by wall clock, not just attempt count. Each attempt can sit on
    // Dio's 20s connect timeout, so three of them plus backoff is over a
    // minute of splash screen — indistinguishable from a frozen app. Whatever
    // happens, something is on screen within ~15s.
    final deadline = DateTime.now().add(const Duration(seconds: 15));
    const delays = [Duration.zero, Duration(milliseconds: 1500), Duration(seconds: 4)];

    for (final delay in delays) {
      if (delay > Duration.zero) {
        if (DateTime.now().isAfter(deadline)) break;
        await Future.delayed(delay);
      }
      try {
        final res = await api.request('/me');
        _user = User.fromJson(res.data);
        _sessionUnavailable = false;
        return;
      } catch (_) {
        // ApiClient clears the tokens itself when the server actually refuses
        // the session, so their absence — not the failure — ends it.
        if (!await _hasStoredSession()) {
          _user = null; // genuinely signed out
          _sessionUnavailable = false;
          return;
        }
      }
      if (DateTime.now().isAfter(deadline)) break;
    }
    _user = null;
    _sessionUnavailable = true; // unreachable, not signed out
  }

  /// Retry a session that could not be confirmed, from the offline screen.
  Future<void> retrySession() async {
    _loading = true;
    _sessionUnavailable = false;
    notifyListeners();
    await _bootstrap();
  }

  /// Abandon an unconfirmable session and go to the sign-in screen.
  ///
  /// The escape hatch the offline screen must always offer: without it, a
  /// device that cannot confirm its session has no route into the app at all.
  /// Local only — it deliberately does not call /auth/logout, since the server
  /// is by definition unreachable when this is used.
  Future<void> signInInstead() async {
    try {
      await _tokens.clear();
    } catch (_) {
      // Nothing more to do; the sign-in below replaces whatever is stored.
    }
    _user = null;
    _sessionUnavailable = false;
    _loading = false;
    notifyListeners();
  }

  Future<void> _loadMe() async {
    try {
      final res = await api.request('/me');
      _user = User.fromJson(res.data);
    } catch (_) {
      // Only drop the user when the session is actually gone. Nulling on any
      // failure signed people out mid-use whenever a refresh happened to land
      // during a dropped connection.
      if (!await _hasStoredSession()) _user = null;
    }
  }

  /// Which sign-in step this number should be shown: 'pin' or 'otp'.
  ///
  /// Asked before anything is sent, so a returning user with a PIN never
  /// triggers — or is charged for — a message.
  Future<String> signInMethod(String phone) async {
    try {
      final res = await api.request('/auth/sign-in-method',
          method: 'POST', auth: false, data: {'phone': phone});
      return res.data['method'] == 'pin' ? 'pin' : 'otp';
    } catch (_) {
      // A hint that fails is not a reason to block the sign-in; fall back to
      // the path that always works.
      return 'otp';
    }
  }

  /// Step 1 — request an OTP for the phone number.
  Future<void> requestOtp(String phone) async {
    await api.request('/auth/otp/request', method: 'POST', auth: false, data: {'phone': phone});
  }

  /// Sign in with the user's PIN. Sends no message, so it costs nothing.
  Future<void> loginWithPin(String phone, String pin) async {
    final res = await api.request('/auth/pin/login', method: 'POST', auth: false, data: {
      'phone': phone,
      'pin': pin,
      'deviceLabel': 'mobile',
    });
    await _tokens.save(res.data['accessToken'], res.data['refreshToken']);
    _user = User.fromJson(res.data['user']);
    notifyListeners();
    await push.onSignedIn();
  }

  /// Set or change the signed-in user's PIN. [currentPin] is required only
  /// when replacing one.
  Future<void> setPin(String pin, {String? currentPin}) async {
    await api.request('/auth/pin', method: 'POST', data: {
      'pin': pin,
      if (currentPin != null && currentPin.isNotEmpty) 'currentPin': currentPin,
    });
    _promptForPin = false;
    await refreshMe();
  }

  /// Remove the PIN, returning this account to SMS codes.
  Future<void> clearPin() async {
    await api.request('/auth/pin', method: 'DELETE');
    await refreshMe();
  }

  /// Step 2 — verify the code, store tokens, load the user.
  Future<void> verifyOtp(String phone, String code) async {
    final res = await api.request('/auth/otp/verify', method: 'POST', auth: false, data: {
      'phone': phone,
      'code': code,
      'deviceLabel': 'mobile',
    });
    await _tokens.save(res.data['accessToken'], res.data['refreshToken']);
    _user = User.fromJson(res.data['user']);
    _promptForPin = _user?.pinSet == false;
    notifyListeners();
    await push.onSignedIn();
  }

  Future<void> updateProfile({required String displayName, String? email, String? address}) async {
    final res = await api.request('/me', method: 'PATCH', data: {
      'displayName': displayName,
      if (email != null && email.isNotEmpty) 'email': email,
      if (address != null && address.isNotEmpty) 'address': address,
    });
    _user = User.fromJson(res.data);
    notifyListeners();
  }

  Future<void> refreshMe() async {
    await _loadMe();
    notifyListeners();
  }

  Future<void> logout() async {
    // Drop the push token first: after the tokens are cleared the DELETE
    // would be unauthenticated, and the handset would keep receiving the
    // signed-out user's notifications.
    await push.onSignedOut();
    try {
      await api.request('/auth/logout', method: 'POST');
    } catch (_) {}
    await _tokens.clear();
    _user = null;
    notifyListeners();
  }

  /// What deleting this account would cost, for the confirmation screen.
  Future<Map<String, dynamic>> deletionSummary() async {
    final res = await api.request('/auth/account/deletion-summary');
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// Delete this account for good, then land back on the sign-in screen.
  ///
  /// Required by App Store guideline 5.1.1(v): deletion has to be reachable
  /// from inside the app, not only by writing to support.
  ///
  /// The push token goes first, exactly as in [logout] — once the tokens are
  /// cleared the request would be unauthenticated, and a handset that keeps
  /// the app installed would go on receiving notifications for an account
  /// that no longer exists.
  Future<void> deleteAccount() async {
    await push.onSignedOut();
    await api.request('/auth/account', method: 'DELETE');
    await _tokens.clear();
    _user = null;
    notifyListeners();
  }

  void _onExpired() {
    _tokens.clear();
    _user = null;
    notifyListeners();
  }
}
