import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyPatches, PatchConflictError } from '../../linux/scripts/apply-patches.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'patch-'))
  const target = join(root, 'target')
  execFileSync('git', ['init', '-q', target])
  execFileSync('git', ['-C', target, 'config', 'user.email', 't@e'])
  execFileSync('git', ['-C', target, 'config', 'user.name', 'T'])
  writeFileSync(join(target, 'a.txt'), 'one\n')
  execFileSync('git', ['-C', target, 'add', '.'])
  execFileSync('git', ['-C', target, 'commit', '-qm', 'init'])
  const series = join(root, 'patches')
  mkdirSync(series)
  return { target, series }
}

test('applies a patch once and reports it already applied', () => {
  const { target, series } = fixture()
  writeFileSync(join(series, '0001-add-line.patch'),
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n one\n+two\n')
  assert.deepEqual(applyPatches({ seriesDir: series, targetDir: target }), { applied: ['0001-add-line.patch'], skipped: [] })
  assert.equal(readFileSync(join(target, 'a.txt'), 'utf8'), 'one\ntwo\n')
  assert.deepEqual(applyPatches({ seriesDir: series, targetDir: target }), { applied: [], skipped: ['0001-add-line.patch'] })
})

test('throws PatchConflictError when a patch cannot apply', () => {
  const { target, series } = fixture()
  writeFileSync(join(series, '0001-bad.patch'),
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n nope\n+two\n')
  assert.throws(() => applyPatches({ seriesDir: series, targetDir: target }), PatchConflictError)
})

const CLI = fileURLToPath(new URL('../../linux/scripts/apply-patches.mjs', import.meta.url))

test('CLI applies the series and reports already-applied patches', () => {
  const { target, series } = fixture()
  writeFileSync(join(series, '0001-add-line.patch'),
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n one\n+two\n')

  const first = spawnSync(process.execPath, [CLI, '--series', series, '--target', target], { encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /applied 0001-add-line\.patch/)

  const second = spawnSync(process.execPath, [CLI, '--series', series, '--target', target], { encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /already applied 0001-add-line\.patch/)
})

test('CLI rejects missing options without touching the target', () => {
  const { target, series } = fixture()
  const result = spawnSync(process.execPath, [CLI, '--series', series], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--target is required/)
  assert.equal(readFileSync(join(target, 'a.txt'), 'utf8'), 'one\n')
})

