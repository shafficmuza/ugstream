import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'token_store.dart';
import '../models/models.dart';

/// Authentication state + phone-OTP flow.
class Auth extends ChangeNotifier {
  Auth() {
    _tokens = TokenStore();
    api = ApiClient(_tokens)..onSessionExpired = _onExpired;
    _bootstrap();
  }

  late final TokenStore _tokens;
  late final ApiClient api;

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
