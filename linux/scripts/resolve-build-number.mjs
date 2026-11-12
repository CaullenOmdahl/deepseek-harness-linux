// Resolve the Linux build number one dispatch publishes.
//
// CLI: node linux/scripts/resolve-build-number.mjs --version <version> \
//        --releases-file <file> [--requested <n>] [--github-output <file>]
//
// An explicit requested number is used only when its release tag is still free;
// otherwise the number is the next unused one for this upstream version. The
// resolved tag is written to GITHUB_OUTPUT so the rest of the build uses exactly
// the number this check accepted.

import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { nextBuildNumber, releaseTag } from '../lib/release.mjs'

const USAGE = 'usage: node linux/scripts/resolve-build-number.mjs --version <version> --releases-file <file> [--requested <n>] [--github-output <file>]'

/** A build number cannot be resolved: the release tag exists or the input is invalid. */
export class BuildNumberError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BuildNumberError'
  }
}

/** Split a release-tag listing into non-empty trimmed tag names. */
export function releaseTagsFromText(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Resolve the build number and release tag for `version`.
 * @param {{ version: string, releaseTags: string[], requested?: number }} input
 * @returns {{ buildNumber: number, tag: string }}
 */
export function resolveBuildNumber({ version, releaseTags, requested }) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new BuildNumberError('version is required')
  }
  const tags = Array.isArray(releaseTags) ? releaseTags : []

  if (requested !== undefined && requested !== null) {
    if (!Number.isInteger(requested) || requested < 1) {
      throw new BuildNumberError(`requested build number must be a positive integer, got ${JSON.stringify(requested)}`)
    }
    const tag = releaseTag(version, requested)
    if (tags.includes(tag)) {
      throw new BuildNumberError(`release ${tag} already exists; dispatch a new build number`)
    }
    return { buildNumber: requested, tag }
  }

  const buildNumber = nextBuildNumber(version, tags)
  return { buildNumber, tag: releaseTag(version, buildNumber) }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new BuildNumberError(`unexpected argument: ${arg}`)
    const separator = arg.indexOf('=')
    if (separator !== -1) {
      options[arg.slice(2, separator)] = arg.slice(separator + 1)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new BuildNumberError(`missing value for ${arg}`)
    options[arg.slice(2)] = value
    index += 1
  }
  for (const key of Object.keys(options)) {
    if (!['version', 'releases-file', 'requested', 'github-output'].includes(key)) {
      throw new BuildNumberError(`unknown option: --${key}`)
    }
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

  const { version, 'releases-file': releasesFile } = options
  if (!version || !releasesFile) {
    console.error(`--version and --releases-file are required\n${USAGE}`)
    return 2
  }

  try {
    const requested = options.requested === undefined ? undefined : Number(options.requested)
    const tags = releaseTagsFromText(readFileSync(releasesFile, 'utf8'))
    const { buildNumber, tag } = resolveBuildNumber({ version, releaseTags: tags, requested })
    if (options['github-output']) {
      appendFileSync(options['github-output'], `build_number=${buildNumber}\ntag=${tag}\n`)
    }
    console.log(`resolved build ${buildNumber} for ${version} (${tag})`)
    return 0
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
