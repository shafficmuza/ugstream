import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'config.dart';

/// App branding fetched from the backend's admin-editable settings
/// (GET /settings — appName, logoUrl, tagline). The admin can rename the
/// app any time in the dashboard; the mobile app picks it up on next launch
/// rather than baking the name into the binary. AppConfig.appName is only
/// the offline/loading fallback.
class Branding extends ChangeNotifier {
  Branding(this._api) {
    _load();
  }

  final ApiClient _api;

  String _appName = AppConfig.appName;
  String? _logoUrl;
  String? _tagline;

  String get appName => _appName;
  String? get logoUrl => _logoUrl;
  String? get tagline => _tagline;

  Future<void> _load() async {
    try {
      final res = await _api.request('/settings', auth: false);
      final d = res.data;
      if (d is Map) {
        _appName = (d['appName'] as String?)?.trim().isNotEmpty == true ? d['appName'] : _appName;
        _logoUrl = AppConfig.absUrl(d['logoUrl']);
        _tagline = d['tagline'];
        notifyListeners();
      }
    } catch (_) {
      // Offline/first-run — keep the fallback name; retry on next refresh().
    }
  }

  Future<void> refresh() => _load();
}
