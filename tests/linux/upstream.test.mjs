// tests/linux/upstream.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  releaseTagsFromList,
  resolveUpstream,
  UpstreamError,
} from '../../linux/scripts/resolve-upstream.mjs'

const RESOLVE_CLI = fileURLToPath(new URL('../../linux/scripts/resolve-upstream.mjs', import.meta.url))
const DECIDE_CLI = fileURLToPath(new URL('../../linux/scripts/decide-sync.mjs', import.meta.url))

// A scratch directory that is removed when the test finishes.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'upstream-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function tagsFile(t, lines) {
  const path = join(scratch(t), 'tags.txt')
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

function lsRemote(tag) {
  return `0123456789abcdef0123456789abcdef01234567\trefs/tags/${tag}`
}

test('maps the npm latest version to its git tag', () => {
  assert.deepEqual(resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.1', 'dsh-v0.2.2-rc.2'] }),
    { version: '0.2.2-rc.1', tag: 'dsh-v0.2.2-rc.1' })
})

test('throws when the tag is missing', () => {
  assert.throws(() => resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.2'] }), UpstreamError)
})

test('matches the tag exactly, not by version prefix', () => {
  // `dsh-v0.2.2-rc.10` is not `dsh-v0.2.2-rc.1`.
  assert.throws(
    () => resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.10'] }),
    UpstreamError,
  )
  assert.deepEqual(
    resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.10', 'dsh-v0.2.2-rc.1'] }),
    { version: '0.2.2-rc.1', tag: 'dsh-v0.2.2-rc.1' },
  )
})

test('resolves tags from raw git ls-remote output', () => {
  const tags = [lsRemote('dsh-v0.2.2-rc.1'), `${lsRemote('dsh-v0.2.2-rc.1')}^{}`]
  assert.deepEqual(resolveUpstream({ latestVersion: '0.2.2-rc.1', tags }), {
    version: '0.2.2-rc.1',
    tag: 'dsh-v0.2.2-rc.1',
  })
})

test('releaseTagsFromList keeps only Linux release tags', () => {
  assert.deepEqual(
    releaseTagsFromList([
      'v0.2.2-rc.1-linux.1',
      'v0.2.2-rc.1-linux.2',
      'v0.2.2-linux.1',
      'v1.0.0-linux.10',
      'dsh-v0.2.2-rc.1', // upstream tag, not a release tag
      'v0.2.2-rc.1', // upstream version tag, no build number
      'v0.2.2-rc.1-linux.x', // non-numeric build number
      'nonsense',
    ]),
    ['v0.2.2-rc.1-linux.1', 'v0.2.2-rc.1-linux.2', 'v0.2.2-linux.1', 'v1.0.0-linux.10'],
  )
})

test('releaseTagsFromList reads ls-remote lines and drops duplicates', () => {
  assert.deepEqual(
    releaseTagsFromList([
      lsRemote('v0.2.2-rc.1-linux.3'),
      `${lsRemote('v0.2.2-rc.1-linux.3')}^{}`,
      lsRemote('dsh-v0.2.2-rc.1'),
      '',
    ]),
    ['v0.2.2-rc.1-linux.3'],
  )
  assert.deepEqual(releaseTagsFromList([]), [])
})

test('release CLI prints the tag for $GITHUB_OUTPUT', (t) => {
  const path = tagsFile(t, [lsRemote('dsh-v0.2.2-rc.2'), lsRemote('dsh-v0.2.2-rc.1')])
  const result = spawnSync(process.execPath, [RESOLVE_CLI, '--latest', '0.2.2-rc.1', '--tags-file', path], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'tag=dsh-v0.2.2-rc.1\n')
})

test('release CLI exits 1 and stays silent on stdout when the tag is missing', (t) => {
  const path = tagsFile(t, [lsRemote('dsh-v0.2.2-rc.2')])
  const result = spawnSync(process.execPath, [RESOLVE_CLI, '--latest', '0.2.2-rc.1', '--tags-file', path], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /dsh-v0\.2\.2-rc\.1/)
})

test('release CLI rejects usage errors and version injection', (t) => {
  const path = tagsFile(t, [lsRemote('dsh-v0.2.2-rc.1')])
  const missing = spawnSync(process.execPath, [RESOLVE_CLI, '--latest', '0.2.2-rc.1'], { encoding: 'utf8' })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /--tags-file is required/)

  const injection = spawnSync(
    process.execPath,
    [RESOLVE_CLI, '--latest', '0.2.2-rc.1\ntag=evil', '--tags-file', path],
    { encoding: 'utf8' },
  )
  assert.equal(injection.status, 2)
  assert.equal(injection.stdout, '')
})

function decide(t, latest, releases) {
  const path = join(scratch(t), 'releases.txt')
  writeFileSync(path, `${releases.join('\n')}\n`)
  return spawnSync(process.execPath, [DECIDE_CLI, '--latest', latest, '--releases-file', path], { encoding: 'utf8' })
}

test('decide CLI requests a build for an unreleased version', (t) => {
  const result = decide(t, '0.2.2-rc.1', ['v0.2.2-rc.10-linux.1', 'v0.2.0-linux.2'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'action=build\nversion=0.2.2-rc.1\n')
})

test('decide CLI requests nothing when the version is already released', (t) => {
  const result = decide(t, '0.2.2-rc.1', ['v0.2.2-rc.1-linux.1'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'action=none\nversion=0.2.2-rc.1\n')
})

test('decide CLI ignores upstream tags that look like versions', (t) => {
  const result = decide(t, '0.2.2-rc.1', ['dsh-v0.2.2-rc.1', 'v0.2.2-rc.1'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'action=build\nversion=0.2.2-rc.1\n')
})

test('decide CLI exits 1 when the releases file cannot be read', (t) => {
  const path = join(scratch(t), 'missing.txt')
  const result = spawnSync(process.execPath, [DECIDE_CLI, '--latest', '0.2.2-rc.1', '--releases-file', path], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /missing\.txt/)
})

test('decide CLI rejects usage errors and version injection', (t) => {
  const missing = spawnSync(process.execPath, [DECIDE_CLI, '--latest', '0.2.2-rc.1'], { encoding: 'utf8' })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /--releases-file is required/)

  const result = decide(t, '0.2.2-rc.1\naction=none', [])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
})
