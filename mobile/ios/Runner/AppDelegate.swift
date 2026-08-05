import Flutter
import UIKit
import AVFoundation
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Keep playing when the ringer switch is silent, and permit routing audio
    // to an external AirPlay device.
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)

    // Push. On iOS FCM delivers via APNs, which requires the app to register
    // for remote notifications and to hand the APNs token to the messaging
    // plugin — FlutterAppDelegate forwards the token automatically once we
    // set ourselves as the notification-centre delegate here.
    if #available(iOS 10.0, *) {
      UNUserNotificationCenter.current().delegate = self
    }
    application.registerForRemoteNotifications()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Native AirPlay picker, embedded by the player via UiKitView.
    engineBridge.pluginRegistry
      .registrar(forPlugin: "AirPlayRouteView")?
      .register(AirPlayRouteViewFactory(), withId: "airplay_button")
  }
}
