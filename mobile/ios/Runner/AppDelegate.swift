import Flutter
import UIKit
import AVFoundation

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Keep playing when the ringer switch is silent, and permit routing audio
    // to an external AirPlay device.
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)

    // Deliberately NOT calling registerForRemoteNotifications() here.
    //
    // firebase_messaging captures the APNs device token by swizzling the app
    // delegate, and that swizzling is only installed once Firebase has been
    // configured — which happens from Dart, well after this method returns.
    // Registering this early means Apple's didRegisterForRemoteNotifications
    // callback can arrive before anything is listening, so the token is
    // dropped and getAPNSToken() then returns nil forever: the device never
    // gets an FCM token and can never be reached.
    //
    // The plugin calls registerForRemoteNotifications itself once permission
    // is granted, by which point it is ready to receive the token.

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// Held so the channel is not deallocated along with its handler.
  private var pushChannel: FlutterMethodChannel?

  /// What Apple last said about remote-notification registration.
  ///
  /// Registration is asynchronous, and a refusal is reported *only* through
  /// didFailToRegisterForRemoteNotifications. With that callback unimplemented
  /// a rejection was indistinguishable from "not ready yet", so a handset that
  /// never gets a token gave no reason at all. Read back over the channel and
  /// shown in the app, because a TestFlight build cannot be attached to a
  /// debugger and this is the only way the failure becomes visible.
  private var apnsError: String?
  private var apnsTokenBytes = 0

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    apnsTokenBytes = deviceToken.count
    apnsError = nil
    NSLog("MuzaPush: APNs token received (\(deviceToken.count) bytes)")
    // Chaining to super is what keeps firebase_messaging working: this
    // override exists to observe the outcome, never to take it over.
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    apnsError = error.localizedDescription
    NSLog("MuzaPush: APNs registration failed: \(error.localizedDescription)")
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Native AirPlay picker, embedded by the player via UiKitView.
    engineBridge.pluginRegistry
      .registrar(forPlugin: "AirPlayRouteView")?
      .register(AirPlayRouteViewFactory(), withId: "airplay_button")

    // Screen/route control, the iOS half of Dart's ScreenAwake.
    //
    // AVPlayer disables the idle timer by itself ONLY while it is rendering
    // video to this device's screen. During AirPlay it renders nothing here,
    // so the idle timer runs, the phone auto-locks mid-film and playback
    // stops — the reason viewers were told to turn auto-lock off by hand.
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "MuzaScreen") {
      let channel = FlutterMethodChannel(
        name: "muza/screen",
        binaryMessenger: registrar.messenger()
      )
      channel.setMethodCallHandler { call, result in
        switch call.method {
        case "keepAwake":
          let on = ((call.arguments as? [String: Any])?["on"] as? Bool) ?? false
          DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
          }
          result(true)
        case "isExternalPlayback":
          // True when audio is leaving over AirPlay. The player uses this to
          // decide that backgrounding is not a reason to stop: the film is on
          // the television, and the phone is only the remote control.
          let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
          result(outputs.contains { $0.portType == .airPlay })
        default:
          result(FlutterMethodNotImplemented)
        }
      }
    }

    // Explicit APNs registration, driven from Dart.
    //
    // Registering in didFinishLaunching is too early — firebase_messaging has
    // not installed its delegate swizzling yet, so Apple's token callback is
    // dropped. Relying on the plugin to register after requestPermission did
    // not happen here either, leaving nothing registered at all and
    // getAPNSToken() nil forever. Dart calls this once Firebase is configured
    // and permission granted, which is exactly when it is safe.
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "MuzaPush") {
      let channel = FlutterMethodChannel(
        name: "muza/push",
        binaryMessenger: registrar.messenger()
      )
      channel.setMethodCallHandler { [weak self] call, result in
        switch call.method {
        case "registerForRemoteNotifications":
          DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
          }
          result(true)
        case "isRegistered":
          result(UIApplication.shared.isRegisteredForRemoteNotifications)
        case "diagnostics":
          // Everything needed to explain a missing token, in one call.
          result([
            "registered": UIApplication.shared.isRegisteredForRemoteNotifications,
            "tokenBytes": self?.apnsTokenBytes ?? 0,
            "error": self?.apnsError ?? "",
          ])
        default:
          result(FlutterMethodNotImplemented)
        }
      }
      pushChannel = channel
    }
  }
}
