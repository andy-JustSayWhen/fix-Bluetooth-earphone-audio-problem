#!/bin/sh
set -eu

VERSION=${1:-1.0.0}
NODE_VERSION=${NODE_VERSION:-24.21.0}
case "$VERSION" in
  *[!0-9.]*|'') echo "版本号格式无效：$VERSION" >&2; exit 2 ;;
esac

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
BUILD_DIR="$PROJECT_DIR/.build/releases"
DOWNLOAD_DIR="$PROJECT_DIR/.build/downloads"
ARTIFACT_DIR="$PROJECT_DIR/artifacts/releases"
PACKAGE_NAME="蓝牙音频设备模式检查器-macos-universal-v$VERSION"
STAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"
ARCHIVE_PATH="$ARTIFACT_DIR/bluetooth-audio-mode-checker-macos-universal-v$VERSION.zip"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS 正式包必须在 macOS 上构建。" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$DOWNLOAD_DIR" "$ARTIFACT_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/runtime/arm64" "$STAGE_DIR/runtime/x64"

for ARCH in arm64 x64; do
  ARCHIVE="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
  DOWNLOAD_PATH="$DOWNLOAD_DIR/$ARCHIVE"
  EXPANDED_DIR="$BUILD_DIR/node-v$NODE_VERSION-darwin-$ARCH"
  if [ ! -f "$DOWNLOAD_PATH" ]; then
    /usr/bin/curl --fail --location --output "$DOWNLOAD_PATH" "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE"
  fi
  rm -rf "$EXPANDED_DIR"
  /usr/bin/tar -xzf "$DOWNLOAD_PATH" -C "$BUILD_DIR"
  cp "$EXPANDED_DIR/bin/node" "$STAGE_DIR/runtime/$ARCH/node"
done

cp -R "$APP_DIR/app" "$APP_DIR/core" "$APP_DIR/features" "$APP_DIR/shared" "$STAGE_DIR/"
cp "$APP_DIR/package.json" "$STAGE_DIR/package.json"
cp "$APP_DIR/app/macos-release/一键运行.command" "$STAGE_DIR/一键运行.command"
sed "s/{{VERSION}}/v$VERSION/g" "$APP_DIR/app/macos-release/使用说明.txt" > "$STAGE_DIR/使用说明.txt"
cp "$BUILD_DIR/node-v$NODE_VERSION-darwin-arm64/LICENSE" "$STAGE_DIR/runtime/LICENSE-node.txt"
cp "$BUILD_DIR/node-v$NODE_VERSION-darwin-arm64/README.md" "$STAGE_DIR/runtime/README-node.md"

find "$STAGE_DIR" -type f \( -name '*.test.ts' -o -name '*.test.js' \) -delete
rm -rf "$STAGE_DIR/app/macos-release"
rm -f "$STAGE_DIR/app/build-macos-release.sh"
mkdir -p \
  "$STAGE_DIR/.build/audio-probe" \
  "$STAGE_DIR/.build/microphone-usage" \
  "$STAGE_DIR/.build/audio-route" \
  "$STAGE_DIR/.build/audio-events" \
  "$STAGE_DIR/.build/audio-volume" \
  "$STAGE_DIR/.build/bluetooth-control" \
  "$STAGE_DIR/.build/bluetooth-link"

compile_universal() {
  SOURCE=$1
  OUTPUT=$2
  shift 2
  /usr/bin/clang -arch arm64 -arch x86_64 "$@" "$SOURCE" -o "$OUTPUT"
}

compile_universal "$STAGE_DIR/core/macos-audio-probe/read-device-formats.c" "$STAGE_DIR/.build/audio-probe/read-device-formats" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-microphone-usage/read-input-users.c" "$STAGE_DIR/.build/microphone-usage/read-input-users" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-audio-route/set-default-device.c" "$STAGE_DIR/.build/audio-route/set-default-device" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-audio-events/watch-active-output.c" "$STAGE_DIR/.build/audio-events/watch-active-output" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-audio-volume/device-output-volume.c" "$STAGE_DIR/.build/audio-volume/device-output-volume" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-audio-volume/watch-output-volume.c" "$STAGE_DIR/.build/audio-volume/watch-output-volume" -framework CoreAudio -framework CoreFoundation
compile_universal "$STAGE_DIR/core/macos-bluetooth-control/bluetooth-control.m" "$STAGE_DIR/.build/bluetooth-control/bluetooth-control" -fobjc-arc -framework Foundation -framework IOBluetooth
compile_universal "$STAGE_DIR/core/macos-bluetooth-link/reconnect-device.m" "$STAGE_DIR/.build/bluetooth-link/reconnect-device" -fobjc-arc -framework Foundation -framework IOBluetooth
compile_universal "$STAGE_DIR/core/macos-bluetooth-link/connect-device.m" "$STAGE_DIR/.build/bluetooth-link/connect-device" -fobjc-arc -framework Foundation -framework IOBluetooth

chmod +x "$STAGE_DIR/一键运行.command" "$STAGE_DIR/runtime/arm64/node" "$STAGE_DIR/runtime/x64/node"
find "$STAGE_DIR/.build" -type f -exec chmod +x {} \;
find "$STAGE_DIR/.build" -type f -exec touch {} \;
rm -f "$ARCHIVE_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$STAGE_DIR" "$ARCHIVE_PATH"
printf '%s\n' "$ARCHIVE_PATH"

