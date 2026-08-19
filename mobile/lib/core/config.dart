/// App-wide configuration.
class AppConfig {
  /// Backend API base. Native apps aren't subject to CORS.
  /// Override at build time: --dart-define=API_BASE=https://…/api/v1
  static const String apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://muzawatch.com/api/v1',
  );

  static const String appName = 'Muza Watch';

  /// Scheme + host of the API, e.g. https://muzawatch.com
  static String get origin {
    final u = Uri.parse(apiBase);
    return '${u.scheme}://${u.authority}';
  }

  /// The API returns image paths as site-relative URLs (e.g.
  /// "/api/uploads/images/x.jpg"). A browser resolves those against the page
  /// origin, but a native app has no origin — so they must be made absolute
  /// or every image silently fails to load.
  static String? absUrl(dynamic path) {
    if (path == null) return null;
    final s = path.toString().trim();
    if (s.isEmpty) return null;
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    return '$origin${s.startsWith('/') ? '' : '/'}$s';
  }
}
