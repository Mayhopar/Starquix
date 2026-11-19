# Desktop release

## Build

```sh
cd desktop
npm run dist        # arm64: npm ci + editor build (dev .env's VITE_API_URL ignored) + runtime deps + dist/Starquix-<version>-arm64.{dmg,zip}
npm run dist:x64    # Intel: same, with x64 natives (esbuild, rollup)
```

`npm run dist:x64` replaces `runtime-deps/` with x64 natives; run `npm run deps` before unpacked e2e afterwards.

## Windows + Linux (CI only — natives don't cross-build from a Mac)

`.github/workflows/windows.yml` and `linux.yml` build, unit-test, install and e2e each package on its own runner
(x64 + arm64; the arm64 runners are free only while the repo is public). Run them on the release commit:

```sh
gh workflow run windows.yml --ref <branch>
gh workflow run linux.yml --ref <branch>
gh run download <run-id> --dir dist/ci   # one artifact per OS + arch
```

Outputs: `Starquix-Setup-<V>-{x64,arm64}.exe` (NSIS, per-user, **unsigned** until `docs/plans/2026-11-19-windows-signing-plan.md`
lands), `Starquix-<V>-{x86_64,arm64}.AppImage`, `Starquix-<V>-{amd64,arm64}.deb`. The update notifier
(`src/update-check.mjs`) matches these suffixes — rename an artifact and its row there with it.

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

Releases live in this repo (since v0.0.2; v0.0.1 is in the old [Mayhopar/Starquix-releases](https://github.com/Mayhopar/Starquix-releases),
which v0.0.1 apps still poll for updates). `.github/workflows/release.yml` builds, tests and publishes on a version tag:

```sh
cd desktop && npm version <X.Y.Z> --no-git-tag-version && cd ..   # the tag must equal this version
git commit -am "Starquix <X.Y.Z>" && git push
git tag -a v<X.Y.Z> -m "Starquix <X.Y.Z>" && git push origin refs/tags/v<X.Y.Z>
```

It publishes `Starquix <X.Y.Z>` with the Windows, Linux and (if its secrets are set) macOS installers, `SHA256SUMS`, install
notes and GitHub's generated changelog. A failed build or e2e publishes nothing. A bad release gets a new patch version.

macOS in CI needs these repo secrets (set once, by the account owner):

```sh
base64 -i DeveloperID.p12 | gh secret set MAC_CERT_P12_BASE64   # Keychain Access → "Developer ID Application: …" → Export (.p12)
gh secret set MAC_CERT_PASSWORD                                  # the .p12 export password
gh secret set APPLE_API_KEY_P8 < AuthKey_<KEYID>.p8              # App Store Connect → Users and Access → Integrations → Team Keys (Developer)
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER
```

Without them the release has no dmg: build it locally with `notarize.sh`, then `gh release upload v<X.Y.Z> dist/signed/Starquix-<X.Y.Z>-arm64.dmg`.

## Where things live

- Projects: `~/Starquix/<id>/` (real Astro folders; `node_modules` is a link into the app bundle, re-linked on every open).
- Editor state (IndexedDB): `~/Library/Application Support/Starquix/` — origin `starquix://app`.

## Not in this release

Auto-update, Windows code signing, native production build.
