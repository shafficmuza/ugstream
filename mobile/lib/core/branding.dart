import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'config.dart';

/// The ways a viewer can reach a human, as the admin has configured them in
/// the dashboard (GET /settings — supportEmail, supportPhone, supportWhatsapp,
/// supportHours).
///
/// Grouped into their own object rather than left as four loose getters on
/// [Branding] so the UI can ask one question — [hasAnyChannel] — instead of
/// null-checking four fields to decide whether it has anything to show. They
/// still ride on the single /settings fetch [Branding] already makes; a
/// separate loader would mean a second request for the same response body.
class SupportContacts {
  const SupportContacts({this.email, this.phone, this.whatsapp, this.hours});

  /// Nothing configured — the value before /settings has been read, and after
  /// it when the admin has filled none of the fields in.
  static const SupportContacts none = SupportContacts();

  final String? email;
  final String? phone;

  /// WhatsApp number in E.164, e.g. "+256775200443".
  final String? whatsapp;

  /// Free text set by the admin, e.g. "Mon–Sat, 9am–8pm EAT".
  final String? hours;

  /// Blank strings come back from the admin form as often as nulls do — an
  /// admin who clears a field leaves "" behind — and an empty string would
  /// otherwise draw a contact row that opens a chat with nobody.
  static String? _clean(dynamic v) {
    if (v == null) return null;
    final s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  factory SupportContacts.fromSettings(Map<dynamic, dynamic> d) => SupportContacts(
        email: _clean(d['supportEmail']),
        phone: _clean(d['supportPhone']),
        whatsapp: _clean(d['supportWhatsapp']),
        hours: _clean(d['supportHours']),
      );

  /// Whether there is any way at all to reach support. [hours] alone is not a
  /// channel — it is a caption on the channels below it.
  bool get hasAnyChannel => email != null || phone != null || whatsapp != null;

  /// The WhatsApp number as wa.me wants it: digits only, no '+', no spaces or
  /// dashes. Null when the admin typed something with no digits in it.
  String? get whatsappDigits {
    final w = whatsapp;
    if (w == null) return null;
    final digits = w.replaceAll(RegExp(r'[^0-9]'), '');
    return digits.isEmpty ? null : digits;
  }
}

/// App branding fetched from the backend's admin-editable settings
/// (GET /settings — appName, logoUrl, tagline, and the support contacts). The
/// admin can rename the app or change the support number any time in the
/// dashboard; the mobile app picks it up on next launch rather than baking
/// either into the binary. AppConfig.appName is only the offline/loading
/// fallback.
class Branding extends ChangeNotifier {
  Branding(this._api) {
    _load();
  }

  final ApiClient _api;

  String _appName = AppConfig.appName;
  String? _logoUrl;
  String? _tagline;
  SupportContacts _support = SupportContacts.none;

  String get appName => _appName;
  String? get logoUrl => _logoUrl;
  String? get tagline => _tagline;
  SupportContacts get support => _support;

  Future<void> _load() async {
    try {
      final res = await _api.request('/settings', auth: false);
      final d = res.data;
      if (d is Map) {
        _appName = (d['appName'] as String?)?.trim().isNotEmpty == true ? d['appName'] : _appName;
        _logoUrl = AppConfig.absUrl(d['logoUrl']);
        _tagline = d['tagline'];
        _support = SupportContacts.fromSettings(d);
        notifyListeners();
      }
    } catch (_) {
      // Offline/first-run — keep the fallback name; retry on next refresh().
    }
  }

  Future<void> refresh() => _load();
}
