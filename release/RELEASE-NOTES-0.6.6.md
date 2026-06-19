# Hermes One v0.6.6

Desktop release bundling the last cycle of work, cross-platform (Windows + Mac).

## What's new
- **LLM Council** — convene a multi-model council from the composer; new Models tab (PAL engine).
- **Sidebar session menu** — right-click/⋮ on a session to rename, pin, archive, or delete.
- **Claude Code Bridge** — live status pill in Settings; mirrors your Claude Code sessions/settings into Hermes (per-user, local-only).
- **CSP fix** — the desktop app can now reach the local bridge server (127.0.0.1:8770) so the bridge pill shows ONLINE.

## Downloads
| Platform | File | Notes |
|---|---|---|
| Windows | `hermes-desktop-0.6.6-setup.exe` | One-click installer (Start Menu + desktop shortcut) |
| Windows | `hermes-desktop-0.6.6-portable.exe` | No-install portable build |
| macOS (Apple Silicon) | `hermes-desktop-0.6.6-arm64.dmg` | M1/M2/M3/M4 — built on a Mac, see below |
| macOS (Intel) | `hermes-desktop-0.6.6-x64.dmg` | Intel Macs |

Verify your download against `SHA256SUMS.txt` attached to this release.

## First-time open (unsigned build)
These builds are **not yet code-signed**, so your computer will warn you once:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **macOS:** "can't be opened / unidentified developer" → **right-click the app → Open → Open**.

Both are one-time, per machine. Signing (Apple Developer ID + Windows cert) is planned before wider/non-technical distribution — see "Signing roadmap" below.

## The Claude Code Bridge is per-user
The bridge ships with **no credentials**. On first run it generates its own token
in your home folder (`~/.hermes-cc-bridge.token`) and uses *your own* Claude login.
Nothing from anyone else's account travels in this release. Set up your own queue
from `manifest.example.json` → `manifest.json`.

## Signing roadmap (before non-technical colleagues)
- **macOS:** Apple Developer Program ($99/yr) → Developer ID Application cert → `notarize: true` (already set in `electron-builder.yml`) makes Gatekeeper warnings disappear.
- **Windows:** an Authenticode/OV (or EV for instant reputation) code-signing cert removes the SmartScreen "unknown publisher" warning.

Until then, unsigned + the one-time "open anyway" step is fine for yourself and technical colleagues.

## Building the Mac DMG
The `.exe` files were built on Windows. The `.dmg` must be built on a Mac —
see `release/BUILD-MAC.md` in the repo for the exact commands.
