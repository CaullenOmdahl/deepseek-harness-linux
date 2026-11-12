# Maintainer guide

This repository is an **overlay**: it never vendors or forks upstream source. Each release is built
from a fresh checkout of `deepseek-ai/deepseek-harness` at tag `dsh-v<version>`, with the patch series
in [`linux/patches/`](../linux/patches) applied at build time. `upstream/` is gitignored and exists only
in a build tree.

- Upstream: <https://github.com/deepseek-ai/deepseek-harness> (MIT, by DeepSeek)
- This repo: <https://github.com/CaullenOmdahl/deepseek-harness-linux> (Linux packaging)
- Releases: <https://github.com/CaullenOmdahl/deepseek-harness-linux/releases>

## Release model

Release tags are **`v<upstream-version>-linux.<n>`**, for example `v0.2.2-rc.1-linux.1`. `n` is the
Linux build number for that upstream version and starts at 1; rebuilds of the same upstream version
increment it. Artifact *file* names contain the upstream version only
(`deepseek-harness-0.2.2-rc.1-x86_64.AppImage`, `deepseek-harness_0.2.2-rc.1_amd64.deb`,
`deepseek-harness-0.2.2-rc.1-1.x86_64.rpm`, `deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst`); the
build number appears only in the tag, the manifest's `tag`, and the AppImage's
`X-AppImage-Version`.

A release always contains exactly these assets:

| Asset | Produced by |
| --- | --- |
| four packages | `linux/build/build.sh` |
| `SHA256SUMS`, `linux-update.json` | `linux/scripts/assemble-release.mjs` |
| `SHA256SUMS.asc`, `linux-update.json.asc` | `linux/scripts/sign-release.sh` |

## Pipeline

### `sync-upstream.yml` — follow upstream `latest`

Runs every 30 minutes and on manual dispatch (`sync-upstream` concurrency group, so a scheduled run
and a manual run cannot race).

1. `npm view @deepseek-ai/dsh@latest version` reads the upstream npm `latest` version.
2. `linux/scripts/resolve-upstream.mjs` checks that the matching tag `dsh-v<version>` actually exists
   upstream (exact match, not a prefix).
3. `linux/scripts/decide-sync.mjs` checks this repository's releases: if any tag
   `v<version>-linux.<n>` already exists, nothing is built.
4. An in-flight guard lists `build-linux.yml` runs and skips this tick if one is queued or running,
   instead of queuing a duplicate that would fail at `gh release create`.
5. `gh workflow run build-linux.yml --ref <default branch> -f version=<version> -f build_number=1`.

Any failure opens an issue titled **Upstream sync failed** with the run URL. A build failure opens
**Linux build failed for v<version>-linux.<n>**. A failed sync never touches the last good release.

> GitHub disables scheduled workflows in public repositories after 60 days without repository
> activity. If upstream goes quiet that long, re-enable the schedule from the Actions tab when
> someone notices; the manual dispatch path still works.

### `build-linux.yml` — build, test, sign, publish

Manual dispatch with inputs `version` (upstream product version, for example `0.2.2-rc.1`) and
`build_number` (positive integer). Runs on `ubuntu-22.04`, 120-minute timeout, with
`contents: write` and `issues: write`.

1. Checkout this repo; checkout upstream `dsh-v<version>` into `upstream/`.
2. Install pnpm 11.28.5 (the version upstream pins) and Node 24.
3. `linux/scripts/apply-patches.mjs --series linux/patches --target upstream` — applies the patch
   series; idempotent, fails on a real conflict.
4. `pnpm install --frozen-lockfile` in `upstream/`.
5. Install fpm host tools: `rpm`, `libarchive-tools`, `xz-utils`, `fakeroot`.
6. `bash linux/build/build.sh` with `VERSION`, `BUILD_NUMBER`, `DIST_DIR=dist` — prepares the
   unsigned Linux tree through upstream's own pipeline (`package-target ... --prepare-only`) and
   packages all four formats with `linux/electron-builder.config.mjs`.
7. `assemble-release.mjs` writes `SHA256SUMS` and `linux-update.json`; `verify-artifacts.mjs` checks
   that the set is exactly the four artifacts with correct metadata.
8. `test-containers.sh` installs the deb, rpm, and pacman packages in Debian 12, Ubuntu 22.04,
   Fedora 44, openSUSE Tumbleweed, and Arch Linux, then asserts `/opt/DeepSeek Harness/deepseek-harness`
   is executable, the `.desktop` entry exists with `Name=DeepSeek Harness` and
   `StartupWMClass=deepseek-harness`, and `ldd` resolves every library.
9. `sign-release.sh` signs `SHA256SUMS` and `linux-update.json` with `GPG_KEY_ID`, importing
   `GPG_PRIVATE_KEY` into a temporary `GNUPGHOME` that is deleted on exit.
10. `verify-release.sh` verifies both detached signatures in the same job.
11. `gh release create v<version>-linux.<n> dist/*` with a minimal release body. This is the only
    publishing step and runs only after every check above passed.

To dispatch by hand and follow it:

```bash
gh workflow run build-linux.yml -R CaullenOmdahl/deepseek-harness-linux \
  -f version=0.2.2-rc.1 -f build_number=1
gh run list --workflow build-linux.yml --limit 5
gh run watch <run-id> --exit-status
```

## Signing

The project key is **ed25519, no expiry, signing-only**:

- Fingerprint: `D1C8 807B 90F7 A51E 7537  FD7F 4B69 2295 FFFB 9452`
- Public key: [`dsh-linux-pubkey.asc`](../dsh-linux-pubkey.asc) — committed, linked from the README
  and `docs/install.md`.
- Private key: **only** in the Actions secret `GPG_PRIVATE_KEY` (armored private key). Never commit it,
  never keep a copy on a workstation. It was generated in a temporary `GNUPGHOME` and the exported
  file was deleted after the secret was set.

The secrets live in GitHub → **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `GPG_PRIVATE_KEY` | ASCII-armored private key |
| `GPG_KEY_ID` | key fingerprint (signing subkey selection is not needed; this is the primary key) |

Local signing for testing should use a throwaway key, not the project key. `sign-release.sh` uses the
ambient keyring when `GPG_PRIVATE_KEY` is unset; CI always sets it.

### Key rotation (compromise only)

1. Generate a new key in a temporary home, e.g.
   `GNUPGHOME=$(mktemp -d) gpg --batch --passphrase '' --quick-generate-key "DSH Linux <dsh-linux@invalid>" ed25519 sign 0`.
2. Export the secret key and replace both repo secrets.
3. Replace `dsh-linux-pubkey.asc`, then update the fingerprint in `README.md`, `docs/install.md`, and
   this file (`docs/maintainers.md`).
4. Publish a new build so the current release metadata is signed by the new key. Old releases stay
   verifiable only with the old public key; note that in the release/issue announcement if the key was
   revoked.

## Fixing a failed patch

A patch conflict fails CI **before** publishing and opens an issue with the run URL. Reproduce locally:

```bash
VERSION=0.2.2-rc.1
git clone --depth 1 --branch "dsh-v$VERSION" \
  https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-upstream
node linux/scripts/apply-patches.mjs --series linux/patches --target /tmp/dsh-upstream
```

The applier prints which patch failed and why (`git apply --check` diagnostics). Then:

1. Apply the earlier patches and stage them as the baseline, so the diff you regenerate contains only
   the failing patch's changes. For `0002`, for example:

   ```bash
   # `git apply` resolves the patch path after -C, so pass an absolute path.
   git -C /tmp/dsh-upstream apply "$PWD/linux/patches/0001-"*.patch
   git -C /tmp/dsh-upstream add -A
   git -C /tmp/dsh-upstream -c user.name=maintainer -c user.email=m@invalid commit -m baseline
   # edit the upstream files that 0002 must change
   git -C /tmp/dsh-upstream diff > "$PWD/linux/patches/0002-brand-window-title.patch"
   ```

   For `0001`, start from a fresh checkout and diff the edited tree directly.

2. Prove the regenerated series applies cleanly to a fresh checkout:

   ```bash
   rm -rf /tmp/dsh-check
   git clone --depth 1 --branch "dsh-v$VERSION" \
     https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-check
   node linux/scripts/apply-patches.mjs --series linux/patches --target /tmp/dsh-check
   # a second run must report "already applied" for every patch
   node linux/scripts/apply-patches.mjs --series linux/patches --target /tmp/dsh-check
   ```

3. Run the overlay tests: `node --test 'tests/linux/*.test.mjs'`.
4. Commit the updated patch, push, and dispatch `build-linux.yml` again. Use the same `build_number`
   if no release was published for it, or the next number if one was.

Keep patches minimal and behaviour-scoped: each file should be one logical change, and Linux must not
alter upstream macOS/Windows packaging behaviour.

## Local build and verification

Prerequisites: Node 24, pnpm 11.28.5 (`corepack enable`), git, Docker (container tests), and the fpm
host tools (`rpm`, `bsdtar`, `xz`, `fakeroot`) on Debian/Ubuntu. On Fedora, install `rpm-build`, `libarchive`,
`xz`, `fakeroot`.

```bash
VERSION=0.2.2-rc.1
git clone --depth 1 --branch "dsh-v$VERSION" \
  https://github.com/deepseek-ai/deepseek-harness.git upstream
(cd upstream && pnpm install --frozen-lockfile)

# On hosts whose standalone pnpm is the native executable, use the JS entry:
PNPM_CMD="corepack pnpm" VERSION="$VERSION" BUILD_NUMBER=1 DIST_DIR=dist linux/build/build.sh

node linux/scripts/assemble-release.mjs --dir dist --version "$VERSION" --tag "v$VERSION-linux.1"
node linux/scripts/verify-artifacts.mjs --dir dist --version "$VERSION"
bash linux/scripts/test-containers.sh dist        # requires Docker; five distro images
```

Local builds cannot sign releases: the private key exists only as an Actions secret. CI signs and
verifies with the same scripts (`sign-release.sh`, `verify-release.sh`) using a temporary keyring.

Verify a published release the way a user would:

```bash
TAG=v0.2.2-rc.1-linux.1
rm -rf /tmp/dsh-verify && mkdir -p /tmp/dsh-verify && cd /tmp/dsh-verify
gh release download "$TAG" -R CaullenOmdahl/deepseek-harness-linux
# The signing key is not a release asset; fetch it from the repository.
curl -LO https://github.com/CaullenOmdahl/deepseek-harness-linux/raw/master/dsh-linux-pubkey.asc
gpg --import dsh-linux-pubkey.asc
sha256sum -c SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
gpg --verify linux-update.json.asc linux-update.json
```

Desktop smoke test (fresh HOME, private X display so the running Wayland session cannot leak in):

```bash
chmod +x deepseek-harness-<version>-x86_64.AppImage
HOME=$(mktemp -d) Xvfb :99 -screen 0 1400x1000x24 &
env -u WAYLAND_DISPLAY -u WAYLAND_SOCKET DISPLAY=:99 HOME=$(mktemp -d) \
  ./deepseek-harness-<version>-x86_64.AppImage --appimage-extract-and-run --no-sandbox \
  --ozone-platform=x11 &
sleep 15
DISPLAY=:99 xdotool search --onlyvisible --class deepseek-harness getwindowname %@
DISPLAY=:99 xprop -id <window-id> WM_CLASS _NET_WM_NAME
```

The expected window title is exactly `DeepSeek Harness` and the expected `WM_CLASS` is
`deepseek-harness` (matching `StartupWMClass` in the installed desktop entry). Then run the same
AppImage once on the real Wayland session and confirm `wmctrl -l` (or GNOME's window list) shows
`DeepSeek Harness`; install `wmctrl` if it is missing (`sudo dnf install -y wmctrl`).

On the Fedora 44 verification host, Electron 44.7.0's native Wayland backend hangs before
`app.whenReady()` in this remote-desktop session (reproduced with a minimal Electron app, so it is not
app-specific). The working real-session check therefore forces XWayland and reads the title with
`xdotool`/`wmctrl`:

```bash
HOME=$(mktemp -d) ./deepseek-harness-<version>-x86_64.AppImage --appimage-extract-and-run \
  --no-sandbox --ozone-platform=x11 &
sleep 15
DISPLAY=:0 xdotool search --onlyvisible --name '^DeepSeek Harness$' getwindowname %@
DISPLAY=:0 xdotool search --onlyvisible --class deepseek-harness getwindowgeometry %@
wmctrl -l | grep 'DeepSeek Harness'
```

`--ozone-platform=x11` is the documented workaround for users hitting the same Wayland startup hang
(see `docs/install.md`). Verify that `.desktop` `StartupWMClass=deepseek-harness` still matches the
running window's `WM_CLASS`.

## Repository layout

```
.github/workflows/     build-linux.yml, sync-upstream.yml
linux/build/           build.sh — prepare + package the four formats
linux/lib/             release tags/names, checksums, manifest (pure helpers)
linux/scripts/         applier, sync decisions, assembly, verification, signing, container tests
linux/patches/         build-time patch series (applied fresh, never rebased by hand)
linux/electron-builder.config.mjs   Linux wrapper config around upstream's factory
linux/assets/icons/    hicolor app icons
docs/                  install guide, maintainer guide, spike results, plans/specs
tests/linux/           unit tests for every pure helper and script (`node --test 'tests/linux/*.test.mjs'`)
dsh-linux-pubkey.asc   release signing public key
```
