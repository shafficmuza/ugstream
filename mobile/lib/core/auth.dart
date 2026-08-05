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
  User? get user => _user;
  bool get loading => _loading;
  bool get isLoggedIn => _user != null;

  Future<void> _bootstrap() async {
    final token = await _tokens.accessToken;
    if (token == null) {
      _loading = false;
      notifyListeners();
      return;
    }
    await _loadMe();
    _loading = false;
    notifyListeners();
    // Only after a session is known good: /devices is authenticated, so
    // registering earlier would just 401.
    if (_user != null) await push.onSignedIn();
  }

  Future<void> _loadMe() async {
    try {
      final res = await api.request('/me');
      _user = User.fromJson(res.data);
    } catch (_) {
      _user = null;
    }
  }

  /// Step 1 — request an OTP for the phone number.
  Future<void> requestOtp(String phone) async {
    await api.request('/auth/otp/request', method: 'POST', auth: false, data: {'phone': phone});
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

  void _onExpired() {
    _tokens.clear();
    _user = null;
    notifyListeners();
  }
}
