#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STAGING="$BUILD/staging-$STAMP"
APP="$STAGING/Claude Code Account Center.app"
DEST="$ROOT/dist/Claude Code Account Center.app"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo 'This build requires macOS on Apple Silicon.' >&2
  exit 1
fi
command -v swiftc >/dev/null || { echo 'Install the Apple command-line developer tools.' >&2; exit 1; }
mkdir -p "$BUILD/ModuleCache" "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ROOT/dist"

swiftc -parse-as-library -swift-version 5 -O \
  -target arm64-apple-macosx13.0 \
  -module-cache-path "$BUILD/ModuleCache" \
  -framework SwiftUI -framework AppKit \
  "$ROOT/Sources/macOS/main.swift" \
  -o "$APP/Contents/MacOS/ClaudeCodeAccountCenter"
cp -R "$ROOT/Resources/core" "$APP/Contents/Resources/core"
cp -R "$ROOT/Resources/network" "$APP/Contents/Resources/network"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>ClaudeCodeAccountCenter</string>
  <key>CFBundleIdentifier</key><string>org.community.ClaudeCodeAccountCenter</string>
  <key>CFBundleName</key><string>Claude Code Account Center</string>
  <key>CFBundleDisplayName</key><string>Claude Code Account Center</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Open the official Claude Code CLI in Terminal for the selected local account and project.</string>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$APP/Contents/Info.plist"
# Local ad-hoc signing only; no identity, Keychain, network, or notarization.
/usr/bin/codesign --force --sign - "$APP"
if [[ -e "$DEST" ]]; then
  mkdir -p "$BUILD/backups/$STAMP"
  mv "$DEST" "$BUILD/backups/$STAMP/"
fi
mv "$APP" "$DEST"
/usr/bin/codesign --verify "$DEST"
printf 'Built: %s\n' "$DEST"
