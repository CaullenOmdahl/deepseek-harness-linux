// tests/linux/verify-artifacts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArtifacts, ArtifactError } from '../../linux/scripts/verify-artifacts.mjs'
import { writeReleaseMetadata } from '../../linux/scripts/assemble-release.mjs'
import { artifactName } from '../../linux/lib/release.mjs'

function releaseDir(version) {
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  for (const format of ['appimage', 'deb', 'rpm', 'pacman']) writeFileSync(join(dir, artifactName(format, version)), format)
  writeReleaseMetadata({ dir, version, tag: `v${version}-linux.1` })
  return dir
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
