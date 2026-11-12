// Apply the overlay's Linux patch series to an upstream checkout.
//
// CLI: node linux/scripts/apply-patches.mjs --series <dir> --target <dir>
// The module export is the programmatic entry point; importing must not run the CLI.

import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const USAGE = 'usage: node linux/scripts/apply-patches.mjs --series <dir> --target <dir>'

export class PatchConflictError extends Error {
  constructor(patchFile, stderr) {
    const detail = String(stderr ?? '').trim()
    super(`patch ${patchFile} does not apply${detail ? `:\n${detail}` : ''}`)
    this.name = 'PatchConflictError'
    this.patchFile = patchFile
    this.stderr = detail
  }
}

function gitApply(targetDir, args) {
  return spawnSync('git', ['-C', targetDir, 'apply', ...args], { encoding: 'utf8' })
}

export function applyPatches({ seriesDir, targetDir }) {
  const patches = readdirSync(seriesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.patch'))
    .map((entry) => entry.name)
    .sort()

  const applied = []
  const skipped = []

  for (const name of patches) {
    const patchPath = resolve(seriesDir, name)

    const check = gitApply(targetDir, ['--check', patchPath])
    if (check.status === 0) {
      const result = gitApply(targetDir, [patchPath])
      if (result.status !== 0) {
        throw new PatchConflictError(name, result.stderr)
      }
      applied.push(name)
      continue
    }

    const reverseCheck = gitApply(targetDir, ['--reverse', '--check', patchPath])
    if (reverseCheck.status === 0) {
      skipped.push(name)
      continue
    }

    throw new PatchConflictError(name, check.stderr)
  }

  return { applied, skipped }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--series' && arg !== '--target') throw new Error(`unexpected argument: ${arg}`)
    if (Object.hasOwn(options, arg.slice(2))) throw new Error(`duplicate option: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
    options[arg.slice(2)] = value
    index += 1
  }
  for (const name of ['series', 'target']) {
    if (options[name] === undefined) throw new Error(`--${name} is required`)
  }
  return options
}

function requireDirectory(path, label) {
  let stats
  try {
    stats = statSync(path)
  } catch {
    throw new Error(`${label} directory does not exist: ${path}`)
  }
  if (!stats.isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
}

export function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`)
    return 2
  }

  const seriesDir = resolve(options.series)
  const targetDir = resolve(options.target)
  try {
    requireDirectory(seriesDir, '--series')
    requireDirectory(targetDir, '--target')
    const { applied, skipped } = applyPatches({ seriesDir, targetDir })
    for (const name of applied) console.log(`applied ${name}`)
    for (const name of skipped) console.log(`already applied ${name}`)
    console.log(`patch series: ${applied.length} applied, ${skipped.length} already applied`)
    return 0
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
