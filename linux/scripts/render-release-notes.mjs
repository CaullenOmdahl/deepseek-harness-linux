// Render the GitHub release body from the committed template.
//
// CLI: node linux/scripts/render-release-notes.mjs --template <file> --output <file> \
//        --version <version> --tag <tag> --build-number <n> --run-url <url> \
//        [--summary-file <file>]
//
// The template is committed so every automated release keeps the unofficial
// disclaimer, install commands, verification recipe, and known limitations.
// Substitution refuses to emit a body with an unknown or unresolved placeholder.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const USAGE = 'usage: node linux/scripts/render-release-notes.mjs --template <file> --output <file> --version <version> --tag <tag> --build-number <n> --run-url <url> [--summary-file <file>]'

/** Default verification summary used when CI has no detailed summary to attach. */
export const DEFAULT_VERIFICATION_SUMMARY = [
  'All release gates passed: exact-artifact verification and manifest/tag/build-number checks,',
  'container install tests on Debian 12, Ubuntu 22.04, Fedora 44, openSUSE Tumbleweed, and Arch Linux,',
  'an AppImage boot/window-title smoke on Xvfb, and detached GPG signature verification against the',
  'committed public key.',
].join(' ')

const PLACEHOLDER_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g

/**
 * Render the release body.
 * @param {{ template: string, version: string, tag: string, buildNumber: number, runUrl: string, verificationSummary?: string }} input
 * @returns {string} Markdown body with exactly one trailing newline.
 */
export function renderReleaseNotes({ template, version, tag, buildNumber, runUrl, verificationSummary = DEFAULT_VERIFICATION_SUMMARY }) {
  if (typeof template !== 'string' || template.trim() === '') throw new Error('release notes template is empty')
  if (!version) throw new Error('release notes require a version')
  if (!tag) throw new Error('release notes require a tag')
  if (!Number.isInteger(buildNumber) || buildNumber < 1) throw new Error(`release notes require a positive build number, got ${JSON.stringify(buildNumber)}`)
  if (!runUrl) throw new Error('release notes require the CI run URL')

  const values = new Map([
    ['VERSION', version],
    ['TAG', tag],
    ['BUILD_NUMBER', String(buildNumber)],
    ['RUN_URL', runUrl],
    ['VERIFICATION_SUMMARY', verificationSummary],
  ])

  const rendered = template.replace(PLACEHOLDER_PATTERN, (_, name) => {
    if (!values.has(name)) throw new Error(`unknown release notes placeholder: {{${name}}}`)
    return values.get(name)
  })

  // A placeholder split across the replacements must still be reported, not shipped.
  const unresolved = rendered.match(PLACEHOLDER_PATTERN)
  if (unresolved) throw new Error(`unresolved release notes placeholder: ${unresolved[0]}`)

  return `${rendered.trimEnd()}\n`
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
    if (!['template', 'output', 'version', 'tag', 'build-number', 'run-url', 'summary-file'].includes(key)) {
      throw new Error(`unknown option: --${key}`)
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

  const { template, output, version, tag, 'run-url': runUrl } = options
  if (!template || !output || !version || !tag || !runUrl || options['build-number'] === undefined) {
    console.error(`--template, --output, --version, --tag, --build-number and --run-url are required\n${USAGE}`)
    return 2
  }

  try {
    const summary = options['summary-file'] === undefined ? undefined : readFileSync(options['summary-file'], 'utf8').trim()
    const body = renderReleaseNotes({
      template: readFileSync(template, 'utf8'),
      version,
      tag,
      buildNumber: Number(options['build-number']),
      runUrl,
      ...(summary === undefined || summary === '' ? {} : { verificationSummary: summary }),
    })
    writeFileSync(output, body)
    console.log(`wrote ${output} (${body.split('\n').length} lines)`)
    return 0
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
