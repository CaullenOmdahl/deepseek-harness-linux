// tests/linux/verify-artifacts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArtifacts, ArtifactError } from '../../linux/scripts/verify-artifacts.mjs'
import { writeReleaseMetadata } from '../../linux/scripts/assemble-release.mjs'
import { artifactName } from '../../linux/lib/release.mjs'

const VERSION = '0.2.2-rc.1'

function releaseDir(version) {
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  for (const format of ['appimage', 'deb', 'rpm', 'pacman']) writeFileSync(join(dir, artifactName(format, version)), format)
  writeReleaseMetadata({ dir, version, tag: `v${version}-linux.1` })
  return dir
}

function editManifest(dir, edit) {
  const path = join(dir, 'linux-update.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  edit(manifest)
  writeFileSync(path, JSON.stringify(manifest))
}

function problemsFor(dir, version = VERSION) {
  try {
    verifyArtifacts({ dir, version })
  } catch (error) {
    assert.ok(error instanceof ArtifactError, `expected ArtifactError, got ${error}`)
    return error.problems
  }
  assert.fail('expected verifyArtifacts to throw')
}

test('accepts a complete release', () => {
  const dir = releaseDir('0.2.2-rc.1')
  assert.equal(verifyArtifacts({ dir, version: '0.2.2-rc.1' }).ok, true)
})

test('rejects a checksum mismatch', () => {
  const dir = releaseDir('0.2.2-rc.1')
  writeFileSync(join(dir, artifactName('rpm', '0.2.2-rc.1')), 'tampered')
  assert.throws(() => verifyArtifacts({ dir, version: '0.2.2-rc.1' }), ArtifactError)
})

test('rejects an absolute path checksum entry', () => {
  const dir = releaseDir(VERSION)
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  /etc/passwd\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS contains an unsafe path: "/etc/passwd"'),
    problems.join('\n'),
  )
})

test('rejects a relative traversal checksum entry', () => {
  const dir = releaseDir(VERSION)
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  ../evil\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS contains an unsafe path: "../evil"'),
    problems.join('\n'),
  )
})

test('rejects a stray checksum entry', () => {
  const dir = releaseDir(VERSION)
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  evil.txt\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS has an unexpected entry for "evil.txt"'),
    problems.join('\n'),
  )
})

test('rejects an extra manifest asset key', () => {
  const dir = releaseDir(VERSION)
  editManifest(dir, (manifest) => {
    manifest.assets['zip/x86_64'] = { name: 'evil-absolute.zip', size: 1, sha256: 'ab' }
  })
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'linux-update.json has an unexpected asset key: "zip/x86_64"'),
    problems.join('\n'),
  )
})

test('rejects a manifest without tag', () => {
  const dir = releaseDir(VERSION)
  editManifest(dir, (manifest) => {
    delete manifest.tag
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('tag')), problems.join('\n'))
})

test('rejects a manifest without generatedAt', () => {
  const dir = releaseDir(VERSION)
  editManifest(dir, (manifest) => {
    delete manifest.generatedAt
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('generatedAt')), problems.join('\n'))
})

test('rejects a manifest with a non-ISO generatedAt', () => {
  const dir = releaseDir(VERSION)
  editManifest(dir, (manifest) => {
    manifest.generatedAt = 'yesterday'
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('generatedAt')), problems.join('\n'))
})
