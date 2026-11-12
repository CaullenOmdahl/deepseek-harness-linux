// Linux release wrapper around upstream's electron-builder config factory.
//
// Upstream's target table declares only AppImage for Linux, and its unsigned/local path
// leaves the window class and icon unset. This module reuses the upstream factory
// (`upstream/apps/desktop/scripts/electron-builder-config.mjs`, the module the spike
// recorded) and overrides only the Linux side:
//
// - all four release formats: AppImage, deb, rpm, pacman;
// - `executableName` deepseek-harness (also set by the Linux target patch);
// - the upstream product icon, installed at standard hicolor sizes (assets/icons,
//   rendered from upstream apps/desktop/resources/icon.png);
// - `desktopName` in packaged metadata plus `linux.syncDesktopName`, so Electron derives
//   WM_CLASS `deepseek-harness` and the installed `.desktop` entry gets
//   `StartupWMClass=deepseek-harness` (verified with `xprop` against the running app);
// - the fpm metadata (homepage, maintainer) deb/rpm/pacman require.
//
// The factory derives its output directory from DSH_DESKTOP_* and writes unsigned
// artifacts, so the build script must run with DSH_DESKTOP_TARGET_PLATFORM=linux,
// DSH_DESKTOP_TARGET_ARCH=x64, DSH_DESKTOP_UNSIGNED=1, and DSH_DESKTOP_APP_ID set.

import { fileURLToPath } from 'node:url'
import { createElectronBuilderConfig } from '../upstream/apps/desktop/scripts/electron-builder-config.mjs'

/** Standard hicolor icon sizes resolved from the upstream product icon (see assets/icons/). */
const ICON_DIRECTORY = fileURLToPath(new URL('./assets/icons', import.meta.url))

/** Packaged desktop identity Electron uses for WM_CLASS and the installed .desktop filename. */
const DESKTOP_NAME = 'deepseek-harness.desktop'

/** Source project the release is built from; fpm requires a package URL. */
const HOMEPAGE = 'https://github.com/deepseek-ai/deepseek-harness'

/** Upstream package author, used as the fpm maintainer because the manifest has no email. */
const MAINTAINER = 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.'

const upstream = createElectronBuilderConfig(process.env)

/** fpm package identity; the product name has a space and is not a valid package name. */
const fpmOptions = { packageName: 'deepseek-harness', maintainer: MAINTAINER }

// Electron-builder's default fpm dependencies miss libasound and libgbm, which the
// Electron binary links but which the minimal Debian/Ubuntu/Arch images do not pull in
// transitively. The pacman list also drops http-parser and libappindicator-gtk3, neither
// of which is in the Arch official repositories (verified against archlinux:latest).
const DEB_DEPENDS = [
  'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
  'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libasound2', 'libgbm1',
]
const PACMAN_DEPENDS = [
  'alsa-lib', 'c-ares', 'ffmpeg', 'gtk3', 'libevent', 'libvpx', 'libxslt',
  'libxss', 'minizip', 'nss', 're2', 'snappy', 'libnotify',
]
// Same libasound gap for rpm; package names differ between Fedora and openSUSE, so use
// rich dependencies that resolve on both.
const RPM_DEPENDS = [
  'gtk3', 'libnotify', 'nss', 'libXScrnSaver', '(libXtst or libXtst6)', 'xdg-utils',
  'at-spi2-core', '(libuuid or libuuid1)', '(alsa-lib or libasound2)', '(mesa-libgbm or libgbm1)',
]

export default {
  ...upstream,
  extraMetadata: {
    ...upstream.extraMetadata,
    // Merged into the packaged package.json; Electron reads `desktopName` as its app id.
    desktopName: DESKTOP_NAME,
    homepage: HOMEPAGE,
  },
  linux: {
    ...upstream.linux,
    category: 'Development',
    executableName: 'deepseek-harness',
    icon: ICON_DIRECTORY,
    // Install as /usr/share/applications/deepseek-harness.desktop with the matching WM class.
    syncDesktopName: true,
    maintainer: MAINTAINER,
    target: ['AppImage', 'deb', 'rpm', 'pacman'],
  },
  // fpm reads packageName from each package target, not from `linux`.
  deb: { ...upstream.deb, ...fpmOptions, depends: DEB_DEPENDS },
  rpm: { ...upstream.rpm, ...fpmOptions, depends: RPM_DEPENDS },
  // Arch packages are zstd-compressed; the release file name is .pkg.tar.zst.
  pacman: { ...upstream.pacman, ...fpmOptions, compression: 'zstd', depends: PACMAN_DEPENDS },
}
