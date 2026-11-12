# Installing DeepSeek Harness on Linux

These are unofficial Linux builds. Read the [README known limitations](../README.md#known-limitations)
before installing: image attachments can crash the app, Office-to-PDF conversion does not work, and
the builds are unsigned at the OS level (verified with SHA-256 plus GPG signatures instead).

The examples use release `v0.2.2-rc.1-linux.1` (upstream version `0.2.2-rc.1`). Substitute the tag
and file version of the release you are installing.

## 1. Download

Download the whole release so checksum verification sees every artifact:

```bash
mkdir -p dsh-linux && cd dsh-linux
gh release download v0.2.2-rc.1-linux.1 -R CaullenOmdahl/deepseek-harness-linux
```

Without the GitHub CLI, download the assets from
<https://github.com/CaullenOmdahl/deepseek-harness-linux/releases> into one directory.

A complete release contains exactly:

- `deepseek-harness-0.2.2-rc.1-x86_64.AppImage`
- `deepseek-harness_0.2.2-rc.1_amd64.deb`
- `deepseek-harness-0.2.2-rc.1-1.x86_64.rpm`
- `deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst`
- `SHA256SUMS`, `SHA256SUMS.asc`
- `linux-update.json`, `linux-update.json.asc`

## 2. Verify

```bash
# Import the project signing key once.
# If it is not next to the downloaded files, take it from the repository:
#   curl -LO https://raw.githubusercontent.com/CaullenOmdahl/deepseek-harness-linux/master/dsh-linux-pubkey.asc
gpg --import dsh-linux-pubkey.asc

sha256sum -c SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
gpg --verify linux-update.json.asc linux-update.json
```

Expected: four `OK` lines, then `Good signature from "DSH Linux <dsh-linux@invalid>"` for both
signatures. Check that the fingerprint is
`D1C8 807B 90F7 A51E 7537  FD7F 4B69 2295 FFFB 9452`.

If you downloaded only one artifact, check just its line:

```bash
grep ' deepseek-harness_0.2.2-rc.1_amd64.deb$' SHA256SUMS | sha256sum -c -
```

## 3. Install by distribution

### Fedora 36+ / RHEL 10+

```bash
sudo dnf install ./deepseek-harness-0.2.2-rc.1-1.x86_64.rpm
```

`dnf` pulls the runtime dependencies (gtk3, nss, libnotify, at-spi2-core, ALSA, GBM, and so on).
The package itself is unsigned; `dnf` installs a local file you explicitly named, so it does not
refuse it.

### openSUSE Tumbleweed

```bash
sudo zypper install ./deepseek-harness-0.2.2-rc.1-1.x86_64.rpm
```

### Debian 12+ / Ubuntu 22.04+ / Mint / Pop!_OS

```bash
sudo apt install ./deepseek-harness_0.2.2-rc.1_amd64.deb
```

`apt` resolves the declared dependencies. On a very minimal system the Electron runtime may also need
`libasound2`, `libgbm1`, and `libnss3`, which are declared but can be missing from container images;
install them explicitly if startup reports missing shared libraries.

### Arch Linux / Manjaro

```bash
sudo pacman -U ./deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst
```

The package declares Arch's native dependency names (alsa-lib, gtk3, nss, ffmpeg, and so on).

### AppImage (any glibc x86_64 distribution)

```bash
chmod +x deepseek-harness-0.2.2-rc.1-x86_64.AppImage
./deepseek-harness-0.2.2-rc.1-x86_64.AppImage
```

The AppImage needs FUSE 2 to self-mount. If it cannot find `libfuse.so.2`, either install FUSE 2 and
retry:

| Distribution | Package |
| --- | --- |
| Debian / Ubuntu | `sudo apt install libfuse2` |
| Fedora / RHEL | `sudo dnf install fuse-libs` |
| openSUSE | `sudo zypper install fuse2` |
| Arch | `sudo pacman -S fuse2` |

or run it without FUSE:

```bash
./deepseek-harness-0.2.2-rc.1-x86_64.AppImage --appimage-extract-and-run
```

The AppImage is self-contained; it does not install files and does not need root.

## 4. Launch

After a package install, launch **DeepSeek Harness** from the application menu, or run the installed
binary directly:

```bash
"/opt/DeepSeek Harness/deepseek-harness"
```

The window title, application name, and desktop entry are all **DeepSeek Harness**. The executable,
desktop file, and icon files are named `deepseek-harness`.

## 5. Upgrade

Install the newer release with the same command you used originally. Package managers upgrade in
place; for the AppImage, replace the old file with the new one. There is no in-app updater in this
first release.

## 6. Downgrade

Download the older release into its own directory (so its `SHA256SUMS` and signatures match its
artifacts), verify it, and reinstall:

```bash
# deb
sudo apt install --allow-downgrades ./deepseek-harness_<version>_amd64.deb
# rpm
sudo rpm -Uvh --oldpackage ./deepseek-harness-<version>-1.x86_64.rpm
# pacman
sudo pacman -U ./deepseek-harness-<version>-1-x86_64.pkg.tar.zst
# AppImage: keep or restore the older AppImage file; nothing else to do
```

## 7. Uninstall

```bash
# deb
sudo apt remove deepseek-harness
# rpm (Fedora/RHEL)
sudo dnf remove deepseek-harness
# rpm (openSUSE)
sudo zypper remove deepseek-harness
# pacman
sudo pacman -R deepseek-harness
# AppImage: delete the file
```

User settings and sessions are not removed by uninstalling.

## Troubleshooting

**`dlopen(): error loading libfuse.so.2`** — install FUSE 2 (table above) or pass
`--appimage-extract-and-run`.

**`The SUID sandbox helper binary was found, but is not configured correctly` / `No usable sandbox!`**
— the Chromium sandbox is blocked by the kernel configuration (common in containers or distributions
that restrict unprivileged user namespaces). Run with `--no-sandbox`. The AppImage's bundled desktop
entry already passes it; for package installs, add the flag to the installed
`/usr/share/applications/deepseek-harness.desktop` `Exec=` line or launch the binary manually.

**`error while loading shared libraries: libasound.so.2` / `libgbm.so.1`** — install the missing
runtime dependency (`libasound2`, `libgbm1` on Debian/Ubuntu; `alsa-lib`, `mesa-libgbm` on
Fedora/RHEL).

**Blank window under X11 from a Wayland session** — Electron follows `WAYLAND_DISPLAY` even when
`DISPLAY` is set. Force X11 with `--ozone-platform=x11` (and unset `WAYLAND_DISPLAY` if you are
aiming at a specific X server, for example an Xvfb display).

**Office files won't convert / the Office skill fails** — expected on Linux; upstream has no Linux
LibreOfficeKit engine. See the README known limitations.

**Attaching an image closes the app** — expected; the bundled sharp module segfaults under Electron on
Linux. Avoid image attachments until this is fixed. See the README known limitations.

**Anything else** — open an issue with the release tag, distribution and version, `glibc` version,
format, and whether the session is Wayland or X11:
<https://github.com/CaullenOmdahl/deepseek-harness-linux/issues>.
