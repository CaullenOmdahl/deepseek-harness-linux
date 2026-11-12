# Linux desktop build spike — results

Status: **build path proven; AppImage produced and boots headlessly.** Two upstream Linux gaps remain
(sharp native crash, LibreOfficeKit conversion) and release branding needs a decision; see
[Known gaps and caveats](#known-gaps-and-caveats). This document is the handoff for Task 6 (build
workflow) and Task 8 (Fedora verification).

## Pinned upstream

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Tag: `dsh-v0.2.2-rc.1`
- Commit: `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- Product version: `0.2.2-rc.1`
- Clone: `git clone --depth 1 --branch dsh-v0.2.2-rc.1 … upstream` (5.1 s)

Verified the brief's expectation: `upstream/apps/desktop/scripts/desktop-build-paths.mjs` exists.

## Host and toolchain (this machine)

- Fedora 44 (Workstation), kernel `7.2.15-200.fc44.x86_64`, x86_64, 24 CPUs, 62 GB RAM
- Node `v24.22.1`, corepack `0.36.0`, pnpm `11.28.5` (the version upstream pins in `packageManager`)
- Electron `44.7.0`, electron-builder `26.17.0`, app-builder-lib `26.17.0` (from upstream's lockfile)
- `xvfb-run`/`Xvfb`/`xdotool` present; AppImage run with `--appimage-extract-and-run` (FUSE not required)
- The host's `pnpm` is the standalone native `@pnpm/exe` binary. Upstream's packaging scripts spawn
  `node $npm_execpath`, so a native pnpm makes that child fail with `SyntaxError` on the ELF binary.
  Run the build through **`corepack pnpm exec`** (its `npm_execpath` is `…/bin/pnpm.mjs`, a JS file), or
  set `npm_execpath` to a JS pnpm entry (`…/bin/pnpm.cjs`/`pnpm.mjs`). On CI, `pnpm/action-setup@v4`
  installs the JS entry, so plain `pnpm exec` works there. This is an environment fact, not a patch.

## Step 2 — install the workspace

```bash
corepack enable
corepack prepare pnpm@11.28.5 --activate
cd upstream && pnpm install --frozen-lockfile
```

- Result: exit 0
- Wall time: **9.1 s** (`/usr/bin/time`, pnpm itself reported 7.8 s) — pnpm store was already warm
- `node_modules` populated; Electron, electron-builder, tsx, app-builder-lib present

## Step 3 — observe the Linux rejection

The command from the brief:

```bash
DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64 --check
```

Observed failure (exit 1, before any install work because `--check` only parses and validates):

```
Error: desktop package: unsupported target "linux-x64"; expected mac-arm64, mac-x64, win-x64
    at resolveDesktopPackageTarget (…/apps/desktop/scripts/package-target.ts:…)
```

This is the first of **two** hard-coded target tables. The brief predicted the message
`desktop build paths: unsupported target linux-x64`; that is the second table
(`desktop-build-paths.mjs`'s `SUPPORTED_TARGETS`), reached only after `package-target.ts` accepts
`linux-x64`. Both layers needed the target added.

## Step 4 — minimal Linux target patch

The patch is `linux/patches/0001-desktop-linux-target.patch` (one patch file touching 16 upstream files, +127/−61).
It adds `linux-x64` as a first-class build target, wires the Linux layout through the existing
unsigned/local path, and keeps upstream's macOS/Windows upload and signing behavior untouched.

After the patch, the exact Step 3 command passes:

```
$ DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
    pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64 --check
desktop package: linux-x64 would publish 0.2.2-rc.1; local configuration and toolchain valid, signing and notarization were not attempted
EXIT=0   (1.2 s)
```

Design decisions in the patch:

- Linux artifacts are **always unsigned**. `main()` normalizes a Linux invocation to `unsigned: true`,
  so the brief's command (no `--unsigned`) works and outputs land in `unsigned-artifacts/` with the
  `-unsigned` suffix. Upstream has no Linux signing or notarization, and the overlay's own updater
  (Plan 2) replaces upstream's macOS/Windows updater.
- `linux-x64` is a build target, not an upstream **upload** target. The type split
  (`DesktopBuildTarget` vs `DesktopAutoUpdateTarget`) keeps upload/release-retention code rejecting
  Linux at compile time and runtime instead of silently producing a macOS-named installer.
- `electron-builder`'s existing `linux: { … }` block (it already had `target: ['AppImage']`) gained
  `executableName: 'deepseek-harness'`, so the packaged executable (and the `linux-unpacked` smoke
  path) is deterministic and matches the install path planned for Task 6
  (`/opt/DeepSeek Harness/deepseek-harness`).
- No Linux Office native engine exists upstream (`@deepseek-ai/libreoffice-kit@0.1.5` publishes only
  darwin/win32/wasm optional engines), so upstream's build-time selector already picks the WASM
  engine; the packaged app cannot resolve it (see gaps). The runtime smoke is skipped for Office on
  Linux only.
- sharp is unusable under Electron on Linux (electron#46323); the runtime payload smoke skips the
  sharp native check on Linux only.

### Patched files and why

| File | Change | Why |
| --- | --- | --- |
| `apps/desktop/scripts/desktop-build-paths.mjs` | `linux-x64` in `SUPPORTED_TARGETS`, target table, JSDoc unions | Second hard-coded target table; maps paths/platform for Linux |
| `apps/desktop/scripts/desktop-build-paths.d.mts` | `DesktopBuildTarget`, platform `'linux'` | Keep the `.mjs` declaration file in sync |
| `apps/desktop/scripts/desktop-auto-update-environment.d.mts` | new `DesktopBuildTarget = DesktopAutoUpdateTarget \| 'linux-x64'` | Separate build targets from upload targets |
| `apps/desktop/scripts/package-target.ts` | add `linux-x64` to `TARGETS`/types, Linux host check, force unsigned, Linux env selection, release-record/upload narrowing, Linux stage label | Core target selection and packaging flow |
| `apps/desktop/scripts/desktop-package-environment.mjs` | `localLinuxPackageEnvironment`, Linux-aware `validateDesktopPackageEnvironment` | Select unsigned local defaults; skip macOS/Windows policy and signing checks |
| `apps/desktop/scripts/desktop-package-environment.d.mts` | declaration updates | Keep types in sync |
| `apps/desktop/scripts/desktop-toolchain-preflight.ts` | platform union includes `linux` | Linux needs only the tar probe |
| `apps/desktop/scripts/development-project.ts` | target type widened to `DesktopBuildTarget` | Keeps `tsc` green for the dev launcher |
| `apps/desktop/scripts/electron-builder-config.mjs` | skip upstream policy on Linux; `linux.executableName` | Linux artifacts are unsigned and need a stable executable name |
| `apps/desktop/scripts/prepare-cli.ts` | platform union includes `linux` | CLI launcher copy is platform-generic on Linux |
| `apps/desktop/scripts/prepare-dsh.ts` | Electron executable path for Linux (`electron`, not `Electron.app/…`) | Linux Electron distribution layout |
| `apps/desktop/scripts/prepare-runtime.ts` | same Electron executable path fix | The runtime smoke and version probe run Electron as Node |
| `apps/desktop/scripts/retain-desktop-ci.ts` | explicit rejection of Linux | Upstream CI retention is macOS/Windows only |
| `apps/desktop/scripts/smoke-packaged-runtime.ts` | Linux `linux-unpacked/` layout and executable name | Post-package runtime smoke |
| `apps/desktop/scripts/smoke-runtime.ts` | skip Office conversion checks on Linux (warns) | No packaged LibreOfficeKit engine for Linux |
| `apps/desktop/tests/fixtures/runtime-payload-smoke.mjs` | skip sharp native check on Linux (reports `sharp:false`) | Electron/Linux GLib symbol leak segfaults sharp |

Patch verification:

```bash
git -C upstream diff > linux/patches/0001-desktop-linux-target.patch
git -C upstream apply --check --reverse linux/patches/0001-desktop-linux-target.patch   # exit 0
# fresh clone of the pinned tag + git apply --check/apply: both exit 0
```

Upstream's own `apps/desktop/tests/desktop-package-environment.spec.ts` still passes with the patch
(75/75), so the macOS/Windows unsigned/policy behavior is unchanged.

## Step 5 — build the AppImage

Exact command (run from `upstream/`):

```bash
DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
  corepack pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64
```

`corepack pnpm exec` is the local workaround for the native pnpm described above; on CI use
`pnpm exec`. Linux is forced unsigned, so no `--unsigned` flag is needed.

- Result: **exit 0**
- Wall time: **2 min 16 s** (20:15:53 → 20:18:09 UTC) with warm downloads/pkg store; the run journal
  reports 134.7 s inside the `linux-package` stage. A cold host adds Electron and runtime download time.
- Packaging journal:
  `upstream/apps/desktop/.desktop-build/packaging-runs/2026-11-12T20-15-54.826Z-LyWIhU/events.jsonl`
- Stage timings (from that journal): root build 30.6 s, runtime pack 15.2 s, prepare:runtime 15.6 s,
  prepare:dsh 25.0 s, electron-builder 33.4 s, packaged smoke 9.0 s.

### Artifact (Task 6 consumes these exact values)

- Path (repo-relative):
  `upstream/apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-linux-x86_64-unsigned.AppImage`
- Path (absolute on this host):
  `/home/caullen/Documents/deepseek-harness/default-workspace/deepseek-harness-linux/upstream/apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-linux-x86_64-unsigned.AppImage`
- Size: **369,049,010 bytes (351.9 MiB)**
- SHA-256: `c5f2f2ff43d006538ab9c3cd7deaa6b021080cf26905397ab8f86a38117d0989`
- Name shape: `deepseek-harness-<version>-linux-x86_64-unsigned.AppImage`
  (`electron-builder` renders `${os}-${arch}` as `linux-x86_64` for AppImage). Task 6 must rename it
  to `deepseek-harness-<version>-x86_64.AppImage`.

Note: the brief's expected path
`apps/desktop/.desktop-build/linux-x64/artifacts/` is **not** where upstream writes. Upstream's
`desktopTargetBuildPaths()` nests outputs under `.desktop-build/targets/<target>/`, and unsigned
builds use `unsigned-artifacts/` (suffix `-unsigned`). Task 6 must use the actual path above.

Build warnings recorded by electron-builder (non-fatal):

- `desktopName is not set in package.json` — WM_CLASS/window association with the `.desktop` entry is
  incomplete on Linux; Task 6/8 should set `desktopName` + `linux.syncDesktopName`.
- `duplicate dependency references` for `js-yaml` and `@deepseek-ai/schemastery` (harmless).
- The AppImage used electron-builder's **default icon**; no Linux icon was configured.

## Step 6 — headless boot

```
APPIMAGE=upstream/apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-linux-x86_64-unsigned.AppImage
Xvfb :99 -screen 0 1400x1000x24 &
env -u WAYLAND_DISPLAY -u WAYLAND_SOCKET DISPLAY=:99 HOME=$(mktemp -d) \
  timeout 45 "$APPIMAGE" --appimage-extract-and-run --no-sandbox --ozone-platform=x11 --disable-gpu
```

Result: **`APP_STILL_RUNNING`** after 20 s (checked with `ps -p`), with the app's own log line:

```
dsh web: http://127.0.0.1:<port>/?token=<token>
```

Window-manager evidence from `xdotool` on the private `:99` display (fresh HOME):

```
id=4194305 name='deepseek-harness' class='Deepseek-harness' pid=<app>
id=2097155 name='DSH Local Build' class='deepseek-ai-dsh-desktop' pid=<app>
```

Two important caveats:

1. **Isolate the display.** This host runs a Wayland session, and Electron follows `WAYLAND_DISPLAY`
   even under `DISPLAY=:99` (its GPU process used `--ozone-platform=wayland`). Without unsetting
   `WAYLAND_DISPLAY`/`WAYLAND_SOCKET` and forcing `--ozone-platform=x11`, no window appears on the
   Xvfb display and the check is invalid.
2. **Title is `DSH Local Build`, not `DeepSeek Harness`.** The unsigned path builds the *local* client
   profile (`pnpm run build --profile local`); `apps/web/vite.config.ts` defaults the document title to
   `DSH Local Build` unless `DSH_CLIENT_TITLE` is set by an official client profile. The `.desktop`
   entry *does* say `Name=DeepSeek Harness`. Task 8's title acceptance needs the release build to use
   the official client title (upstream's official profile sets `DSH_CLIENT_TITLE=DeepSeek Harness`),
   which is not part of the upstream unsigned/local path — Task 6 must decide how to deliver it
   (wrapper patch or an official-client build in the overlay) and re-verify.

AppImage metadata observed by extracting the `.desktop` entry:

```ini
[Desktop Entry]
Name=DeepSeek Harness
Exec=AppRun --no-sandbox %U
Terminal=false
Type=Application
Icon=deepseek-harness
StartupWMClass=DeepSeek Harness
X-AppImage-Version=0.2.2-rc.1
Categories=Development;
```

`StartupWMClass=DeepSeek Harness` does not match either real window class
(`deepseek-ai-dsh-desktop` / `Deepseek-harness`), consistent with the electron-builder `desktopName`
warning; menu/window association must be fixed before Task 8.

## Known gaps and caveats

These are real Linux gaps in the pinned upstream, not spike harness problems. The patch series skips
the corresponding checks and the build reports them rather than silently passing:

1. **sharp segfaults under Electron on Linux.** Loading the bundled `sharp@0.35.5` in Electron's Node
   mode exits with SIGSEGV (reproduced directly; `EXIT=139`). This is the documented Electron/Linux
   GLib symbol conflict ([electron#46323](https://github.com/electron/electron/issues/46323),
   [sharp install docs](https://sharp.pixelplumbing.com/install#electron-and-linux)). The runtime
   payload smoke skips the sharp check on Linux and reports `sharp:false`. Consequences: first image
   attachment/thumbnail path that lazily requires sharp will crash the Electron main process. A
   release must fix this (e.g. isolate sharp work in a utility process/system Node) or scope the
   feature out; Task 6/8 must not claim image attachment support until then.
2. **LibreOffice/Office conversion is unavailable on Linux.** `@deepseek-ai/libreoffice-kit@0.1.5`
   publishes native engines only for darwin/win32; Linux falls back to the WASM engine at packaging
   time, but the packaged ASAR resolves the (missing) native `libreoffice-kit-linux-x64-glibc` and
   throws `Installed LibreOfficeKit package is incomplete`. The runtime smoke skips DOCX/XLSX/PPTX
   conversion and the Office skill CLI on Linux. `dsh-office-to-pdf` document conversion is therefore
   expected to fail in the shipped AppImage until a Linux engine or a WASM packaging fix exists.
3. **Title/branding:** see Step 6 — unsigned/local client profile yields `DSH Local Build`; official
   profile yields `DeepSeek Harness` but expects the official pack path. Task 6/8 must reconcile.
4. **Icons/desktop integration:** default Electron icon, no `linux.icon`; `.desktop` `StartupWMClass`
   mismatch and no `desktopName`/`syncDesktopName`. Owned by Task 6 (wrapper config) and Task 8.
5. **AppImage formats:** the upstream `linux` config declares only `AppImage`; Task 6's deb/rpm/pacman
   artifacts require the overlay wrapper electron-builder config described in the design spec. The
   spike proves the AppImage path only.
6. **FUSE:** the AppImage was run with `--appimage-extract-and-run` per the brief. Untested without
   FUSE 2 on this host; document the fallback.
7. **Signing:** there is none for Linux. Artifacts are unsigned (`-unsigned` suffix); the overlay's
   `SHA256SUMS` + GPG manifest is the trust mechanism (Tasks 4/5).

## What Task 6 should use

- Apply `linux/patches/0001-desktop-linux-target.patch` to the pinned upstream checkout before build
  (`git apply`; Task 2's applier will do this).
- Build command, from `upstream/`:

  ```bash
  DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
    pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64
  ```

  (use `corepack pnpm exec` on hosts with the standalone native pnpm)
- Collect `apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/deepseek-harness-<version>-linux-x86_64-unsigned.AppImage`
  and rename to `deepseek-harness-<version>-x86_64.AppImage`.
- Expect only AppImage from this command; add deb/rpm/pacman through the overlay wrapper config.
- Boot verification recipe and title caveat are above; the release title is not yet
  `DeepSeek Harness`.
- Keep the sharp and LibreOffice gaps visible in release notes / CI until fixed; the patch only stops
  the build from failing on them.

## Reproduce from scratch

```bash
# from the overlay repo root
git clone --depth 1 --branch dsh-v0.2.2-rc.1 \
  https://github.com/deepseek-ai/deepseek-harness.git upstream
git -C upstream apply "$PWD/linux/patches/0001-desktop-linux-target.patch"
corepack enable && corepack prepare pnpm@11.28.5 --activate
(cd upstream && pnpm install --frozen-lockfile)
(cd upstream && DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
  corepack pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64)
```

`upstream/` is gitignored; the build tree lives under `upstream/apps/desktop/.desktop-build/`.
