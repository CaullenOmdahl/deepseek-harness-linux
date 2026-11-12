// Resolve the npm `latest` version of `@deepseek-ai/dsh` to its upstream git
// tag, and recognize this repo's Linux release tags.
//
// CLI: node linux/scripts/resolve-upstream.mjs --latest <version> --tags-file <path>
// The tags file may be raw `git ls-remote --tags` output (annotated-tag `^{}`
// lines included) or one plain tag name per line. On success it prints the
// `$GITHUB_OUTPUT` line `tag=dsh-v<version>`; it exits 1 when the tag is
// missing and 2 on usage errors.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const USAGE = 'usage: node linux/scripts/resolve-upstream.mjs --latest <version> --tags-file <path>'

// npm dist-tag values are semver; anything else would be pasted into
// `$GITHUB_OUTPUT`, so reject it rather than echo it back.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// Release tags are `v<upstream-version>-linux.<n>`; `[0-9A-Za-z.-]+` for the
// prerelease part is greedy and backtracks so `-linux.<n>` anchors the end.
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-linux\.\d+$/

/** True when `value` is an npm-compatible version string. */
export function isVersion(value) {
  return typeof value === 'string' && VERSION.test(value)
}

/** Raised when upstream has no `dsh-v<latestVersion>` tag. */
export class UpstreamError extends Error {
  constructor(tag, tagCount) {
    super(`upstream tag ${tag} is missing (checked ${tagCount} tag(s)); has the release been tagged upstream yet?`)
    this.name = 'UpstreamError'
    this.tag = tag
  }
}

// Normalize one entry of a tags/releases list: plain tag name, `refs/tags/<name>`
// from `git ls-remote`, and the `^{}` peeled line of an annotated tag.
function tagNameOf(entry) {
  const line = String(entry ?? '').trim()
  if (!line) return ''
  const marker = line.lastIndexOf('refs/tags/')
  const name = marker === -1 ? line : line.slice(marker + 'refs/tags/'.length)
  return name.endsWith('^{}') ? name.slice(0, -3) : name
}

/** Map the upstream `latest` version to the `dsh-v<version>` tag it must have. */
export function resolveUpstream({ latestVersion, tags } = {}) {
  const version = String(latestVersion ?? '').trim()
  if (!isVersion(version)) throw new Error(`invalid latest version: ${JSON.stringify(latestVersion)}`)

  const names = new Set(Array.isArray(tags) ? tags.map(tagNameOf).filter(Boolean) : [])
  const tag = `dsh-v${version}`
  if (!names.has(tag)) throw new UpstreamError(tag, names.size)
  return { version, tag }
}

/** Tags in `list` that are this repo's Linux release tags, in input order. */
export function releaseTagsFromList(list) {
  const tags = []
  for (const entry of list ?? []) {
    const tag = tagNameOf(entry)
    if (tag && RELEASE_TAG.test(tag) && !tags.includes(tag)) tags.push(tag)
  }
  return tags
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
    if (!['latest', 'tags-file'].includes(key)) throw new Error(`unknown option: --${key}`)
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
  const tagsFile = options['tags-file']
  const missing = []
  if (!latestVersion) missing.push('--latest')
  if (!tagsFile) missing.push('--tags-file')
  if (missing.length > 0) {
    console.error(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required\n${USAGE}`)
    return 2
  }

  let lines
  try {
    lines = readFileSync(tagsFile, 'utf8').split(/\r?\n/)
  } catch (error) {
    console.error(`cannot read ${tagsFile}: ${error.message}`)
    return 1
  }

  try {
    const { tag } = resolveUpstream({ latestVersion, tags: lines })
    console.log(`tag=${tag}`)
    return 0
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error(`error: ${error.message}`)
      return 1
    }
    console.error(`${error.message}\n${USAGE}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
