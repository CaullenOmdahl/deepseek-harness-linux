// tests/linux/release.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseTag, nextBuildNumber, artifactName, decideSync } from '../../linux/lib/release.mjs'

test('releaseTag appends the linux build number', () => {
  assert.equal(releaseTag('0.2.2-rc.1', 3), 'v0.2.2-rc.1-linux.3')
})

test('nextBuildNumber counts only the same upstream version', () => {
  assert.equal(nextBuildNumber('0.2.2-rc.1', []), 1)
  assert.equal(nextBuildNumber('0.2.2-rc.1', ['v0.2.2-rc.1-linux.1', 'v0.2.2-rc.1-linux.2']), 3)
  assert.equal(nextBuildNumber('0.2.2-rc.1', ['v0.2.0-linux.9', 'v0.2.2-rc.1-linux.1']), 2)
})

test('artifactName is deterministic per format', () => {
  assert.equal(artifactName('appimage', '0.2.2-rc.1'), 'deepseek-harness-0.2.2-rc.1-x86_64.AppImage')
  assert.equal(artifactName('deb', '0.2.2-rc.1'), 'deepseek-harness_0.2.2-rc.1_amd64.deb')
  assert.equal(artifactName('rpm', '0.2.2-rc.1'), 'deepseek-harness-0.2.2-rc.1-1.x86_64.rpm')
  assert.equal(artifactName('pacman', '0.2.2-rc.1'), 'deepseek-harness-0.2.2-rc.1-1-x86_64.pkg.tar.zst')
})

test('decideSync builds only a version that has no release yet', () => {
  assert.deepEqual(decideSync({ latestVersion: '0.2.2-rc.1', releaseTags: [] }), { action: 'build', version: '0.2.2-rc.1' })
  assert.deepEqual(decideSync({ latestVersion: '0.2.2-rc.1', releaseTags: ['v0.2.2-rc.1-linux.1'] }), { action: 'none' })
  assert.deepEqual(decideSync({ latestVersion: '0.2.3-rc.1', releaseTags: ['v0.2.2-rc.1-linux.1'] }), { action: 'build', version: '0.2.3-rc.1' })
})
