# DSH Linux {{VERSION}}-linux.{{BUILD_NUMBER}}

Unofficial Linux desktop build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
{{VERSION}}, built from upstream tag `dsh-v{{VERSION}}` with this repository's Linux patch series
applied at build time.

> **This is not an official DeepSeek product.** DeepSeek Harness is MIT-licensed work by DeepSeek;
> these builds are community packaging. Report packaging problems
> [here](https://github.com/CaullenOmdahl/deepseek-harness-linux/issues), not to DeepSeek.

## Assets

This release contains exactly nine files:

- `deepseek-harness-{{VERSION}}-x86_64.AppImage`
- `deepseek-harness_{{VERSION}}_amd64.deb`
- `deepseek-harness-{{VERSION}}-1.x86_64.rpm`
- `deepseek-harness-{{VERSION}}-1-x86_64.pkg.tar.zst`
- `SHA256SUMS`, `SHA256SUMS.asc`
- `linux-update.json`, `linux-update.json.asc`
- `dsh-linux-pubkey.asc` — the release signing public key

## Install

Download the whole release first so checksum verification sees every artifact:

```bash
mkdir -p dsh-linux && cd dsh-linux
gh release download {{TAG}} -R CaullenOmdahl/deepseek-harness-linux
# or download the files manually from this page
```

```bash
# Debian / Ubuntu / Mint / Pop!_OS
sudo apt install ./deepseek-harness_{{VERSION}}_amd64.deb

# Fedora / RHEL
sudo dnf install ./deepseek-harness-{{VERSION}}-1.x86_64.rpm

# openSUSE Tumbleweed
sudo zypper install ./deepseek-harness-{{VERSION}}-1.x86_64.rpm

# Arch Linux / Manjaro
sudo pacman -U ./deepseek-harness-{{VERSION}}-1-x86_64.pkg.tar.zst

# AppImage (no install, no root)
chmod +x deepseek-harness-{{VERSION}}-x86_64.AppImage
./deepseek-harness-{{VERSION}}-x86_64.AppImage
```

The window title is **DeepSeek Harness**. Per-distro detail, upgrade/downgrade commands, and
troubleshooting are in
[`docs/install.md`](https://github.com/CaullenOmdahl/deepseek-harness-linux/blob/master/docs/install.md).

## Verify the download

The signing key is attached to this release, so the recipe works from the downloaded files alone.
```bash
gpg --import dsh-linux-pubkey.asc
sha256sum -c SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
gpg --verify linux-update.json.asc linux-update.json
```

Expected: four `OK` lines from `sha256sum`, then `Good signature from "DSH Linux <dsh-linux@invalid>"`
twice. The key fingerprint is:

```
D1C8 807B 90F7 A51E 7537  FD7F 4B69 2295 FFFB 9452
```

Check that the fingerprint matches before trusting the signatures. The key is also published in the
repository as [`dsh-linux-pubkey.asc`](https://github.com/CaullenOmdahl/deepseek-harness-linux/blob/master/dsh-linux-pubkey.asc).
A release is complete only when all nine assets above are present.

## Updating

Install the newer release with the same command. Package managers upgrade in place; for the AppImage,
replace the old file. Rebuilds of the same upstream version increment the Linux build number, and the
package metadata carries that number, so `{{TAG}}` upgrades a `-linux.1` install of the same version.
There is no in-app updater in this release.

## Known limitations

These are gaps in the upstream Linux desktop app that this packaging cannot fix:

1. **Image attachments can crash the app** — the bundled `sharp` native module conflicts with
   Electron's GLib symbols on Linux.
2. **Office-to-PDF conversion is unavailable on Linux** — upstream publishes LibreOfficeKit engines only
   for macOS and Windows.
3. **The builds are unsigned at the OS level** — trust comes from the SHA-256 checksums and the
   detached GPG signatures above.
4. **Native Wayland startup can hang** in some remote-desktop/virtual-display setups; run with
   `--ozone-platform=x11`.
5. **No in-app updater yet** — it is the next planned milestone.
6. **x86_64 only**, and KDE Plasma is untested in v1.

Full details and workarounds:
[README known limitations](https://github.com/CaullenOmdahl/deepseek-harness-linux#known-limitations).

## Verification summary

{{VERIFICATION_SUMMARY}}

CI run: {{RUN_URL}}
