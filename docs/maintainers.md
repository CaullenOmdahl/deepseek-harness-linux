# Maintainer guide

This repository is an **overlay**: it never vendors or forks upstream source. Each release is built
from a fresh checkout of `deepseek-ai/deepseek-harness` at tag `dsh-v<version>`, with the patch series
in [`linux/patches/`](../linux/patches) applied at build time. `upstream/` is gitignored and exists only
in a build tree.

- Upstream: <https://github.com/deepseek-ai/deepseek-harness> (MIT, by DeepSeek)
- This repo: <https://github.com/CaullenOmdahl/deepseek-harness-linux> (Linux packaging)
- Releases: <https://github.com/CaullenOmdahl/deepseek-harness-linux/releases>

## Release model

Release tags are **`v<upstream-version>-linux.<n>`**, for example `v0.2.2-rc.1-linux.2`. `n` is the
Linux build number for that upstream version and starts at 1; rebuilding the same upstream version
increments it. `build-linux.yml` computes `n` with
[`linux/scripts/resolve-build-number.mjs`](../linux/scripts/resolve-build-number.mjs) unless one is
passed explicitly, and refuses a tag that already exists.

Artifact *file* names contain the upstream version only, so the mandated release URLs stay stable:

| Format | File name | Version metadata |
| --- | --- | --- |
| AppImage | `deepseek-harness-<version>-x86_64.AppImage` | AppImage version includes the build number |
| deb | `deepseek-harness_<version>_amd64.deb` | `Version: <version with ~>-<n>` |
| rpm | `deepseek-harness-<version>-1.x86_64.rpm` | `Version`, `Release: <n>` |
| pacman | `deepseek-harness-<version>-1-x86_64.pkg.tar.zst` | `pkgver = <version with _>-<n>` |

The build number lives in the package metadata because the file names must stay version-only. That
makes `-linux.2` installable over `-linux.1` with `apt`/`dnf`/`zypper`/`pacman` instead of requiring a
reinstall. The manifest carries the same number as `buildNumber`; Plan 2's updater compares the
`(version, buildNumber)` pair.

A release always contains exactly nine assets:

| Asset | Produced by |
| --- | --- |
| four packages | `linux/build/build.sh` |
| `SHA256SUMS`, `linux-update.json` | `linux/scripts/assemble-release.mjs` |
| `SHA256SUMS.asc`, `linux-update.json.asc` | `linux/scripts/sign-release.sh` |
| `dsh-linux-pubkey.asc` | copied from the repository root before the draft is created |

The public key is attached to the release so the verification recipe works from the downloaded file
set alone (spec §6); the repository copy remains the source of truth that CI signs and verifies against.

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
   instead of queuing a duplicate.
5. `gh workflow run build-linux.yml --ref <default branch> -f version=<version>`. The build workflow
   resolves the next free build number itself.

Failures comment on the single open **Upstream sync failed** issue instead of opening a new issue per
retry (`linux/scripts/issue-on-failure.sh`).

> GitHub disables scheduled workflows in public repositories after 60 days without repository
> activity. If upstream goes quiet that long, re-enable the schedule from the Actions tab when
> someone notices; the manual dispatch path still works.

### `build-linux.yml` — verify, build, test, sign, publish

Manual dispatch with inputs `version` (upstream product version, for example `0.2.2-rc.1`) and an
optional `build_number` (positive integer; empty means "next unused"). Runs on `ubuntu-22.04`, with a
150-minute timeout, `contents: write`, `issues: write`, and the `build-linux` concurrency group.

1. Checkout this repo and upstream `dsh-v<version>` into `upstream/` with `persist-credentials: false`.
2. Install pnpm 11.28.5 (the version upstream pins, action pinned by commit SHA) and Node 24.
3. `linux/scripts/apply-patches.mjs --series linux/patches --target upstream` — applies the patch
   series; idempotent, fails on a real conflict.
4. `pnpm install --frozen-lockfile` in `upstream/`.
5. **Gate:** `node --test 'tests/linux/*.test.mjs'` for the overlay helpers.
6. **Gate:** `pnpm typecheck` and the upstream desktop packaging tests
   (`desktop-package-environment`, `desktop-build-paths`, `package-target*`). The patch series is the
   only coupling to upstream; these catch a break in the shared macOS/Windows packaging code before a
   build. The series updates the tests that asserted Linux was unsupported, and keeps the
   unsupported-target/macOS/Windows assertions.
7. Install fpm host tools (`rpm`, `libarchive-tools`, `xz-utils`, `zstd`, `fakeroot`) and the smoke
   tools (`xvfb`, `xdotool`).
8. Resolve the build number/tag from `gh release list`; a requested number whose tag exists fails.
9. Prune `dist/`, then `bash linux/build/build.sh` with `VERSION`, `BUILD_NUMBER`, `DIST_DIR=dist`.
   The wrapper config maps `BUILD_NUMBER` to the fpm iteration/release.
10. `assemble-release.mjs` writes `SHA256SUMS` and `linux-update.json` (with `tag` and `buildNumber`).
11. `verify-artifacts.mjs --dir dist --version ... --tag ... --build-number ...` checks the four
    artifacts, checksum entries, manifest keys, manifest `tag`, and manifest `buildNumber`.
12. `verify-package-identity.sh` checks the packed deb/rpm/pacman metadata: build-number
    iteration/release, overlay maintainer/vendor/homepage, valid deb `Section`, the deb copyright file,
    and the bundled LICENSE/NOTICE resources — and that DeepSeek is not named as packager.
13. `test-containers.sh` installs the deb, rpm, and pacman packages in Debian 12, Ubuntu 22.04,
    Fedora 44, openSUSE Tumbleweed, and Arch Linux, then asserts
    `/opt/DeepSeek Harness/deepseek-harness` is executable and `ldd` resolves every library.
14. `smoke-appimage.sh` boots the AppImage under a private Xvfb display with a fresh HOME and asserts
    the visible window title is exactly `DeepSeek Harness` and WM_CLASS contains `deepseek-harness`.
15. `sign-release.sh` signs `SHA256SUMS` and `linux-update.json` with `GPG_KEY_ID`, importing
    `GPG_PRIVATE_KEY` into a temporary `GNUPGHOME` that is deleted on exit. It refuses to sign unless
    the signing key's fingerprint equals the committed public key's fingerprint.
16. `verify-release.sh` imports the committed key into a fresh temporary `GNUPGHOME` and requires a
    `VALIDSIG` fingerprint equal to the committed key for both signatures. A signature from another
    key fails even if that key is trusted.
17. Copy `dsh-linux-pubkey.asc` into `dist/` and run `verify-artifacts.mjs --release`, which requires
    the directory to hold exactly the nine published files (no stray, missing, or renamed asset).
18. Render the release body from [`docs/release-notes.md`](../docs/release-notes.md) with
    [`linux/scripts/render-release-notes.mjs`](../linux/scripts/render-release-notes.mjs). The body is
    committed, not hand-written: unofficial disclaimer, the nine asset names, install commands,
    verification recipe, known limitations, and an optional verification summary.
19. `gh release create "$TAG" <nine files> --draft` — nothing is visible until the draft is complete.
20. Assert the uploaded asset names equal the expected nine, assert the release is still a draft, then
    `gh release edit "$TAG" --draft=false`. No partial release can go live; a failure deletes the
    unpublished draft and its tag.
21. Any failure comments on the one open **Linux build failed for `<tag>`** issue instead of opening
    a new issue per retry.

To dispatch by hand and follow it:

```bash
gh workflow run build-linux.yml -R CaullenOmdahl/deepseek-harness-linux \
  -f version=0.2.2-rc.1            # omit build_number to use the next free number
gh run list --workflow build-linux.yml --limit 5
gh run watch <run-id> --exit-status
```

## Signing

The project key is **ed25519, no expiry, signing-only**:

- Fingerprint: `D1C8 807B 90F7 A51E 7537  FD7F 4B69 2295 FFFB 9452`
- Public key: [`dsh-linux-pubkey.asc`](../dsh-linux-pubkey.asc) — committed, attached to every
  release, linked from the README and `docs/install.md`.
- Private key: **only** in the Actions secret `GPG_PRIVATE_KEY` (armored private key). Never commit it,
  never keep a copy on a workstation. It was generated in a temporary `GNUPGHOME` and the exported
  file was deleted after the secret was set.

The secrets live in GitHub → **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `GPG_PRIVATE_KEY` | ASCII-armored private key |
| `GPG_KEY_ID` | key fingerprint (signing subkey selection is not needed; this is the primary key) |

`sign-release.sh` and `verify-release.sh` are pinned to the committed key. Both read its fingerprint,
compare it with the expected constant in the script and the one in this document, and refuse to
proceed on a mismatch; verification additionally requires every signature's `VALIDSIG` fingerprint to
equal the published key. `--pubkey` exists only for tests with throwaway keys. Local signing for
testing should use a throwaway key with `--pubkey`, not the project key.

### Key rotation (compromise only)

1. Generate a new key in a temporary home, e.g.
   `GNUPGHOME=$(mktemp -d) gpg --batch --passphrase '' --quick-generate-key "DSH Linux <dsh-linux@invalid>" ed25519 sign 0`.
2. Export the secret key and replace both repo secrets.
3. Replace `dsh-linux-pubkey.asc`, the `EXPECTED_FINGERPRINT` constant in `linux/scripts/sign-release.sh`
   and `linux/scripts/verify-release.sh`, and the fingerprint in `README.md`, `docs/install.md`, and
   this file.
4. Publish a new build so the current release metadata is signed by the new key. Old releases stay
   verifiable only with the old public key; note that in the release/issue announcement if the key was
   revoked.

## Fixing a failed patch

A patch conflict fails CI **before** publishing, deletes the unpublished draft if one exists, and
comments on the failure issue with the run URL. Reproduce locally:

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

3. Run the overlay tests and the upstream gates the build runs:

   ```bash
   node --test 'tests/linux/*.test.mjs'
   (cd /tmp/dsh-check && pnpm install --frozen-lockfile && pnpm typecheck && \
     pnpm exec vitest run apps/desktop/tests/desktop-package-environment.spec.ts \
       apps/desktop/tests/desktop-build-paths.spec.ts apps/desktop/tests/package-target.spec.ts \
       apps/desktop/tests/package-target-errors.spec.ts apps/desktop/tests/package-target-stages.spec.ts)
   ```

   When a patch intentionally changes upstream behaviour, update the affected upstream test in the
   same patch series (for example the Linux target assertions in `0001`).

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
PNPM_CMD="corepack pnpm" VERSION="$VERSION" BUILD_NUMBER=2 DIST_DIR=dist linux/build/build.sh

node linux/scripts/assemble-release.mjs --dir dist --version "$VERSION" \
  --tag "v$VERSION-linux.2" --build-number 2
node linux/scripts/verify-artifacts.mjs --dir dist --version "$VERSION" \
  --tag "v$VERSION-linux.2" --build-number 2
bash linux/scripts/verify-package-identity.sh dist "$VERSION" 2
bash linux/scripts/test-containers.sh dist        # requires Docker; five distro images
bash linux/scripts/smoke-appimage.sh "dist/deepseek-harness-$VERSION-x86_64.AppImage"
```

Local builds cannot sign releases: the private key exists only as an Actions secret. CI signs and
verifies with the same scripts (`sign-release.sh`, `verify-release.sh`) using a temporary keyring.
Local signing tests use a throwaway key and pass `--pubkey <exported-public-key>` to both scripts.

Verify a published release from a fresh keyring, the way a user would:

```bash
TAG=v0.2.2-rc.1-linux.2
rm -rf /tmp/dsh-verify && mkdir -p /tmp/dsh-verify && cd /tmp/dsh-verify
gh release download "$TAG" -R CaullenOmdahl/deepseek-harness-linux
export GNUPGHOME=$(mktemp -d)
gpg --import dsh-linux-pubkey.asc
sha256sum -c SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
gpg --verify linux-update.json.asc linux-update.json
gpg --import-options show-only --import --with-colons dsh-linux-pubkey.asc | awk -F: '$1=="fpr"{print $10; exit}'
```

The release is complete only when all nine assets are present. The published key must have fingerprint
`D1C8807B90F7A51E7537FD7F4B692295FFFB9452`, and both signatures must be `Good signature` from the
same key.

### AppImage desktop smoke test

CI runs `linux/scripts/smoke-appimage.sh` after the container tests. It uses a private Xvfb display, a
fresh HOME, and `--appimage-extract-and-run --no-sandbox --ozone-platform=x11`; it polls for up to
120 seconds and fails with the window list and app log if the title never appears. The expected result:

```
smoke: window title is exactly 'DeepSeek Harness'
smoke: WM_CLASS(STRING) = "deepseek-harness", "deepseek-harness"
smoke: _NET_WM_NAME(UTF8_STRING) = "DeepSeek Harness"
```

For the real Wayland session, force XWayland and read the title with `xdotool`/`wmctrl` (see
[`docs/install.md`](../docs/install.md#troubleshooting) for the native-Wayland hang):

```bash
HOME=$(mktemp -d) ./deepseek-harness-<version>-x86_64.AppImage --appimage-extract-and-run \
  --no-sandbox --ozone-platform=x11 &
sleep 15
DISPLAY=:0 xdotool search --onlyvisible --name '^DeepSeek Harness$' getwindowname %@
```

### Verifying a scheduled sync

The schedule is every 30 minutes. Check what actually ran:

```bash
gh run list --workflow sync-upstream.yml -R CaullenOmdahl/deepseek-harness-linux --limit 10
```

If no scheduled run has occurred yet, dispatch it by hand and confirm the decision:

```bash
gh workflow run sync-upstream.yml -R CaullenOmdahl/deepseek-harness-linux
gh run list --workflow sync-upstream.yml --limit 3
gh run view <run-id> --log
```

With a release already present for the current `latest` version, the run must log
`action=none` from `decide-sync.mjs` and stop without dispatching a build. When `latest` has no
`v<version>-linux.<n>` release, the run dispatches `build-linux.yml` (unless another build is in
flight) and the build resolves the next build number. Scheduled workflows are disabled after 60 days
without repository activity, so a long silence needs a manual re-enable.

## Known residuals

- **In-app sidebar brand:** the packaged app still shows **DSH Local Build** in the sidebar footer
  because the unsigned/local client profile supplies that string in the app's client code; the window
  title, desktop entry, and package metadata are branded `DeepSeek Harness`. Plan 2 (the in-app update
  plugin) replaces the sidebar string; this overlay does not patch the client bundle for it.
- No in-app updater yet (Plan 2).
- Builds are unsigned at the OS level; trust is checksums plus the detached GPG signatures.
- x86_64 only; KDE Plasma untested in v1.

## Repository layout

```
.github/workflows/     build-linux.yml, sync-upstream.yml
linux/build/           build.sh — prepare + package the four formats
linux/lib/             release tags/names, package versions, checksums, manifest, release asset set
linux/scripts/         applier, sync decisions, build-number/notes resolution, assembly,
                       verification, signing, package identity, AppImage smoke, issue reporting,
                       container tests
linux/patches/         build-time patch series (applied fresh, never rebased by hand)
linux/electron-builder.config.mjs   Linux wrapper config around upstream's factory
linux/assets/          hicolor app icons, deb copyright file
docs/                  install guide, maintainer guide, release-notes template, spike results, plans/specs
tests/linux/           unit tests for every pure helper and script (`node --test 'tests/linux/*.test.mjs'`)
dsh-linux-pubkey.asc   release signing public key (also attached to every release)
```
