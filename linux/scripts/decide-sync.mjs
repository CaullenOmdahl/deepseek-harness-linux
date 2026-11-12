// Decide whether the npm `latest` version still needs a Linux release.
//
// CLI: node linux/scripts/decide-sync.mjs --latest <version> --releases-file <path>
// The releases file is one release tag per line (e.g. from
// `gh release list --json tagName`). The CLI prints the `$GITHUB_OUTPUT` lines
// `action=build|none` and `version=<version>`; it exits 1 on unreadable input
// and 2 on usage errors.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { decideSync } from '../lib/release.mjs'
import { isVersion, releaseTagsFromList } from './resolve-upstream.mjs'

const USAGE = 'usage: node linux/scripts/decide-sync.mjs --latest <version> --releases-file <path>'

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
    if (!['latest', 'releases-file'].includes(key)) throw new Error(`unknown option: --${key}`)
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

  const latestVersion = options.latest
  const releasesFile = options['releases-file']
  const missing = []
  if (!latestVersion) missing.push('--latest')
  if (!releasesFile) missing.push('--releases-file')
  if (missing.length > 0) {
    console.error(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required\n${USAGE}`)
    return 2
  }
  if (!isVersion(latestVersion)) {
    // The version is echoed into $GITHUB_OUTPUT; never pass a malformed one on.
    console.error(`invalid --latest version: ${JSON.stringify(latestVersion)}\n${USAGE}`)
    return 2
  }

  let lines
  try {
    lines = readFileSync(releasesFile, 'utf8').split(/\r?\n/)
  } catch (error) {
    console.error(`cannot read ${releasesFile}: ${error.message}`)
    return 1
  }

  const { action } = decideSync({ latestVersion, releaseTags: releaseTagsFromList(lines) })
  console.log(`action=${action}`)
  console.log(`version=${latestVersion}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
