import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';

/// Keeps the display on while a video is playing.
///
/// Android treats a film as idle time — nothing is being touched, so the
/// screen dims on the normal timeout and the device locks mid-scene. iOS needs
/// nothing here: AVPlayer disables the idle timer during video playback by
/// itself, and calling into a channel that does not exist there would only
/// throw.
///
/// Deliberately tied to *playing*, not to *the player being open*. A film left
/// paused should let the phone sleep like anything else; holding the screen on
/// for a paused video is how an app earns a reputation for draining batteries.
class ScreenAwake {
  static const _channel = MethodChannel('muza/screen');
  static bool _on = false;

  static bool get _supported => !kIsWeb && Platform.isAndroid;

  static Future<void> set(bool on) async {
    if (!_supported || on == _on) return;
    _on = on;
    try {
      await _channel.invokeMethod('keepAwake', {'on': on});
    } catch (_) {
      // An older build without the native handler must not break playback.
      _on = false;
    }
  }

  /// Belt and braces for teardown: release without the equality check, so a
  /// disposed player always clears the flag even if state got out of step.
  static Future<void> release() async {
    if (!_supported) return;
    _on = false;
    try {
      await _channel.invokeMethod('keepAwake', {'on': false});
    } catch (_) {}
  }
}
