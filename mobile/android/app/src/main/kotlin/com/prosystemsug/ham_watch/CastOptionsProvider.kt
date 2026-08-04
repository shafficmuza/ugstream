package com.prosystemsug.ham_watch

import android.content.Context
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

/**
 * Google Cast configuration. Uses Google's Default Media Receiver, which
 * plays standard HLS/MP4 — exactly what this app serves — so no custom
 * receiver app needs registering.
 */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions =
        CastOptions.Builder()
            .setReceiverApplicationId("CC1AD845")
            .build()

    override fun getAdditionalSessionProviders(context: Context): MutableList<SessionProvider>? = null
}
