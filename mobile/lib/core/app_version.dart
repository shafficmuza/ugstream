import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The version of the binary that is actually installed.
///
/// Read from the platform's own package metadata rather than from a constant
/// in the source: a hardcoded string is wrong the moment a build ships without
/// someone remembering to bump it, and the only version worth showing a viewer
/// — or quoting to support — is the one the handset is really running.
class AppVersion {
  AppVersion._();

  /// e.g. "1.5.3 (17)", or null when the platform channel cannot answer (a
  /// plugin that failed to register, a unit test with no bindings). Null is a
  /// normal outcome, not an error: the caller draws nothing rather than
  /// showing a broken or invented version.
  static Future<String?> load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final version = info.version.trim();
      if (version.isEmpty) return null;
      final build = info.buildNumber.trim();
      return build.isEmpty ? version : '$version ($build)';
    } catch (e) {
      debugPrint('AppVersion unavailable: $e');
      return null;
    }
  }
}
