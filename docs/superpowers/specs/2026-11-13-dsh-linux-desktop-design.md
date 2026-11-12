# DSH Linux Desktop — design

Status: for owner approval. Revised after an independent builder review and the owner's decisions. Working title: **DSH Linux Desktop** (unofficial community fork of DeepSeek Harness).

## Intent and why

DeepSeek Harness Desktop ships upstream for macOS and Windows only; Linux users either run the npm CLI (`dsh web`) or pick up a community fork. The existing forks each cover part of the matrix, and the one the owner tried builds a Fedora package with no in-app update path and window chrome that does not look like the real DSH app.

The owner keeps the app open for days and does not want to check for releases. The product is a Fedora-and-friends desktop distribution that installs with the distro's package manager, launches from the application menu, looks and behaves like the official Electron app, and offers a persistent **Update** button in the sidebar footer that applies a new build from GitHub with one authorization.

**Hands-off is a hard requirement.** After a one-time setup (repository, Actions enabled, signing material), nobody rebuilds, rebases, bumps a version, signs a release, or clicks publish; the owner's only involvement is reading bug reports and clicking Update in the app.

## What success looks like

A user on Fedora, Debian/Ubuntu, Arch, or another supported glibc distro installs DSH from GitHub Releases, opens *DeepSeek Harness* from the menu, and gets a native window titled correctly. When a new upstream release is built, the sidebar shows an **Update** button while the app is running; one click, at most one polkit authorization, the app restarts into the new version. Releases appear automatically; a failed sync never ships and never blocks the last good release.

## Goals

- Build from upstream `apps/desktop` (Electron), not a Tauri or browser wrapper, so window chrome, menu behavior, and desktop profile semantics are the real app's.
- **Overlay repo:** the public repository holds only our additions; CI checks out upstream at the release tag beside them. Upstream source stays untouched unless the spike proves a Linux build is impossible without a small patch series (applied at build time, never rebased by hand).
- Artifact matrix for mainline glibc distros: **rpm** (Fedora/RHEL/openSUSE), **deb** (Debian/Ubuntu/Mint/Pop), **pacman** (Arch/Manjaro), and a universal **AppImage**.
- x86_64 first; arm64 follows once the pipeline and the update path are stable.
- Fully automated GitHub pipeline: detect a new upstream release, build, test, sign, publish, generate release notes — no manual tags, version bumps, or approvals.
- In-app update checking while the app runs (launch + every 6 hours), with a persistent **Update** button in the sidebar footer next to the account row, plus a manual *Check now* in Settings.
- Per-format apply with exactly one authorization where root is required; AppImage updates without root.
- Correct native title/app name, desktop entry, icon, and menu integration.
- Public releases with SHA-256 checksums, a signed manifest, and a clear "unofficial" disclaimer.

## Non-goals

- Not an official DeepSeek product; not macOS/Windows packaging.
- No fork of the UI or agent behavior; Linux packaging and update additions only, with no edits to upstream source.
- No silent privileged replacement of distro-managed files.
- No COPR/OBS/PPA/AUR/Flathub repositories in v1; GitHub Releases is the single source.
- No Flatpak in v1 (phase 2, for immutable distros), no 32-bit, musl/Alpine, NixOS, or container-only images.

## Anti-goals

A pipeline that ever needs the owner to rebase a patch, cut a tag, or publish by hand. Shipping unsigned artifacts. A second app implementation that drifts from upstream. A broken release that reaches users because signing or build checks were skipped.

## Constraints

- Upstream is MIT; the fork keeps the license, copyright notices, and adds a NOTICE describing downstream changes.
- Upstream exports `createElectronBuilderConfig` from `apps/desktop`, but its packaging scripts hard-code the supported targets to `mac-arm64`, `mac-x64`, and `win-x64` in `apps/desktop/scripts/desktop-build-paths.mjs`. A small build-time patch series is the likely outcome; the spike proves the minimum and records it. If a patch conflicts after an upstream change, CI fails before publishing and opens an issue.
- Build-host floor is settled: Ubuntu 22.04-class toolchain and glibc 2.35, covering Ubuntu 22.04+, Debian 12+, Fedora 36+, and RHEL 10+; RHEL 9 and older are excluded. CI images and test containers follow from that.
- `rpm`/`deb`/`pacman`/`zypper` installs need root; desktop polkit (`pkexec`) supplies one authorization.
- GitHub scheduled workflows can be delayed and are disabled on forks until enabled once; a manual dispatch remains available but is never required.
- Unauthenticated GitHub API reads are rate-limited (60/hour/IP); a 6-hour check is far below.
- AppImage needs FUSE 2 on some distros; document `--appimage-extract-and-run`.
- No Linux code signing; trust is a SHA-256 checksum plus a GPG-signed manifest whose public key ships with the app. The signing key is held in an Actions secret so publishing is unattended, and rotated only on compromise (no expiry).

## Residual human touchpoints (by design)

Steady-state releases need nobody, but honesty requires naming the cases automation cannot decide or cannot trigger:

- **One-time setup:** create the repo, enable Actions on the fork, add the signing secret, cut the first release. Done up front through the API/CLI, not per release.
- **GitHub disables scheduled workflows in public repositories after 60 days without repository activity.** If upstream goes quiet that long the project is effectively dead, so the pause is accepted; when someone notices, one click re-enables it. No external keepalive.
- **Trust and security judgment:** only a human can withdraw a bad or malicious release, rotate or revoke the signing key, or respond to a takedown. Automation fails closed; it cannot decide that a shipped build should be unshipped.
- **Our own defects and patch drift:** a broken overlay, a changed upstream packaging file, or a patch that no longer applies is caught by CI, which opens an issue and holds the last good release. Fixing the code still starts with a bug report.
- **Community contributions:** reviewing and merging pull requests is optional and outside the one-click path; ignoring them costs nothing.
- **Account-level changes:** GitHub policy, billing, 2FA, token revocation, or repository ownership changes can stop the pipeline and need a human at GitHub.

## Decisions (the how)

### 1. Repo model — overlay

`github.com/CaullenOmdahl/deepseek-harness-linux` is a standalone public repository that holds only our additions. Every build checks out `deepseek-ai/deepseek-harness` at the release tag into `upstream/`, places the overlay beside it, and applies `linux/patches/` if the spike proved a patch is required. There is no mirrored upstream history and no rebase step: upstream moving cannot conflict with our files. The one coupling is the small patch series, whose failure stops CI before publish and opens an issue.

- `linux/` — electron-builder wrapper config (imports the upstream export, adds deb/rpm/pacman targets, artifact naming, desktop metadata), packaging icons, and per-format scripts.
- `.github/workflows/` — sync, build, release.
- `linux/update-plugin/` — the in-app update affordance as a DSH plugin bundle (client button + host install/restart logic) rather than editing the desktop app's own source.
- `README` and maintainer docs.

A build-time patch series is the only way upstream files change; it lives in `linux/patches/` and is applied fresh on every build, never rebased by hand. Release tags: `v<upstream-version>-linux.<n>`, where `n` increments when we rebuild the same upstream version.

### 2. Sync and release pipeline

`sync-upstream.yml` runs on a schedule (30–60 minutes) and on manual dispatch. It mirrors the upstream `latest` line — the npm dist-tag `latest`, currently `0.2.2-rc.1`, mapped to its `dsh-v<version>` tag — and when a newer release exists: fast-forwards `master` to that tag, runs the applicable checks, and dispatches `build-linux.yml`.

`build-linux.yml` builds the artifact matrix, runs container install tests (Fedora, Debian, Ubuntu, Arch, openSUSE), verifies checksums, and on success publishes a GitHub Release with artifacts, `SHA256SUMS`, a signed `linux-update.json` manifest, and generated release notes.

**Failure handling:** any failure (upstream changed the export, container install broke, signing failed) stops the release, keeps the last good release live, and opens a GitHub issue with the failing logs assigned to the owner — a bug report, no manual build. The workflow never publishes a partial or unsigned release.

**Versioning:** release tags are `v<upstream-version>-linux.<n>`; the app reports the upstream version (for example `0.2.2-rc.1`), and the updater compares the (upstream version, linux build) pair from the manifest, so rebuilding the same upstream version still surfaces the button.

### 3. Update check and the Update button

The Electron main process checks the latest GitHub Release on launch and every 6 hours while open, plus *Check now* in Settings. When newer it shows a persistent **Update** button in the sidebar footer next to the account row, and an entry in Settings → Updates.

Clicking opens a dialog (installed → available version, release notes) with **Update and restart**. If a turn is running, the default becomes **Update after this turn**, with an explicit *Restart now* that warns it will interrupt the run; a restarted app resumes its persisted session. Download and install start only on the click.

### 4. Applying an update per format

- **AppImage** (no root): verify and replace in place via a restart helper; relaunch.
- **rpm**: verify, `pkexec dnf install -y <file>` (fallback `rpm -Uvh`), relaunch.
- **deb**: `pkexec apt-get install -y <file>` (fallback `dpkg -i`), relaunch.
- **pacman**: `pkexec pacman -U --noconfirm <file>`, relaunch.
- **zypper** (openSUSE): detected from `/etc/os-release`, `pkexec zypper install -y <file>`, relaunch.

Format detection runs at startup (`APPIMAGE` env, rpm deb database, pacman, os-release) and the app only offers the matching artifact. Failure shows the exact manual command; the app stays on the current version.

### 5. Window chrome, title, and desktop integration

Use upstream's BrowserWindow configuration; no frameless/custom title bar on Linux. Ensure `app.setName('DeepSeek Harness')`, window title "DeepSeek Harness" (plus the session title where the app already does it), `.desktop` `Name` matching, and icons at the right sizes. Verify on GNOME Wayland and X11; KDE Plasma is out of scope for v1.

### 6. Trust and signing

Releases ship `SHA256SUMS` plus a detached GPG signature, and `linux-update.json` is signed by the same project key. The private key lives in an Actions secret and signing is unattended; the public key is published in the repo and on the release page; the app embeds its fingerprint and refuses mismatches. The key has no expiry; compromise handling is documented (replace the secret, publish the new key, bump the embedded fingerprint).

### 7. Rollback

The previous artifact stays on disk after an update (renamed AppImage; cached package file), and the README documents the one-line downgrade/reinstall for each format. No rollback UI in v1.

### 8. Verification

- Container install and dependency checks for every format on Fedora, Debian, Ubuntu, Arch, and openSUSE.
- Real desktop smoke on this Fedora 44 GNOME Wayland machine (native window, title, menu entry, one polkit prompt) and on X11. KDE Plasma is not required for v1; a VM check stays optional only if the owner asks for it.
- End-to-end update test against a test release in a private repo: badge appears, one authorization, restart, version changes, session resumes.
- Failure tests: bad checksum, wrong signature, interrupted download, no network — the app stays usable and explains itself.

## Owner decisions (settled 2026-11-13)

1. **Repository:** public `github.com/CaullenOmdahl/deepseek-harness-linux`, created with the local `gh` token.
2. **Upstream channel:** mirror the `latest` line only (currently `0.2.2-rc.1`), not every `rc` tag.
3. **Support floor:** modern — Ubuntu 22.04+, Debian 12+, Fedora 36+, RHEL 10+; RHEL 9 and older excluded.
4. **Architectures:** x86_64 in v1, arm64 as a fast follow.
5. **Verification:** this Fedora 44 GNOME Wayland machine, plus CI containers; no KDE VM unless later requested.
6. **Accepted residual:** a 60-day upstream silence means the project is dead; no keepalive is built.

## What is left to the builder

The spike that proves the additive wrapper builds and the app boots on Linux from the pinned `latest` tag (`dsh-v0.2.2-rc.1`); the wrapper config and packaging metadata; workflow YAML; the update plugin (check, manifest verification, per-format install, restart helper); the sidebar footer button and Settings panel; the container/desktop test harness; README and maintainer docs; the public repository creation, one-time setup, and first release.
