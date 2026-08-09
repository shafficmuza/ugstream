#!/bin/bash
# Render every store and in-app asset from the SVG masters in src/.
#
# Run:  bash brand/build.sh      (output lands in brand/out/)
#
# Requires rsvg-convert (librsvg2-bin) and gm (graphicsmagick):
#   apt-get install -y librsvg2-bin graphicsmagick
#
# The two store icons differ in a way that matters and is easy to get wrong:
# Apple REJECTS an icon containing alpha, so its 1024 is flattened onto an
# opaque background here. Both stores want a full-bleed square and apply their
# own rounded mask — baking corners in yourself leaves visible dark corners.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
R() { rsvg-convert -w "$2" -h "$3" "src/$1" -o "out/$4"; }

echo "· store icons"
R icon.svg 512 512 play-store-icon-512.png
R icon.svg 1024 1024 _appstore-rgba.png
# Flatten: no alpha channel at all, as App Store Connect requires.
gm convert out/_appstore-rgba.png -background '#B0060F' -flatten +matte \
  out/app-store-icon-1024.png
rm -f out/_appstore-rgba.png

echo "· android launcher (legacy mipmaps)"
for s in 48 72 96 144 192; do R icon.svg $s $s "android-mipmap-${s}.png"; done

echo "· android adaptive icon (108dp layers, mark inside the 72dp safe zone)"
for s in 108 162 216 324 432; do
  R icon-foreground.svg $s $s "android-adaptive-foreground-${s}.png"
  R icon-background.svg $s $s "android-adaptive-background-${s}.png"
done

echo "· android notification icon (white silhouette, system tints it)"
for s in 24 36 48 72 96; do R notification-icon.svg $s $s "android-notification-${s}.png"; done

echo "· ios app icon"
R icon.svg 1024 1024 _ios-rgba.png
gm convert out/_ios-rgba.png -background '#B0060F' -flatten +matte out/ios-appicon-1024.png
rm -f out/_ios-rgba.png

echo "· play feature graphic (1024x500, no alpha)"
R feature-graphic.svg 1024 500 _feature-rgba.png
gm convert out/_feature-rgba.png -background '#0A0A0A' -flatten +matte \
  out/play-feature-graphic-1024x500.png
rm -f out/_feature-rgba.png

echo "· wordmarks (transparent, for the site header and listings)"
R wordmark-on-dark.svg 980 220 wordmark-on-dark.png
R wordmark-on-light.svg 980 220 wordmark-on-light.png
R wordmark-on-dark.svg 440 99 wordmark-on-dark-small.png

echo "· web favicon"
R icon.svg 32 32 favicon-32.png
R icon.svg 180 180 apple-touch-icon-180.png

echo
echo "done — brand/out/:"
ls -1 out/*.png | sed 's|out/|  |'
