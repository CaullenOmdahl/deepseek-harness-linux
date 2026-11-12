// Release model for the DeepSeek Harness Linux overlay.
// Pure helpers: no I/O, no environment access.

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Release tag for a Linux build of an upstream version, e.g. `v0.2.2-rc.1-linux.3`. */
export function releaseTag(version, n) {
  return `v${version}-linux.${n}`
}

/** The next build number for `version`, counting only release tags of that exact version. */
export function nextBuildNumber(version, tags) {
  const pattern = new RegExp(`^v${escapeRegex(version)}-linux\\.(\\d+)$`)
  let max = 0
  for (const tag of tags ?? []) {
    const match = pattern.exec(tag)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

const ARTIFACT_NAMES = {
  appimage: (version) => `deepseek-harness-${version}-x86_64.AppImage`,
  deb: (version) => `deepseek-harness_${version}_amd64.deb`,
  rpm: (version) => `deepseek-harness-${version}-1.x86_64.rpm`,
  pacman: (version) => `deepseek-harness-${version}-1-x86_64.pkg.tar.zst`,
}

/** Deterministic artifact file name for a package format and upstream version. */
export function artifactName(format, version) {
  const namer = ARTIFACT_NAMES[format]
  if (!namer) throw new Error(`unknown artifact format: ${format}`)
  return namer(version)
}

/**
 * The package-manager version a format carries for an upstream version,
 * mirroring electron-builder's Linux version sanitizer: deb/rpm use `~` where
 * semver has `-`, pacman substitutes `_`, and the AppImage keeps the semver.
 */
export function packageVersion(format, version) {
  switch (format) {
    case 'appimage':
      return String(version)
    case 'deb':
    case 'rpm':
      return String(version).replace(/-/g, '~')
    case 'pacman':
      return String(version).replace(/-/g, '_')
    default:
      throw new Error(`unknown artifact format: ${format}`)
  }
}

/** The release iteration/revision one Linux build number maps to. */
export function packageIteration(buildNumber) {
  if (!Number.isInteger(buildNumber) || buildNumber < 1) {
    throw new Error(`build number must be a positive integer, got ${JSON.stringify(buildNumber)}`)
  }
  return String(buildNumber)
}

/**
 * The version string package managers order rebuilds by: `<sanitized version>-<iteration>`.
 * For the same upstream version, `-linux.2` therefore outranks `-linux.1`.
 */
export function packageRelease(format, version, buildNumber) {
  if (!['deb', 'rpm', 'pacman'].includes(format)) {
    throw new Error(`unknown package format: ${format}`)
  }
  return `${packageVersion(format, version)}-${packageIteration(buildNumber)}`
}

/** Decide whether the latest upstream version still needs a Linux release built. */
export function decideSync({ latestVersion, releaseTags }) {
  const prefix = `v${latestVersion}-linux.`
  const released = (releaseTags ?? []).some((tag) => tag.startsWith(prefix))
  return released ? { action: 'none' } : { action: 'build', version: latestVersion }
}
