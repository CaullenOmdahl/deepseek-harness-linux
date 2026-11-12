// The exact file set one Linux GitHub release publishes. Keeping the list here
// means the publish step, the verifier, and the docs cannot disagree about the
// asset count (four packages + two metadata files + two signatures + the key).

import { SUMS_NAME } from './checksums.mjs'
import { expectedAssets, MANIFEST_NAME } from './manifest.mjs'

/** File name of the committed release signing public key. */
export const PUBKEY_NAME = 'dsh-linux-pubkey.asc'

/** Metadata files written by `assemble-release.mjs` and `sign-release.sh`. */
export const METADATA_NAMES = Object.freeze([SUMS_NAME, MANIFEST_NAME, `${SUMS_NAME}.asc`, `${MANIFEST_NAME}.asc`])

/** Every file name a complete release for `version` publishes, sorted. */
export function expectedReleaseFileNames(version) {
  return [...expectedAssets(version).map((asset) => asset.name), ...METADATA_NAMES, PUBKEY_NAME].sort()
}
