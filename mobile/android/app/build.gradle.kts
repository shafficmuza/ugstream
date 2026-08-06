import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // Applied explicitly rather than relying on the Flutter Gradle Plugin to
    // pull it in: under Gradle 9 / AGP 9 it is not implicitly present, so the
    // `kotlin { compilerOptions { … } }` block below fails to resolve.
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing credentials. key.properties and the keystore itself are
// gitignored and never committed — CI writes both from repository secrets
// before building. When they are absent (a fresh clone, a contributor without
// the key) the release build falls back to debug signing below rather than
// failing, so `flutter build apk --release` still works for local testing.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}
val hasReleaseKey = keystorePropertiesFile.exists() &&
    rootProject.file(keystoreProperties.getProperty("storeFile") ?: "").exists()

android {
    namespace = "com.prosystemsug.muzawatch"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications 17+, which uses java.time
        // APIs that do not exist on older Android versions. Without this the
        // Android build fails outright.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.prosystemsug.muzawatch"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            // Debug keys are only a fallback for local builds without the
            // keystore. A debug-signed artifact cannot be uploaded to Play and
            // fails Play Integrity, so any build meant for distribution must
            // take the release branch here.
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}

flutter {
    source = "../.."
}

// Firebase/FCM. The Google Services plugin aborts the build outright when
// google-services.json is absent, so it is applied only once the file has
// actually been added. Until then the app builds and runs exactly as before,
// simply without push — which keeps CI green while Firebase is being set up.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
