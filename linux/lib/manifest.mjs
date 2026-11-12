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

/**
 * Build the update manifest:
 * `{ version, tag, generatedAt, assets: { '<format>/<arch>': { name, size, sha256 } } }`.
 */
export function buildManifest({ version, tag, assets }) {
  const map = {}
  for (const asset of assets) {
    map[`${asset.format}/${asset.arch ?? ARCH}`] = {
      name: asset.name,
      size: asset.size,
      sha256: asset.sha256,
    }
  }
  return { version, tag, generatedAt: new Date().toISOString(), assets: map }
}
