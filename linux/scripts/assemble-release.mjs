// Assemble the release metadata: `SHA256SUMS` and `linux-update.json`.
//
// CLI: node linux/scripts/assemble-release.mjs --dir <dir> --version <version> --tag <tag> --build-number <n>
// The directory must already contain the four artifacts named by `artifactName`.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { formatSums, sha256File, SUMS_NAME } from '../lib/checksums.mjs'
import { assertBuildNumber, buildManifest, expectedAssets, MANIFEST_NAME } from '../lib/manifest.mjs'

const USAGE = 'usage: node linux/scripts/assemble-release.mjs --dir <dir> --version <version> --tag <tag> --build-number <n>'

/** Describe every artifact in `dir` with its size and SHA-256, in canonical order. */
export function collectAssets({ dir, version }) {
  return expectedAssets(version).map((asset) => {
    const path = join(dir, asset.name)
    if (!existsSync(path)) throw new Error(`missing artifact: ${asset.name} (looked in ${dir})`)
    const { size } = statSync(path)
    return { ...asset, size, sha256: sha256File(path) }
  })
}

/**
 * Write `SHA256SUMS` and `linux-update.json` for the artifacts in `dir`.
 * Returns the manifest. Throws when any of the four artifacts is missing or the
 * build number is not a positive integer.
 */
export function writeReleaseMetadata({ dir, version, tag, buildNumber }) {
  if (!dir) throw new Error('writeReleaseMetadata requires a dir')
  if (!version) throw new Error('writeReleaseMetadata requires a version')
  if (!tag) throw new Error('writeReleaseMetadata requires a tag')
  assertBuildNumber(buildNumber)

  const assets = collectAssets({ dir, version })
  const sums = formatSums(assets)
  const manifest = buildManifest({ version, tag, buildNumber, assets })

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, SUMS_NAME), sums)
  writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const separator = arg.indexOf('=')
    if (separator !== -1) {
      options[arg.slice(2, separator)] = arg.slice(separator + 1)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
    options[arg.slice(2)] = value
    index += 1
  }
  for (const key of Object.keys(options)) {
    if (!['dir', 'version', 'tag', 'build-number'].includes(key)) throw new Error(`unknown option: --${key}`)
  }
  return options
}

export function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`)
    return 2
  }

  const { dir, version, tag } = options
  const buildNumber = Number(options['build-number'])
  if (!dir || !version || !tag || options['build-number'] === undefined) {
    console.error(`--dir, --version, --tag and --build-number are required\n${USAGE}`)
    return 2
  }

  try {
    const manifest = writeReleaseMetadata({ dir, version, tag, buildNumber })
    const count = Object.keys(manifest.assets).length
    console.log(`wrote ${SUMS_NAME} and ${MANIFEST_NAME} for ${tag} (${count} assets)`)
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
