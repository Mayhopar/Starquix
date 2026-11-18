#!/bin/zsh
# Signed + notarized macOS release. Run in Terminal.app (asks for a password once):
#   zsh desktop/scripts/notarize.sh <apple-id-email>
# 1. Saves the notarytool profile "starquix-notary" once — needs an app-specific password
#    (account.apple.com → Sign-In and Security → App-Specific Passwords).
# 2. Builds the editor, runtime deps and MCP; packs, signs (Developer ID), notarizes and staples the app.
# 3. Signs, notarizes and staples the dmg; checks Gatekeeper on both.
# Output: desktop/dist/signed/ — never desktop/dist/mac-arm64, which MCP relays may be running. Log: dist/signed/notarize.log
set -e
set -o pipefail
cd "${0:A:h}/.."   # desktop/
PROFILE=starquix-notary
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"Developer ID Application: \(.*\)".*/\1/p' | head -1)
[ -n "$IDENTITY" ] || { echo "No 'Developer ID Application' certificate in the keychain (Xcode → Settings → Accounts → Manage Certificates)."; exit 1; }
TEAM_ID=${${IDENTITY##*\(}%\)}

if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  [ -n "$1" ] || { echo "Usage: zsh desktop/scripts/notarize.sh <apple-id-email>"; exit 1; }
  echo "Saving the notary profile for $1 (team $TEAM_ID)."
  echo "Paste the app-specific password when asked — nothing shows while you type."
  xcrun notarytool store-credentials "$PROFILE" --apple-id "$1" --team-id "$TEAM_ID"
fi

mkdir -p dist/signed
exec > >(tee dist/signed/notarize.log) 2>&1
step() { echo "[$(date +%H:%M:%S)] $*"; }
V=$(node -p "require('./package.json').version")
DMG="dist/signed/Starquix-$V-arm64.dmg"
APP="dist/signed/mac-arm64/Starquix.app"

step "build editor, runtime deps, mcp"
npm run editor && npm run deps && npm run mcp
step "pack + sign + notarize + staple app ($V, $IDENTITY)"
CSC_NAME="$IDENTITY" APPLE_KEYCHAIN_PROFILE="$PROFILE" npx electron-builder --mac --arm64 -c.directories.output=dist/signed
# app/public/fonts + app/public/videos are local-only assets: never in a release
[ -z "$(find "$APP/Contents/Resources/editor/fonts" "$APP/Contents/Resources/editor/videos" -type f 2>/dev/null)" ] ||
  { echo "The bundle carries editor/fonts or editor/videos (local-only assets): never publish it."; exit 1; }
step "sign + notarize + staple dmg"
codesign --sign "Developer ID Application: $IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
step "verify"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
spctl -a -vv -t exec "$APP"
spctl -a -vv -t open --context context:primary-signature "$DMG"
step "ALL DONE"
