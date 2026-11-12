// tests/linux/manifest.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest, MANIFEST_NAME } from '../../linux/lib/manifest.mjs'

test('manifest keys assets by format and arch', () => {
  assert.equal(MANIFEST_NAME, 'linux-update.json')
  const manifest = buildManifest({
    version: '0.2.2-rc.1',
    tag: 'v0.2.2-rc.1-linux.1',
    assets: [{ format: 'rpm', arch: 'x86_64', name: 'deepseek-harness-0.2.2-rc.1-1.x86_64.rpm', size: 10, sha256: 'ab' }],
  })
  assert.equal(manifest.version, '0.2.2-rc.1')
  assert.equal(manifest.tag, 'v0.2.2-rc.1-linux.1')
  assert.deepEqual(manifest.assets['rpm/x86_64'], { name: 'deepseek-harness-0.2.2-rc.1-1.x86_64.rpm', size: 10, sha256: 'ab' })
})
