# Desktop release (macOS)

## Build

```sh
cd desktop
npm run dist        # arm64: npm ci + editor build (dev .env's VITE_API_URL ignored) + runtime deps + dist/Starquix-<version>-arm64.{dmg,zip}
npm run dist:x64    # Intel: same, with x64 natives (esbuild, rollup)
```

`npm run dist:x64` replaces `runtime-deps/` with x64 natives; run `npm run deps` before unpacked e2e afterwards.

Version: `version` in `desktop/package.json`. Icon: `desktop/build/icon.png` (1024², placeholder).

Never in a release: `app/public/fonts` and `app/public/videos` (local-only assets). The editor resource filter in `desktop/package.json` keeps them out of every build, and `notarize.sh` refuses a bundle that has them.

## Sign + notarize

Without both, Gatekeeper blocks the app on every Mac but the build Mac.

One-time:
- a **Developer ID Application** certificate in the login keychain (Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application);
- an **app-specific password** for that team's Apple ID (account.apple.com → Sign-In and Security → App-Specific Passwords).

Then, in Terminal.app (the first run asks for the app-specific password and saves the notarytool profile `starquix-notary`):

```sh
zsh desktop/scripts/notarize.sh <apple-id-email>
```

It builds the editor, runtime deps and MCP; electron-builder packs, signs, notarizes and staples the app; the script then signs, notarizes and staples the dmg and runs the checks below. Output: `dist/signed/` + `dist/signed/notarize.log` — never `dist/mac-arm64`, which a running app or MCP relay may use.

- `CSC_NAME` = the identity WITHOUT the `Developer ID Application:` prefix (`<Name> (<TEAM>)`) — electron-builder 26 refuses the prefix.
- electron-builder notarizes only when `APPLE_KEYCHAIN_PROFILE`, `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` or `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` is set; otherwise it signs and logs "skipped macOS notarization".
- Apple's first notarization for the team took ~95 min (2026-10-25); the next one (the dmg) took 5.

Each must print `accepted` + `source=Notarized Developer ID` / "The validate action worked!":

```sh
spctl -a -vv -t exec dist/signed/mac-arm64/Starquix.app
spctl -a -vv -t open --context context:primary-signature dist/signed/Starquix-<version>-arm64.dmg
xcrun stapler validate dist/signed/Starquix-<version>-arm64.dmg
```

## Install

Open the dmg and drag Starquix into Applications (Replace). The Dock and Spotlight open `/Applications/Starquix.app` — keep that copy the newest build. Never overwrite a bundle that runs (`pgrep -fl Starquix.app` — MCP relays included): move it aside, then put the new one in place.

## Release gate (all on the built artifact)

```sh
npm test                                                             # unit
SQ_E2E_APP="$PWD/dist/signed/mac-arm64/Starquix.app/Contents/MacOS/Starquix" npx playwright test   # every Electron spec, packaged
npx playwright test                                                  # same specs, unpacked + dev editor
cd ../app && npm run test:run
```

Then by hand on a Mac without Node/npm: open the dmg, drag to Applications, launch, New Project → edit → quit → relaunch → edit persists; Import a folder; Export ZIP lands in Downloads.

## Publish

Public downloads live in [Mayhopar/Starquix-releases](https://github.com/Mayhopar/Starquix-releases); its `main` holds only the README, security policy and issue forms. Releases there are immutable once published: the assets and the tag are locked, only the title and notes stay editable. So one version = one tag = one dmg — everything goes into the draft, and a bad build gets a new patch version, never a replaced file.

After the release gate, on the commit the dmg was built from:

```sh
cd desktop
V=$(node -p "require('./package.json').version")
DMG=dist/signed/Starquix-$V-arm64.dmg
git tag -a "v$V" -m "Starquix $V" && git push origin "refs/tags/v$V"   # source tag in this repo; the notes come from `git log v<previous>..v$V`
gh release create "v$V" --repo Mayhopar/Starquix-releases --draft --title "Starquix $V" --notes-file notes.md "$DMG"
gh release edit "v$V" --repo Mayhopar/Starquix-releases --draft=false   # only after reading the draft page
```

`notes.md` says what changed in user words, then ends with the fixed tail:

```md
## New
- …

## Fixed
- …

**Install:** download `Starquix-<V>-arm64.dmg` below, open it and drag Starquix to Applications. macOS 13 or later, Apple Silicon. Signed and notarized by Apple.

SHA-256: `<shasum -a 256 "$DMG">`

The "Source code" archives are added by GitHub automatically and do not contain the app.
```
## Where things live

- Projects: `~/Starquix/<id>/` (real Astro folders; `node_modules` is a link into the app bundle, re-linked on every open).
- Editor state (IndexedDB): `~/Library/Application Support/Starquix/` — origin `starquix://app`.

## Not in this release

Auto-update, Windows/Linux packages, native production build.
