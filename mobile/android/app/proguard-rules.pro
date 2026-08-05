# R8/ProGuard rules for release builds.
#
# The release pipeline expects this file to exist — the build fails outright
# with "Supplied proguard configuration does not exist" without it, even when
# empty. It is part of the standard Flutter Android template and was missing
# because android/ was assembled by hand rather than generated.
#
# Rules below keep classes that are only reached reflectively or from native
# code, which R8 cannot see and would otherwise strip.

# Flutter engine and embedding.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Firebase Cloud Messaging: the service is instantiated by the framework from
# the manifest, and the message/notification models are populated reflectively.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Google Cast, used by the Chromecast integration.
-keep class com.google.android.gms.cast.** { *; }

# Flutter's embedding references Play Core deferred-component APIs
# (PlayStoreDeferredComponentManager, FlutterPlayStoreSplitApplication). Those
# classes only exist when the Play Core library is on the classpath, and this
# app does not use deferred components, so R8 sees dangling references and
# treats them as fatal. Silence them rather than pulling in a library whose
# features are unused.
-dontwarn com.google.android.play.core.**
-dontwarn io.flutter.embedding.engine.deferredcomponents.**
-dontwarn io.flutter.embedding.android.FlutterPlayStoreSplitApplication

# Keep annotations R8 uses to reason about nullability and keep rules.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
