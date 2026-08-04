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
