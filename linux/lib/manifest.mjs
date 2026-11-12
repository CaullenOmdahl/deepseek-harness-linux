// The machine-readable release manifest (`linux-update.json`).
// Artifacts are keyed `<format>/<arch>`; names come from `artifactName`
// so the manifest can never drift from the actual file names.

import { artifactName } from './release.mjs'

export const MANIFEST_NAME = 'linux-update.json'

/** Every package format a Linux release ships, in canonical order. */
export const FORMATS = Object.freeze(['appimage', 'deb', 'rpm', 'pacman'])

/** The only architecture shipped in v1; every manifest key ends in `x86_64`. */
export const ARCH = 'x86_64'

/** The four artifacts a complete release for `version` must contain. */
export function expectedAssets(version, arch = ARCH) {
  return FORMATS.map((format) => ({ format, arch, name: artifactName(format, version) }))
}

/** Reject anything that is not the 1-based Linux build number this release publishes. */
export function assertBuildNumber(buildNumber) {
  if (!Number.isInteger(buildNumber) || buildNumber < 1) {
    throw new Error(`build number must be a positive integer, got ${JSON.stringify(buildNumber)}`)
  }
  return buildNumber
}

/**
 * Build the update manifest:
 * `{ version, tag, buildNumber, generatedAt, assets: { '<format>/<arch>': { name, size, sha256 } } }`.
 * `buildNumber` is the Linux rebuild counter; Plan 2's updater compares the
 * `(version, buildNumber)` pair, and package managers order rebuilds by it.
 */
export function buildManifest({ version, tag, buildNumber, assets }) {
  assertBuildNumber(buildNumber)
  const map = {}
  for (const asset of assets) {
    map[`${asset.format}/${asset.arch ?? ARCH}`] = {
      name: asset.name,
      size: asset.size,
      sha256: asset.sha256,
    }
  }
  return { version, tag, buildNumber, generatedAt: new Date().toISOString(), assets: map }
}
