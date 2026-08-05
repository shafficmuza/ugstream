import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_client.dart';

/// Must match the `channelId` the backend sets on the Android payload.
const _channelId = 'new_titles';

const _channel = AndroidNotificationChannel(
  _channelId,
  'New titles',
  description: 'Alerts when a new movie or series is added.',
  importance: Importance.high,
);

/// Background/terminated handler. Must be a top-level function — Flutter spins
/// up a separate isolate for it, so nothing from the app's state is available.
/// FCM draws the tray notification itself here; this exists only so the
/// isolate has a registered entrypoint and Firebase is initialised in it.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

/// Push notifications.
///
/// Every path is wrapped so the app keeps working when Firebase is not set up
/// (no `google-services.json` / `GoogleService-Info.plist`) — the build is
/// already shipping, and a missing config file must degrade to "no push",
/// never to a crash on launch.
class Push {
  Push(this._api);

  final ApiClient _api;
  final _local = FlutterLocalNotificationsPlugin();

  bool _ready = false;
  String? _token;

  /// Set by the app so a tapped notification can navigate. Receives the
  /// `path` the backend put in the data payload, e.g. "/title/some-slug".
  void Function(String path)? onOpenPath;

  /// Path captured from a notification that launched the app before the
  /// navigator existed. Consumed once the UI is ready.
  String? pendingPath;

  Future<void> init() async {
    if (_ready) return;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('Push: Firebase not configured, notifications disabled ($e)');
      return;
    }

    try {
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

      // Android 13+ requires runtime permission; iOS always prompts. Declining
      // is fine — everything below simply produces no visible notifications.
      await FirebaseMessaging.instance.requestPermission();

      await _local.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: (resp) {
          final path = resp.payload;
          if (path != null && path.isNotEmpty) _open(path);
        },
      );

      // Android needs the channel to exist before a high-importance
      // notification will actually make a sound or appear as a heads-up.
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);

      // FCM does not display anything while the app is foregrounded on
      // Android, so draw it locally. iOS is told to present it natively.
      FirebaseMessaging.onMessage.listen(_showForeground);
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);

      // App resumed from background by tapping a notification.
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(_pathOf(m)));

      // App launched cold from a notification: the navigator does not exist
      // yet, so stash it and let the UI pick it up.
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) pendingPath = _pathOf(initial);

      _ready = true;
      await _syncToken();

      // Tokens rotate; re-register so the device keeps receiving pushes.
      FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        _register(t);
      });
    } catch (e) {
      debugPrint('Push: setup failed, notifications disabled ($e)');
    }
  }

  String _pathOf(RemoteMessage m) => (m.data['path'] as String?) ?? '/';

  void _open(String path) {
    if (onOpenPath != null) {
      onOpenPath!(path);
    } else {
      pendingPath = path;
    }
  }

  Future<void> _showForeground(RemoteMessage m) async {
    final n = m.notification;
    if (n == null) return;
    await _local.show(
      m.hashCode,
      n.title,
      n.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: _pathOf(m),
    );
  }

  Future<void> _syncToken() async {
    if (!_ready) return;
    try {
      // On iOS the APNs token must exist before FCM will issue one; right
      // after launch it may not, and getToken then throws.
      _token = await FirebaseMessaging.instance.getToken();
      if (_token != null) await _register(_token!);
    } catch (e) {
      debugPrint('Push: could not obtain token ($e)');
    }
  }

  /// Registration is authenticated, so this is a no-op until sign-in and is
  /// called again by [onSignedIn].
  Future<void> _register(String token) async {
    try {
      await _api.request(
        '/devices',
        method: 'POST',
        data: {
          'token': token,
          'platform': Platform.isIOS ? 'ios' : 'android',
        },
      );
    } catch (e) {
      debugPrint('Push: token registration failed ($e)');
    }
  }

  /// Bind this device to the user who just signed in.
  Future<void> onSignedIn() async {
    if (!_ready) {
      await init();
      return;
    }
    await _syncToken();
  }

  /// Stop this handset receiving the signed-out user's notifications.
  Future<void> onSignedOut() async {
    final t = _token;
    if (t == null) return;
    try {
      await _api.request('/devices/$t', method: 'DELETE');
    } catch (e) {
      debugPrint('Push: unregister failed ($e)');
    }
  }
}
