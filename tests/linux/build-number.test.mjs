// tests/linux/build-number.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BuildNumberError,
  releaseTagsFromText,
  resolveBuildNumber,
} from '../../linux/scripts/resolve-build-number.mjs'

const VERSION = '0.2.2-rc.1'

test('computes the next build number when no request is given', () => {
  assert.deepEqual(resolveBuildNumber({ version: VERSION, releaseTags: [] }), { buildNumber: 1, tag: 'v0.2.2-rc.1-linux.1' })
  assert.deepEqual(
    resolveBuildNumber({ version: VERSION, releaseTags: ['v0.2.2-rc.1-linux.1'] }),
    { buildNumber: 2, tag: 'v0.2.2-rc.1-linux.2' },
  )
  assert.deepEqual(
    resolveBuildNumber({ version: VERSION, releaseTags: ['v0.2.2-rc.1-linux.1', 'v0.2.2-rc.1-linux.2'] }),
    { buildNumber: 3, tag: 'v0.2.2-rc.1-linux.3' },
  )
  // Other upstream versions and near-miss tags do not affect this version.
  assert.deepEqual(
    resolveBuildNumber({ version: VERSION, releaseTags: ['v0.2.2-rc.10-linux.9', 'v0.2.0-linux.4'] }),
    { buildNumber: 1, tag: 'v0.2.2-rc.1-linux.1' },
  )
})

test('honours an explicit build number when its tag is free', () => {
  assert.deepEqual(
    resolveBuildNumber({ version: VERSION, releaseTags: ['v0.2.2-rc.1-linux.1'], requested: 2 }),
    { buildNumber: 2, tag: 'v0.2.2-rc.1-linux.2' },
  )
  assert.throws(
    () => resolveBuildNumber({ version: VERSION, releaseTags: ['v0.2.2-rc.1-linux.1'], requested: 1 }),
    BuildNumberError,
  )
  assert.throws(() => resolveBuildNumber({ version: VERSION, releaseTags: [], requested: 0 }), BuildNumberError)
  assert.throws(() => resolveBuildNumber({ version: VERSION, releaseTags: [], requested: 1.5 }), BuildNumberError)
  assert.throws(() => resolveBuildNumber({ version: '', releaseTags: [] }), BuildNumberError)
})

test('parses release lists and preserves only non-empty tags', () => {
  assert.deepEqual(releaseTagsFromText('v0.2.2-rc.1-linux.1\n\n v0.2.2-rc.1-linux.2 \r\n'), [
    'v0.2.2-rc.1-linux.1',
    'v0.2.2-rc.1-linux.2',
  ])
  assert.deepEqual(releaseTagsFromText(''), [])
})
