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

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Native AirPlay picker, embedded by the player via UiKitView.
    engineBridge.pluginRegistry
      .registrar(forPlugin: "AirPlayRouteView")?
      .register(AirPlayRouteViewFactory(), withId: "airplay_button")

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
      channel.setMethodCallHandler { call, result in
        switch call.method {
        case "registerForRemoteNotifications":
          DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
          }
          result(true)
        case "isRegistered":
          result(UIApplication.shared.isRegisteredForRemoteNotifications)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
      pushChannel = channel
    }
  }
}
