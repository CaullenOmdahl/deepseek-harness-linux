// tests/linux/checksums.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256File, formatSums } from '../../linux/lib/checksums.mjs'

test('sha256File hashes file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sum-'))
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'abc')
  assert.equal(sha256File(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('formatSums sorts entries by name', () => {
  assert.equal(
    formatSums([{ name: 'b', sha256: '2' }, { name: 'a', sha256: '1' }]),
    '1  a\n2  b\n',
  )
})
