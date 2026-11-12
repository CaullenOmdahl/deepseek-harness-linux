// Pre-publish verification: the four artifacts, `SHA256SUMS`, and
// `linux-update.json` must agree before anything is signed or published.
//
// CLI: node linux/scripts/verify-artifacts.mjs --dir <dir> --version <version>
// Exits 0 when the release is complete and consistent, 1 with one line per
// problem otherwise, and 2 on usage errors.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSums, sha256File, SUMS_NAME } from '../lib/checksums.mjs'
import { expectedAssets, MANIFEST_NAME } from '../lib/manifest.mjs'

const USAGE = 'usage: node linux/scripts/verify-artifacts.mjs --dir <dir> --version <version>'

/** One or more release problems, each preserved as its own `problems` entry. */
export class ArtifactError extends Error {
  constructor(problems) {
    const list = (Array.isArray(problems) ? problems : [problems]).map(String)
    super(list.join('\n'))
    this.name = 'ArtifactError'
    this.problems = list
  }
}

function describe(value) {
  return JSON.stringify(value) ?? String(value)
}

function readSums(path, problems) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    problems.push(error.code === 'ENOENT' ? `${SUMS_NAME} is missing` : `cannot read ${SUMS_NAME}: ${error.message}`)
    return null
  }
  try {
    return parseSums(text)
  } catch (error) {
    problems.push(`${SUMS_NAME} is malformed: ${error.message}`)
    return null
  }
}

function readManifest(path, version, problems) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    problems.push(error.code === 'ENOENT' ? `${MANIFEST_NAME} is missing` : `cannot read ${MANIFEST_NAME}: ${error.message}`)
    return null
  }

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    problems.push(`${MANIFEST_NAME} is not valid JSON: ${error.message}`)
    return null
  }

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push(`${MANIFEST_NAME} must be a JSON object`)
    return null
  }
  if (manifest.version !== version) {
    problems.push(`${MANIFEST_NAME} version is ${describe(manifest.version)}, expected ${describe(version)}`)
  }
  if (manifest.assets === null || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    problems.push(`${MANIFEST_NAME} has no assets object`)
    return null
  }
  return manifest
}

/**
 * Verify that `dir` holds a complete, consistent release for `version`.
 * Returns `{ ok: true, assets }` or throws `ArtifactError` listing every problem.
 */
export function verifyArtifacts({ dir, version }) {
  if (!dir) throw new Error('verifyArtifacts requires a dir')
  if (!version) throw new Error('verifyArtifacts requires a version')

  const problems = []
  const sums = readSums(join(dir, SUMS_NAME), problems)
  const manifest = readManifest(join(dir, MANIFEST_NAME), version, problems)
  const assets = []

  for (const { format, arch, name } of expectedAssets(version)) {
    const key = `${format}/${arch}`

    const listed = sums?.get(name)
    if (sums && listed === undefined) problems.push(`${SUMS_NAME} is missing an entry for ${name}`)

    const path = join(dir, name)
    if (!existsSync(path)) {
      problems.push(`missing artifact: ${name}`)
      continue
    }

    const sha256 = sha256File(path)
    const { size } = statSync(path)
    if (listed !== undefined && listed !== sha256) {
      problems.push(`checksum mismatch for ${name}: ${SUMS_NAME} lists ${listed}, file is ${sha256}`)
    }

    if (manifest) {
      const entry = manifest.assets[key]
      if (entry === null || typeof entry !== 'object') {
        problems.push(`${MANIFEST_NAME} is missing the ${key} asset`)
      } else {
        if (entry.name !== name) {
          problems.push(`${MANIFEST_NAME} ${key} names ${describe(entry.name)}, expected ${describe(name)}`)
        }
        if (entry.sha256 !== sha256) {
          problems.push(`${MANIFEST_NAME} ${key} sha256 does not match ${name}`)
        }
        if (entry.size !== size) {
          problems.push(`${MANIFEST_NAME} ${key} size does not match ${name}`)
        }
      }
    }

    assets.push({ format, arch, name, size, sha256 })
  }

  if (problems.length > 0) throw new ArtifactError(problems)
  return { ok: true, assets }
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
    if (!['dir', 'version'].includes(key)) throw new Error(`unknown option: --${key}`)
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

  const { dir, version } = options
  if (!dir || !version) {
    console.error(`--dir and --version are required\n${USAGE}`)
    return 2
  }

  try {
    const { assets } = verifyArtifacts({ dir, version })
    console.log(`verified ${assets.length} artifacts for ${version}`)
    return 0
  } catch (error) {
    if (error instanceof ArtifactError) {
      for (const problem of error.problems) console.error(problem)
      return 1
    }
    console.error(error.message)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
