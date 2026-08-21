import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';

/// Keeps the display on while a video is playing.
///
/// Android treats a film as idle time — nothing is being touched, so the
/// screen dims on the normal timeout and the device locks mid-scene.
///
/// iOS was left out on the grounds that AVPlayer disables the idle timer by
/// itself. It does — but only while it is rendering video to *this* screen.
/// Over AirPlay it renders nothing here, so the timer runs, the phone locks
/// mid-film and playback dies. That is why viewers were being told to turn
/// auto-lock off by hand, and why iOS is handled here too now.
///
/// Deliberately tied to *playing*, not to *the player being open*. A film left
/// paused should let the phone sleep like anything else; holding the screen on
/// for a paused video is how an app earns a reputation for draining batteries.
class ScreenAwake {
  static const _channel = MethodChannel('muza/screen');
  static bool _on = false;

  static bool get _supported => !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  /// Whether sound is currently leaving the device over AirPlay.
  ///
  /// The player asks before treating a background transition as a reason to
  /// stop: if the film is on the television, the phone locking is the viewer
  /// pocketing the remote, not a request to end the film. Android has no
  /// equivalent — Chromecast hands the stream to the TV outright, so local
  /// playback is already stopped by then.
  static Future<bool> isExternalPlayback() async {
    if (kIsWeb || !Platform.isIOS) return false;
    try {
      return (await _channel.invokeMethod<bool>('isExternalPlayback')) ?? false;
    } catch (_) {
      // An older build without the native handler: assume local, which keeps
      // the previous stop-on-background behaviour rather than leaving audio
      // playing with the screen off.
      return false;
    }
  }

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
