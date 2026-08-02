/// App-wide configuration.
class AppConfig {
  /// Backend API base. Native apps aren't subject to CORS.
  /// Override at build time: --dart-define=API_BASE=https://…/api/v1
  static const String apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://ham.sentepos.com/api/v1',
  );

  static const String appName = 'Ham Watch';
}
