# DeepSeek Harness for Linux (unofficial)

Unofficial Linux desktop builds of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
packaged as **AppImage**, **deb**, **rpm**, and **pacman** packages for x86_64.

This repository is an overlay. It contains only the Linux packaging, not a fork of the app: every
release is built in CI from the upstream `dsh-v<version>` tag with the small build-time patch series
in [`linux/patches/`](linux/patches) applied, then installed and smoke-tested in clean distro
containers before it is signed and published.

> **This is not an official DeepSeek product.** DeepSeek Harness is MIT-licensed work by DeepSeek;
> these builds are community packaging. Please report packaging problems
> [here](https://github.com/CaullenOmdahl/deepseek-harness-linux/issues), not to DeepSeek. See
> [`NOTICE`](NOTICE) for exactly what this repository changes.

## Supported systems

| Format | Systems | Install with |
| --- | --- | --- |
| `deb` | Ubuntu 22.04+, Debian 12+, Mint/Pop!_OS based on them | `apt` |
| `rpm` | Fedora 36+, RHEL 10+, openSUSE Tumbleweed | `dnf` / `zypper` |
| `pacman` | Arch Linux, Manjaro | `pacman` |
| `AppImage` | any glibc x86_64 distribution | run the file |

- **Architecture:** x86_64 only in v1. arm64 is a planned fast follow.
- **glibc:** builds target glibc 2.35 (Ubuntu 22.04 class), which covers the distros above. RHEL 9 and
  older are not supported.
- **Not supported:** musl/Alpine, NixOS, Flatpak, 32-bit, and KDE Plasma is untested in v1.

The current release is
[`v0.2.2-rc.1-linux.1`](https://github.com/CaullenOmdahl/deepseek-harness-linux/releases/tag/v0.2.2-rc.1-linux.1)
(upstream version `0.2.2-rc.1`). Always install artifacts from the
[Releases page](https://github.com/CaullenOmdahl/deepseek-harness-linux/releases).

## Install

Download every asset of the release you want into one directory first (the checksum file covers the
four artifacts and is easiest to use with all of them present):

```bash
mkdir -p dsh-linux && cd dsh-linux
gh release download v0.2.2-rc.1-linux.1 -R CaullenOmdahl/deepseek-harness-linux
# or download the files manually from the release page
```

Then install the one matching your distribution:

```bash
# Debian / Ubuntu / Mint / Pop!_OS
sudo apt install ./deepseek-harness_0.2.2-rc.1_amd64.deb

# Fedora / RHEL
sudo dnf install ./deepseek-harness-0.2.2-rc.1-1.x86_64.rpm

# openSUSE Tumbleweed
sudo zypper install ./deepseek-harness-0.2.2-rc.1-1.x86_64.rpm

# Arch Linux / Manjaro
sudo pacman -U ./deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst

# AppImage (no install, no root)
chmod +x deepseek-harness-0.2.2-rc.1-x86_64.AppImage
./deepseek-harness-0.2.2-rc.1-x86_64.AppImage
```

After a package install, launch **DeepSeek Harness** from the application menu (or run
`/opt/DeepSeek Harness/deepseek-harness` directly). The installed binary, desktop entry
(`/usr/share/applications/deepseek-harness.desktop`), and hicolor icons are all named
`deepseek-harness`; the visible name is **DeepSeek Harness**.

Per-distro detail, uninstall commands, and troubleshooting are in [`docs/install.md`](docs/install.md).

### AppImage and FUSE

The AppImage mounts itself through FUSE 2. If FUSE 2 is missing, either install it (`libfuse2` on
Debian/Ubuntu, `fuse-libs` on Fedora) or run it with the extraction fallback:

```bash
./deepseek-harness-0.2.2-rc.1-x86_64.AppImage --appimage-extract-and-run
```

On systems where the Chromium sandbox cannot be used (for example distributions that restrict
unprivileged user namespaces), add `--no-sandbox`. The AppImage's bundled desktop entry already passes
it; for package installs, run the binary with the flag, or add it to the installed desktop entry.

## Verify the download

Every release ships `SHA256SUMS` (the four artifacts) and `linux-update.json` (machine-readable
release metadata), each with a detached GPG signature: `SHA256SUMS.asc` and `linux-update.json.asc`.
The signing key is committed to this repository as
[`dsh-linux-pubkey.asc`](dsh-linux-pubkey.asc). Its fingerprint is:

```
D1C8 807B 90F7 A51E 7537  FD7F 4B69 2295 FFFB 9452
```

Verify a downloaded release (run from the directory containing all assets):

```bash
# 1. Import the release signing key (from this repo, or copy dsh-linux-pubkey.asc next to the assets).
gpg --import dsh-linux-pubkey.asc

# 2. Check that every artifact matches its SHA-256.
sha256sum -c SHA256SUMS

# 3. Check that the checksum file and the release manifest are signed by that key.
gpg --verify SHA256SUMS.asc SHA256SUMS
gpg --verify linux-update.json.asc linux-update.json
```

Expected: four `OK` lines from `sha256sum`, then `Good signature from "DSH Linux <dsh-linux@invalid>"`
twice. `gpg` also warns that the key is not certified in *your* keyring; that is expected for a project
key imported on its own. What matters is the fingerprint and `Good signature`. The release is complete
only when all four artifacts plus `SHA256SUMS`, `SHA256SUMS.asc`, `linux-update.json`, and
`linux-update.json.asc` are present.

## Updating and downgrading

There is **no in-app update button in this first release**; it is the next planned milestone. To
update, download the newer release and install it over the old one with the same command as above
(the package managers upgrade in place; replace the AppImage file).

To go back to a previous release, download that release's artifact and reinstall it:

```bash
# deb
sudo apt install --allow-downgrades ./deepseek-harness_<version>_amd64.deb
# rpm
sudo rpm -Uvh --oldpackage ./deepseek-harness-<version>-1.x86_64.rpm
# pacman
sudo pacman -U ./deepseek-harness-<version>-1-x86_64.pkg.tar.zst
# AppImage: replace the file with the older release's AppImage; nothing else to do
```

## Known limitations

These are gaps in the upstream Linux desktop app that this packaging cannot fix. CI skips the
corresponding upstream checks and reports them, rather than pretending they pass:

1. **Image attachments can crash the app.** The bundled `sharp` native module segfaults under
   Electron on Linux because of the GLib symbol conflict documented in
   [electron#46323](https://github.com/electron/electron/issues/46323) (see also the
   [sharp install notes](https://sharp.pixelplumbing.com/install#electron-and-linux)). The first
   image attachment or thumbnail path that lazily loads sharp crashes the Electron main process.
   Avoid attaching images until this is fixed upstream or worked around in the overlay.
2. **Office-to-PDF conversion is unavailable on Linux.** `@deepseek-ai/libreoffice-kit` publishes
   native engines only for macOS and Windows, so document conversion and the Office skill CLI fail
   with `Installed LibreOfficeKit package is incomplete`. This stays broken until upstream ships a
   Linux LibreOfficeKit engine (or a packaged WASM engine).
3. **The Linux builds are unsigned at the OS level.** Upstream has no Linux code signing, so the
   artifacts are not Authenticode/GPG-signed executables; trust comes from the release's SHA-256
   checksums and the detached GPG signatures described above. The window title is supplied by the
   overlay's official-client-title selector (`DSH_LINUX_CLIENT_TITLE`), because upstream's
   unsigned/local build profile would otherwise brand the window *DSH Local Build*; the shipped
   window title is **DeepSeek Harness**.
4. **Native Wayland startup can hang** in some remote-desktop/virtual-display setups with Electron
   44.7.0; the app then starts but never shows a window. Use the X11/XWayland backend:
   `--ozone-platform=x11` (see [`docs/install.md`](docs/install.md#troubleshooting)).
5. **First release has no in-app updater** (see [Updating and downgrading](#updating-and-downgrading)).
6. **x86_64 only**, and KDE Plasma is untested in v1.

If any of these affect you, open an issue with the release tag and your distribution version.

## Reporting issues

- Packaging, install, or release problems:
  <https://github.com/CaullenOmdahl/deepseek-harness-linux/issues>
- App behaviour, UI, or agent problems that also happen in the official macOS/Windows build:
  <https://github.com/deepseek-ai/deepseek-harness/issues>

Include the release tag (`v0.2.2-rc.1-linux.1`), your distribution and version, `glibc` version, the
format you installed, and whether you are on Wayland or X11. Failed builds are filed automatically
as issues here with the CI run URL.

## Building from source

Maintainers: see [`docs/maintainers.md`](docs/maintainers.md) for the sync/build/publish pipeline,
the release tag scheme, signing keys, and how to repair a failed patch. The short version:

```bash
git clone --depth 1 --branch dsh-v0.2.2-rc.1 https://github.com/deepseek-ai/deepseek-harness.git upstream
corepack enable
(cd upstream && pnpm install --frozen-lockfile)
VERSION=0.2.2-rc.1 BUILD_NUMBER=1 DIST_DIR=dist linux/build/build.sh
# artifacts are in dist/; release metadata and signatures are produced by CI
```

## License

This repository's Linux packaging additions are MIT-licensed. DeepSeek Harness itself is MIT-licensed
by DeepSeek; the upstream copyright notice is preserved in [`LICENSE`](LICENSE), and
[`NOTICE`](NOTICE) describes the downstream changes.
