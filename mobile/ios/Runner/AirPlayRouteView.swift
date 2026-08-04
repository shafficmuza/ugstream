import Flutter
import UIKit
import AVKit

/// Native AirPlay route picker exposed to Flutter as a platform view.
///
/// iOS only offers AirPlay device selection through Apple's own
/// `AVRoutePickerView` — it cannot be drawn in Flutter. The player embeds this
/// via `UiKitView(viewType: "airplay_button")`. AVPlayer (which video_player
/// uses) then routes to the chosen device automatically, since external
/// playback is enabled by default.
class AirPlayRouteView: NSObject, FlutterPlatformView {
  private let routePicker: AVRoutePickerView

  init(frame: CGRect) {
    routePicker = AVRoutePickerView(frame: frame)
    routePicker.backgroundColor = .clear
    routePicker.tintColor = .white
    // Highlight the icon when a route is active, so users can see they are
    // casting without opening the picker.
    routePicker.activeTintColor = UIColor(red: 0.898, green: 0.035, blue: 0.078, alpha: 1) // #E50914
    super.init()
  }

  func view() -> UIView { routePicker }
}

class AirPlayRouteViewFactory: NSObject, FlutterPlatformViewFactory {
  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
    AirPlayRouteView(frame: frame)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}
