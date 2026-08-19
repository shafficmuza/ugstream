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

# Which backend this binary will talk to for the rest of its life. A release
# APK cannot be repointed after it ships, so this is the single most expensive
# line in the file to get wrong.
#
# muzawatch.com is production. ham.sentepos.com is the old name, still serving
# the same upstreams only until no installed app hard-codes it — see
# scripts/enable-muzawatch-ssl.sh. New builds must not add to that debt.
API_BASE="${API_BASE:-https://muzawatch.com/api/v1}"
PROD_HOST=muzawatch.com

# Guard 1: building the *published* APK against anything but production has to
# be deliberate. A dev build is fine; a dev build that silently lands on the
# download link the whole country installs from is not.
HOST=$(printf '%s' "$API_BASE" | awk -F/ '{print $3}')
if [ "$HOST" != "$PROD_HOST" ] && [ "${ALLOW_NONPROD:-0}" != "1" ]; then
    echo "refusing: API_BASE points at '$HOST', not $PROD_HOST." >&2
    echo "for a deliberate non-production build: ALLOW_NONPROD=1 $0" >&2
    exit 1
fi

# Guard 2: the endpoint has to actually be alive and answering like our API
# before we spend 18 minutes compiling against it. Catches a dead host, a
# stale DNS record, and a proxy that 200s with someone else's page.
echo "preflight: $API_BASE/settings"
PRE=$(curl -fsS -m 20 "$API_BASE/settings" 2>/dev/null || true)
if ! printf '%s' "$PRE" | grep -q '"appName"'; then
    echo "refusing: $API_BASE/settings did not answer like the Muza Watch API." >&2
    exit 1
fi

# Guard 3: refuse to ship against a backend still leaking the dev sign-in
# bypass on its public settings endpoint. That was live until 2026-08-19; an
# APK built against a host that still leaks it is being pointed at an
# unpatched server, which is worth failing the build over.
if printf '%s' "$PRE" | grep -q 'devBypass'; then
    echo "refusing: $HOST still publishes devBypass* on /settings — it is unpatched." >&2
    exit 1
fi
echo "preflight OK — $HOST is live and patched"

cd "$APP"
flutter pub get

# Regenerate launcher icons from brand sources. android/ is recreated by the
# build, so icons written into it by hand are lost and the app ships with the
# default Flutter logo — generating here makes that impossible to forget.
dart run flutter_launcher_icons

flutter test
flutter build apk --release --dart-define=API_BASE="$API_BASE"

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
echo "published $(du -h "$OUT" | cut -f1) -> https://$PROD_HOST/api/uploads/ham-watch.apk"
echo "this APK talks to: $API_BASE"
