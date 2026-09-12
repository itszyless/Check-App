<div align="center">
<img src="build/icon.png" width="96" alt="Check app icon" />

# Check
### A small toolbox that lives in your tray.

A Windows desktop utility app built with Electron.

**AI-Assisted Development · Personal Project · Version 1.0.0**
</div>

## About

Check is a lightweight desktop companion for everyday Windows annoyances: a
cluttered temp folder, forgetting what you copied five minutes ago, not
knowing what's silently launching at startup, or needing a screenshot or a
file open *right now* without hunting through folders. It bundles all of that
into one app that sits quietly in the system tray until you need it.

This repository contains the source code, the build pipeline, and the
auto-update setup, so anyone can build it, run it, or contribute to it.

## Features

- **Dashboard** — live CPU, memory, disk and uptime stats at a glance.
- **Clipboard Manager** — keeps your last 50 copied snippets; click to copy again.
- **Temp Cleaner** — scans your temp folder and lets you clear out junk safely.
- **Startup Apps** — see and remove what auto-launches with Windows.
- **Screenshot** — one-click full-screen capture, saved straight to Pictures.
- **Quick Launcher** — a global hotkey (`Ctrl+Shift+Space`) spotlight-style popup for pinned apps and files.
- **Settings** — launch-at-login toggle, manual and automatic update checks.
- **Auto-update** — new versions roll out to everyone automatically through GitHub Releases.

## Technology

| Area | Tools |
| --- | --- |
| App shell | Electron |
| Update delivery | electron-updater, electron-log, GitHub Releases |
| Packaging | electron-builder (NSIS installer + portable build) |
| Interface | Vanilla HTML/CSS/JS, no framework — kept intentionally simple |
| CI/CD | GitHub Actions (Windows runner, builds and publishes on tag push) |

## AI-Assisted Development

This project was built with an AI coding assistant (Claude) doing most of the
implementation: the Electron main/renderer architecture, the IPC security
boundary, the feature logic, the CI/CD release pipeline, and the interface
styling. I directed the scope, decided what the app should actually do,
reviewed the code and the security tradeoffs, and made the call on what
shipped.

This isn't presented as fully hand-written code. Working this way was mostly
about learning how a desktop app is actually structured — how a sandboxed
renderer talks to a privileged main process, why that boundary matters, and
what it takes to ship and auto-update a real Windows app rather than just a
script on my own machine.

### What I learned

- **Electron's security model:** why `contextIsolation` and a narrow
  `preload.js` bridge exist, and what breaks (or becomes exploitable) without
  them.
- **Desktop app packaging:** the difference between running `electron .`
  locally and producing a signed, installable, updatable executable.
- **CI/CD for desktop apps:** using GitHub Actions and a Windows runner to
  build software I can't build on my own machine, triggered by pushing a
  version tag.
- **Auto-update mechanics:** how `electron-updater` checks a release feed,
  verifies the download, and hands off to an installer.
- **Reviewing generated code:** even a working result needs a pass to check
  what data it touches, what permissions it needs, and whether it's doing
  anything it shouldn't.

## Build & run locally

Requires Node.js 20+.

```sh
npm install
npm start
```

## Building a release

Releases are built by GitHub Actions on a Windows runner — not locally — so
the executable is built in a clean, reproducible environment. See the
[workflow file](.github/workflows/release.yml). Push a version tag
(`git tag v1.0.1` then `git push origin v1.0.1`) and a new installer is
published to Releases automatically.

## Current limits

- Unsigned build — Windows SmartScreen will show an "Unknown publisher"
  warning on first run. A paid code-signing certificate would remove this;
  not set up yet.
- Startup-app management and disk stats are Windows-only.
- No settings sync across machines — preferences are stored locally per install.

## License

No license is currently granted for reuse; this repository is shared for
transparency and learning purposes.
