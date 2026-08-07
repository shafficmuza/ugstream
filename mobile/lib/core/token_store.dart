import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure (Keychain/Keystore) storage for the JWT pair.
class TokenStore {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    // The plugin defaults to `unlocked` (kSecAttrAccessibleWhenUnlocked), which
    // makes the tokens unreadable whenever the handset is locked. A phone locks
    // during a film, and anything that runs while locked — a resume, a push, a
    // background fetch — then reads null and looks exactly like a signed-out
    // app. `first_unlock` keeps them readable once the user has unlocked the
    // device at least once since boot, which is the weakest attribute that
    // survives a locked screen.
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  static const _access = 'access_token';
  static const _refresh = 'refresh_token';

  Future<String?> get accessToken => _storage.read(key: _access);
  Future<String?> get refreshToken => _storage.read(key: _refresh);

  Future<void> save(String access, String refresh) async {
    await _storage.write(key: _access, value: access);
    await _storage.write(key: _refresh, value: refresh);
  }

  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}
