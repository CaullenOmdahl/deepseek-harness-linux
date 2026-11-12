import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

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
