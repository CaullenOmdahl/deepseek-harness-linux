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
// - an overlay package identity: unofficial maintainers, overlay homepage, a valid deb
//   Section, and a deb copyright file. Upstream authorship stays in LICENSE/NOTICE;
// - top-level `buildNumber`, which electron-builder maps to the fpm iteration/release,
//   so a `-linux.2` package upgrades a `-linux.1` package of the same upstream version.
//
// The factory derives its output directory from DSH_DESKTOP_* and writes unsigned
// artifacts, so the build script must run with DSH_DESKTOP_TARGET_PLATFORM=linux,
// DSH_DESKTOP_TARGET_ARCH=x64, DSH_DESKTOP_UNSIGNED=1, DSH_DESKTOP_APP_ID set, and a
// positive BUILD_NUMBER.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElectronBuilderConfig } from '../upstream/apps/desktop/scripts/electron-builder-config.mjs'
import { fixPackagedSharp } from './scripts/rebuild-sharp-native.mjs'

/** Standard hicolor icon sizes resolved from the upstream product icon (see assets/icons/). */
const ICON_DIRECTORY = fileURLToPath(new URL('./assets/icons', import.meta.url))

/** Packaged desktop identity Electron uses for WM_CLASS and the installed .desktop filename. */
const DESKTOP_NAME = 'deepseek-harness.desktop'

/** Overlay project the package points at; npm/deb metadata must not claim upstream support. */
const HOMEPAGE = 'https://github.com/CaullenOmdahl/deepseek-harness-linux'

/** Unofficial packaging identity. `invalid` is the reserved TLD, so this address cannot deliver mail. */
const MAINTAINER = 'DSH Linux maintainers <dsh-linux@invalid>'

/** Vendor shown by rpm/pacman metadata; the Debian Maintainer field uses MAINTAINER. */
const VENDOR = 'DSH Linux maintainers'

/** Debian policy copyright file installed by fpm (the deb target does not create one). */
const DEB_COPYRIGHT = fileURLToPath(new URL('./assets/deb-copyright', import.meta.url))

/** libvips built by linux/scripts/build-libvips.sh; bundled so sharp's images decode. */
const VIPS_PREFIX = process.env.DSH_VIPS_PREFIX?.trim() ?? ''
if (VIPS_PREFIX === '') {
  throw new Error('linux packaging: DSH_VIPS_PREFIX is required; run linux/build/build.sh')
}

/** Electron version the tree was prepared with; the addon rebuild needs the exact ABI. */
const ELECTRON_VERSION = process.env.DSH_ELECTRON_VERSION?.trim() ?? ''

/** Top-level LICENSE and NOTICE bundled inside every package's resources directory. */
const LICENSE = fileURLToPath(new URL('../LICENSE', import.meta.url))
const NOTICE = fileURLToPath(new URL('../NOTICE', import.meta.url))

const buildNumber = process.env.BUILD_NUMBER?.trim() ?? ''
if (!/^[1-9][0-9]*$/.test(buildNumber)) {
  throw new Error(`linux packaging: BUILD_NUMBER must be a positive integer, got ${JSON.stringify(process.env.BUILD_NUMBER)}`)
}

const upstream = createElectronBuilderConfig(process.env)

/** fpm package identity; the product name has a space and is not a valid package name. */
const fpmOptions = { packageName: 'deepseek-harness', maintainer: MAINTAINER, vendor: VENDOR }

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
  // Maps to the fpm iteration/release and the AppImage version suffix.
  buildNumber,
  extraMetadata: {
    ...upstream.extraMetadata,
    // Merged into the packaged package.json; Electron reads `desktopName` as its app id.
    desktopName: DESKTOP_NAME,
    homepage: HOMEPAGE,
  },
  extraResources: [
    ...(upstream.extraResources ?? []),
    { from: LICENSE, to: 'LICENSE' },
    { from: NOTICE, to: 'NOTICE' },
    // Self-contained libvips: sharp's prebuilt addon cannot be used inside Electron (its
    // statically linked glib corrupts GObject state), so the app carries this build.
    { from: path.join(VIPS_PREFIX, 'lib'), to: 'libvips/lib', filter: ['libvips*.so*'] },
    { from: path.join(VIPS_PREFIX, 'lib', 'bundle'), to: 'libvips/lib/bundle' },
  ],
  // Rebuild sharp's addon against the packaged Electron version and the bundled libvips,
  // then prove a decode works with the packaged binary. A crash here fails the build.
  afterPack: async (context) => {
    fixPackagedSharp({
      appOutDir: context.appOutDir,
      libvipsPrefix: VIPS_PREFIX,
      electronVersion: ELECTRON_VERSION,
    })
  },
  linux: {
    ...upstream.linux,
    category: 'Development',
    executableName: 'deepseek-harness',
    icon: ICON_DIRECTORY,
    // Install as /usr/share/applications/deepseek-harness.desktop with the matching WM class.
    syncDesktopName: true,
    maintainer: MAINTAINER,
    vendor: VENDOR,
    target: ['AppImage', 'deb', 'rpm', 'pacman'],
  },
  // fpm reads packageName from each package target, not from `linux`.
  deb: {
    ...upstream.deb,
    ...fpmOptions,
    // A valid Debian archive section; electron-builder's default is the invalid `default`.
    packageCategory: 'utils',
    // fpm supports extra `source=destination` mappings; this ships the policy copyright file.
    fpm: [`${DEB_COPYRIGHT}=/usr/share/doc/deepseek-harness/copyright`],
    depends: DEB_DEPENDS,
  },
  rpm: { ...upstream.rpm, ...fpmOptions, packageCategory: 'Applications/Productivity', depends: RPM_DEPENDS },
  // Arch packages are zstd-compressed; the release file name is .pkg.tar.zst.
  pacman: { ...upstream.pacman, ...fpmOptions, compression: 'zstd', depends: PACMAN_DEPENDS },
}
