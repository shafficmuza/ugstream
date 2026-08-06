import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
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

  /// Native side of APNs registration (see AppDelegate).
  static const _native = MethodChannel('muza/push');

  bool _ready = false;
  String? _token;
  /// Last permission outcome, kept so later failures can report it — a denied
  /// prompt and a broken registration look identical without it.
  String _perm = 'unknown';

  /// Set when the native registration call itself failed (e.g. the method
  /// channel is not wired up), as opposed to Apple declining to issue a token.
  String? _nativeError;

  /// Human-readable state, shown in Profile. A TestFlight/Play build cannot be
  /// attached to a debugger, so without this a device that silently fails to
  /// register is undiagnosable from the outside — the server just sees nothing.
  ///
  /// Exposed as a ValueNotifier because setup is asynchronous and can take
  /// tens of seconds: a plain field is read once when the screen builds, so
  /// the row would sit on whatever value happened to be current then and look
  /// stuck even while setup was progressing.
  final ValueNotifier<String> statusNotifier = ValueNotifier<String>('Not started');

  String get status => statusNotifier.value;
  set status(String v) => statusNotifier.value = v;

  bool get hasToken => _token != null;

  /// Set by the app so a tapped notification can navigate. Receives the
  /// `path` the backend put in the data payload, e.g. "/title/some-slug".
  void Function(String path)? onOpenPath;

  /// Path captured from a notification that launched the app before the
  /// navigator existed. Consumed once the UI is ready.
  String? pendingPath;

  Future<void> init() async {
    if (_ready) return;
    status = 'Starting…';
    try {
      await Firebase.initializeApp().timeout(const Duration(seconds: 20));
    } catch (e) {
      status = 'Firebase init failed/timed out: $e';
      debugPrint('Push: Firebase not configured, notifications disabled ($e)');
      return;
    }

    status = 'Firebase ready — asking permission…';

    try {
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

      // Android 13+ requires runtime permission; iOS always prompts. Every
      // await here is time-bounded: a step that never returns previously left
      // setup wedged with no token and no explanation, which is exactly how
      // this stalled at "Starting…" on iOS. A timeout degrades to "no
      // notifications" and still reports where it stopped.
      final settings = await FirebaseMessaging.instance
          .requestPermission()
          .timeout(const Duration(seconds: 30));
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        status = 'Blocked — allow notifications in phone Settings';
      }

      _perm = settings.authorizationStatus.name;
      status = 'Permission $_perm — setting up…';

      // Ask iOS for an APNs token now: Firebase is configured (so the token
      // callback will be captured) and permission has been answered.
      if (Platform.isIOS) {
        try {
          await _native
              .invokeMethod<bool>('registerForRemoteNotifications')
              .timeout(const Duration(seconds: 10));
        } catch (e) {
          // Recorded rather than only logged: if the channel is missing, every
          // later symptom is "no token", and without this the real cause —
          // that registration was never even requested — stays invisible on a
          // TestFlight build.
          _nativeError = '$e';
          debugPrint('Push: native APNs registration call failed ($e)');
        }
      }

      // Requesting permissions again here would raise a second iOS dialog and
      // can hang; firebase_messaging has already asked above.
      await _local
          .initialize(
            const InitializationSettings(
              android: AndroidInitializationSettings('@mipmap/ic_launcher'),
              iOS: DarwinInitializationSettings(
                requestAlertPermission: false,
                requestBadgePermission: false,
                requestSoundPermission: false,
              ),
            ),
            onDidReceiveNotificationResponse: (resp) {
              final path = resp.payload;
              if (path != null && path.isNotEmpty) _open(path);
            },
          )
          .timeout(const Duration(seconds: 20));

      // Android needs the channel to exist before a high-importance
      // notification will actually make a sound or appear as a heads-up.
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);

      // FCM does not display anything while the app is foregrounded on
      // Android, so draw it locally. iOS is told to present it natively.
      FirebaseMessaging.onMessage.listen(_showForeground);
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true)
          .timeout(const Duration(seconds: 15));

      // App resumed from background by tapping a notification.
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(_pathOf(m)));

      // App launched cold from a notification: the navigator does not exist
      // yet, so stash it and let the UI pick it up.
      final initial = await FirebaseMessaging.instance
          .getInitialMessage()
          .timeout(const Duration(seconds: 15), onTimeout: () => null);
      if (initial != null) pendingPath = _pathOf(initial);

      _ready = true;
      await _syncToken();

      // Tokens rotate; re-register so the device keeps receiving pushes.
      FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        _register(t);
      });
    } catch (e) {
      // Setup stalled, but a token may still be obtainable — the pieces that
      // matter for receiving a notification are independent of the ones that
      // merely configure presentation, so try rather than give up here.
      status = 'Setup issue ($e) — retrying token…';
      debugPrint('Push: setup failed ($e)');
      _ready = true;
      await _syncToken();
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

    // On iOS, FCM cannot mint a token until APNs has handed one to the app,
    // which happens asynchronously after registerForRemoteNotifications and
    // is often not ready at launch. Waiting for it is what stops the device
    // silently never registering — getToken would otherwise throw once and
    // leave the handset unreachable for the whole session.
    if (Platform.isIOS) {
      status = 'Waiting for Apple push token…';
      var apns = false;
      for (var attempt = 0; attempt < 10; attempt++) {
        try {
          if (await FirebaseMessaging.instance.getAPNSToken() != null) {
            apns = true;
            break;
          }
        } catch (_) {
          // keep waiting; a throw here is just "not ready yet"
        }
        await Future.delayed(const Duration(seconds: 2));
      }
      if (!apns) {
        // Apple reports a refusal only via didFailToRegisterForRemoteNotifications,
        // which the app delegate now records; without it "declined" and "still
        // waiting" are the same observation and the cause is unknowable.
        Map<Object?, Object?>? diag;
        try {
          diag = await _native
              .invokeMethod<Map<Object?, Object?>>('diagnostics')
              .timeout(const Duration(seconds: 5));
        } catch (e) {
          debugPrint('Push: diagnostics unavailable ($e)');
        }
        final appleError = (diag?['error'] as String?) ?? '';
        final registered = diag?['registered'] == true;

        if (appleError.isNotEmpty) {
          status = 'Apple refused push registration: $appleError';
        } else if (_nativeError != null) {
          status = 'Never asked Apple — channel error: $_nativeError';
        } else if (!registered) {
          status = 'Registration requested but iOS never confirmed it '
              '(permission: $_perm) — check network/APNs reachability';
        } else {
          status = 'Registered with Apple but no token yet (permission: $_perm)';
        }
        debugPrint('Push: APNs token never arrived — $status');
        // Nothing below can succeed without it, and getToken() would only
        // throw and bury this far more informative message.
        return;
      }
    }

    try {
      _token = await FirebaseMessaging.instance.getToken();
      if (_token != null) {
        await _register(_token!);
      } else {
        status = 'Firebase returned no token';
      }
    } catch (e) {
      // Not fatal: onTokenRefresh still fires when FCM eventually issues one.
      status = 'Token error (permission: $_perm): $e';
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
      status = 'Active — this device is registered';
    } catch (e) {
      status = 'Registered with Firebase but server rejected it: $e';
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
