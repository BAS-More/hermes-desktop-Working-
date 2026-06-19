# Building the Hermes Desktop Mac (.dmg) build

**This cannot be built on Windows.** Apple's `codesign`, DMG creation, and
notarization toolchain are macOS-only. The Windows host produced the `.exe`
installers; the `.dmg` must be built on a Mac (your own Mac, a colleague's, or
a macOS CI runner such as GitHub Actions `macos-latest`).

Everything else (code, version, electron-builder config) is already in the repo
and identical to the Windows build — you only need to run the Mac target.

## On a Mac (one-time setup)

```bash
# 1. clone the repo (same branch you released from)
git clone https://github.com/BAS-More/hermes-desktop-Working-.git
cd hermes-desktop-Working-
git checkout main          # or the release tag, e.g. v0.6.6

# 2. install deps
npm install

# 3. build the unsigned DMG (works with NO Apple account)
npm run build:mac
```

Output lands in `dist/`:
- `hermes-desktop-0.6.6-arm64.dmg`  (Apple Silicon — M1/M2/M3/M4)
- `hermes-desktop-0.6.6-x64.dmg`    (Intel Macs)
- matching `.blockmap` + `latest-mac.yml` (for auto-update)

## Unsigned vs signed

`electron-builder.yml` has `mac.notarize: true` and `hardenedRuntime: true`.
Notarization REQUIRES an Apple Developer ID ($99/yr). Until you have one:

**Option A — build unsigned now (for yourself + technical colleagues):**
Temporarily disable notarization so the build doesn't fail looking for credentials:

```bash
# unsigned one-off build (does not modify the committed yml)
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac -- -c.mac.notarize=false -c.mac.identity=null
```

Colleagues open it with: **right-click the app → Open → Open** (bypasses
Gatekeeper's "unidentified developer" the first time only).

**Option B — signed + notarized (before non-technical colleagues):**
1. Enroll in Apple Developer Program ($99/yr), create a "Developer ID Application" cert.
2. Export it as `.p12`, then set env vars before building:
   ```bash
   export CSC_LINK=/path/to/DeveloperID.p12
   export CSC_KEY_PASSWORD='your-p12-password'
   export APPLE_ID='you@apple.com'
   export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'   # appleid.apple.com
   export APPLE_TEAM_ID='YOURTEAMID'
   npm run build:mac
   ```
   The committed `notarize: true` then produces a Gatekeeper-clean DMG — no
   right-click-Open needed.

## Publishing the Mac artifacts to the same GitHub Release

After the Windows release exists (tag `v0.6.6`), from the Mac:

```bash
gh release upload v0.6.6 \
  dist/hermes-desktop-0.6.6-arm64.dmg \
  dist/hermes-desktop-0.6.6-x64.dmg \
  dist/latest-mac.yml
```

Now the single `v0.6.6` release carries Windows .exe + Mac .dmg, and
electron-updater serves the right one to each platform.
