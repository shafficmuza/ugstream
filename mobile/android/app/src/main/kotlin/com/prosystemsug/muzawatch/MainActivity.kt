package com.prosystemsug.muzawatch

import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    /**
     * Lets the player hold the screen on while a video is actually playing.
     *
     * Android has no idea that watching a film is activity: nothing is being
     * touched, so the display dims on the usual timeout and the device locks
     * mid-scene. iOS avoids this on its own — AVPlayer disables the idle timer
     * during video playback — which is why this exists only here.
     *
     * FLAG_KEEP_SCREEN_ON is the right mechanism rather than a wake lock: it
     * is scoped to this window, needs no permission, and Android drops it
     * automatically if the app is backgrounded or killed, so a crash mid-film
     * can never leave a handset awake until its battery is flat.
     */
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "muza/screen")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "keepAwake" -> {
                        val on = call.argument<Boolean>("on") ?: false
                        // Window flags must be set on the UI thread.
                        runOnUiThread {
                            if (on) {
                                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                            } else {
                                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                            }
                        }
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Leaving the player by any route — Back, Home, a call — releases the
     * screen. Without this, pausing a film and pocketing the phone would keep
     * the display alive on the last frame.
     */
    override fun onPause() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }
}
