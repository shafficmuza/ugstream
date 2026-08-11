#!/bin/bash
# Build the Muza Watch release APK on the server and publish it to the download
# the login page serves. This is the Android release pipeline — the GitHub
# workflow is dispatch-only and kept purely as a clean-room fallback, because
# Actions minutes are better spent on iOS, which can only be built on macOS
# runners billed at 10x.
#
# Invoked on the server as `muza-build-apk`, which symlinks here so the running
# copy and the tracked copy cannot drift.
#
# Requires mobile/android/key.properties and the upload keystore, neither of
# which is in git. They live on the server; credentials are in
# /root/secure/muzawatch-android-signing.txt.
#
# Memory is deliberately constrained in /root/.gradle/gradle.properties: this
# box also runs Postgres and the live site, and the project's own gradle
# settings ask for more heap than the machine has.
set -euo pipefail

export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_SDK_ROOT=/opt/android-sdk
export ANDROID_HOME=/opt/android-sdk
export PATH="$PATH:/opt/flutter/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools"

APP=/root/ugstream/mobile
OUT=/root/ugstream/backend/uploads/ham-watch.apk

cd "$APP"
flutter pub get

# Regenerate launcher icons from brand sources. android/ is recreated by the
# build, so icons written into it by hand are lost and the app ships with the
# default Flutter logo — generating here makes that impossible to forget.
dart run flutter_launcher_icons

flutter test
flutter build apk --release --dart-define=API_BASE=https://ham.sentepos.com/api/v1

BUILT="$APP/build/app/outputs/flutter-apk/app-release.apk"
[ -f "$BUILT" ] || { echo "build produced no APK" >&2; exit 1; }

# Refuse to publish a debug-signed APK. build.gradle.kts falls back to debug
# keys when key.properties or the keystore is missing, which is right for a
# throwaway local build but would silently ship an artifact that Play rejects,
# fails Play Integrity, and — worse — cannot be updated over by a properly
# signed build later without every user uninstalling first.
APKSIGNER=$(find /opt/android-sdk/build-tools -name apksigner | sort -r | head -1)
CERT=$("$APKSIGNER" verify --print-certs "$BUILT" 2>/dev/null | grep -m1 'certificate DN' || true)
echo "signed by: ${CERT:-unknown}"
if [ -z "$CERT" ] || echo "$CERT" | grep -q 'CN=Android Debug'; then
    echo "refusing to publish: APK is debug-signed or unsigned." >&2
    echo "check $APP/android/key.properties and upload-keystore.jks." >&2
    exit 1
fi

# Keep the previous build so a bad release can be rolled back immediately.
[ -f "$OUT" ] && cp -f "$OUT" "$OUT.prev"
cp -f "$BUILT" "$OUT"
chmod 644 "$OUT"
echo "published $(du -h "$OUT" | cut -f1) -> https://ham.sentepos.com/api/uploads/ham-watch.apk"
