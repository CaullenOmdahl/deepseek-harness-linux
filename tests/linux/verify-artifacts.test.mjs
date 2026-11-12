// tests/linux/verify-artifacts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArtifacts, ArtifactError } from '../../linux/scripts/verify-artifacts.mjs'
import { writeReleaseMetadata } from '../../linux/scripts/assemble-release.mjs'
import { artifactName } from '../../linux/lib/release.mjs'
import { expectedReleaseFileNames } from '../../linux/lib/release-assets.mjs'

const VERSION = '0.2.2-rc.1'
const TAG = `v${VERSION}-linux.1`
const BUILD = 1

function releaseDir(version = VERSION) {
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  for (const format of ['appimage', 'deb', 'rpm', 'pacman']) writeFileSync(join(dir, artifactName(format, version)), format)
  writeReleaseMetadata({ dir, version, tag: `v${version}-linux.${BUILD}`, buildNumber: BUILD })
  return dir
}

function editManifest(dir, edit) {
  const path = join(dir, 'linux-update.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  edit(manifest)
  writeFileSync(path, JSON.stringify(manifest))
}

function problemsFor(dir, overrides = {}) {
  try {
    verifyArtifacts({ dir, version: VERSION, tag: TAG, buildNumber: BUILD, ...overrides })
  } catch (error) {
    assert.ok(error instanceof ArtifactError, `expected ArtifactError, got ${error}`)
    return error.problems
  }
  assert.fail('expected verifyArtifacts to throw')
}

test('accepts a complete release', () => {
  const dir = releaseDir()
  assert.equal(verifyArtifacts({ dir, version: VERSION, tag: TAG, buildNumber: BUILD }).ok, true)
})

test('rejects a checksum mismatch', () => {
  const dir = releaseDir()
  writeFileSync(join(dir, artifactName('rpm', VERSION)), 'tampered')
  assert.throws(() => verifyArtifacts({ dir, version: VERSION, tag: TAG, buildNumber: BUILD }), ArtifactError)
})

test('rejects an absolute path checksum entry', () => {
  const dir = releaseDir()
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  /etc/passwd\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS contains an unsafe path: "/etc/passwd"'),
    problems.join('\n'),
  )
})

test('rejects a relative traversal checksum entry', () => {
  const dir = releaseDir()
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  ../evil\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS contains an unsafe path: "../evil"'),
    problems.join('\n'),
  )
})

test('rejects a stray checksum entry', () => {
  const dir = releaseDir()
  appendFileSync(join(dir, 'SHA256SUMS'), `${'a'.repeat(64)}  evil.txt\n`)
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'SHA256SUMS has an unexpected entry for "evil.txt"'),
    problems.join('\n'),
  )
})

test('rejects an extra manifest asset key', () => {
  const dir = releaseDir()
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
  const dir = releaseDir()
  editManifest(dir, (manifest) => {
    delete manifest.tag
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('tag')), problems.join('\n'))
})

test('rejects a manifest tag that is not the dispatched tag', () => {
  const dir = releaseDir()
  editManifest(dir, (manifest) => {
    manifest.tag = 'v0.2.2-rc.1-linux.9'
  })
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'linux-update.json tag is "v0.2.2-rc.1-linux.9", expected "v0.2.2-rc.1-linux.1"'),
    problems.join('\n'),
  )
})

test('rejects a manifest with a missing or mismatched buildNumber', () => {
  const dir = releaseDir()
  editManifest(dir, (manifest) => {
    delete manifest.buildNumber
  })
  assert.ok(problemsFor(dir).some((problem) => problem.includes('buildNumber')), 'missing buildNumber must fail')

  editManifest(dir, (manifest) => {
    manifest.buildNumber = 2
  })
  const problems = problemsFor(dir)
  assert.ok(
    problems.some((problem) => problem === 'linux-update.json buildNumber is 2, expected 1'),
    problems.join('\n'),
  )
})

test('rejects a manifest without generatedAt', () => {
  const dir = releaseDir()
  editManifest(dir, (manifest) => {
    delete manifest.generatedAt
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('generatedAt')), problems.join('\n'))
})

test('rejects a manifest with a non-ISO generatedAt', () => {
  const dir = releaseDir()
  editManifest(dir, (manifest) => {
    manifest.generatedAt = 'yesterday'
  })
  const problems = problemsFor(dir)
  assert.ok(problems.some((problem) => problem.includes('generatedAt')), problems.join('\n'))
})

// A signed, publishable directory: the four packages and metadata already exist.
function releaseTree(t) {
  const dir = releaseDir()
  for (const name of expectedReleaseFileNames(VERSION)) {
    if (!['deepseek-harness-' + VERSION + '-x86_64.AppImage',
      `deepseek-harness_${VERSION}_amd64.deb`,
      `deepseek-harness-${VERSION}-1.x86_64.rpm`,
      `deepseek-harness-${VERSION}-1-x86_64.pkg.tar.zst`].includes(name)
      && !['SHA256SUMS', 'linux-update.json'].includes(name)) {
      writeFileSync(join(dir, name), '')
    }
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('release mode accepts exactly the nine published files', (t) => {
  const dir = releaseTree(t)
  assert.deepEqual(expectedReleaseFileNames(VERSION), [
    'SHA256SUMS',
    'SHA256SUMS.asc',
    'deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst',
    'deepseek-harness-0.2.2-rc.1-1.x86_64.rpm',
    'deepseek-harness-0.2.2-rc.1-x86_64.AppImage',
    'deepseek-harness_0.2.2-rc.1_amd64.deb',
    'dsh-linux-pubkey.asc',
    'linux-update.json',
    'linux-update.json.asc',
  ])
  assert.equal(verifyArtifacts({ dir, version: VERSION, tag: TAG, buildNumber: BUILD, release: true }).ok, true)
})

test('release mode rejects an extra file', (t) => {
  const dir = releaseTree(t)
  writeFileSync(join(dir, 'notes.txt'), 'stray')
  const problems = problemsFor(dir, { release: true })
  assert.ok(
    problems.some((problem) => problem === 'release directory has an unexpected file: "notes.txt"'),
    problems.join('\n'),
  )
})

test('release mode rejects a missing asset, including the public key', (t) => {
  const dir = releaseTree(t)
  rmSync(join(dir, 'dsh-linux-pubkey.asc'))
  const problems = problemsFor(dir, { release: true })
  assert.ok(
    problems.some((problem) => problem === 'release directory is missing dsh-linux-pubkey.asc'),
    problems.join('\n'),
  )
})
