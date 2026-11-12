// tests/linux/release-notes.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReleaseNotes, DEFAULT_VERIFICATION_SUMMARY } from '../../linux/scripts/render-release-notes.mjs'

const TEMPLATE = fileURLToPath(new URL('../../docs/release-notes.md', import.meta.url))

const INPUT = {
  version: '0.2.2-rc.1',
  tag: 'v0.2.2-rc.1-linux.2',
  buildNumber: 2,
  runUrl: 'https://github.com/CaullenOmdahl/deepseek-harness-linux/actions/runs/123',
}

test('renders the committed template with version, tag, and build number', () => {
  const body = renderReleaseNotes({ template: readFileSync(TEMPLATE, 'utf8'), ...INPUT })
  assert.match(body, /^# DSH Linux 0\.2\.2-rc\.1-linux\.2$/m)
  assert.match(body, /gh release download v0\.2\.2-rc\.1-linux\.2 -R CaullenOmdahl\/deepseek-harness-linux/)
  assert.match(body, /deepseek-harness_0\.2\.2-rc\.1_amd64\.deb/)
  assert.match(body, /Unofficial Linux desktop build/)
  assert.match(body, /not an official DeepSeek product/)
  assert.match(body, /dsh-linux-pubkey\.asc/)
  assert.match(body, /D1C8 807B 90F7 A51E 7537 {2}FD7F 4B69 2295 FFFB 9452/)
  assert.match(body, /exactly nine files/)
  assert.ok(body.includes(INPUT.runUrl))
  assert.ok(body.endsWith('\n') && !body.endsWith('\n\n'))
  assert.equal(body.includes('{{'), false, 'no placeholder may remain')
})

test('uses the default verification summary when none is supplied', () => {
  const body = renderReleaseNotes({ template: readFileSync(TEMPLATE, 'utf8'), ...INPUT })
  assert.ok(body.includes(DEFAULT_VERIFICATION_SUMMARY))
})

test('substitutes an optional verification summary file', () => {
  const body = renderReleaseNotes({
    template: readFileSync(TEMPLATE, 'utf8'),
    ...INPUT,
    verificationSummary: 'Verified in CI run 123: 5/5 distro installs, title smoke passed.',
  })
  assert.match(body, /5\/5 distro installs, title smoke passed/)
  assert.equal(body.includes(DEFAULT_VERIFICATION_SUMMARY), false)
})

test('rejects unknown and unresolved placeholders', () => {
  assert.throws(
    () => renderReleaseNotes({ template: 'Hello {{UNKNOWN}}', ...INPUT }),
    /unknown release notes placeholder/,
  )
  assert.throws(() => renderReleaseNotes({ template: 'Hello', ...INPUT, version: '' }), /version/)
  assert.throws(() => renderReleaseNotes({ template: 'Hello', ...INPUT, buildNumber: 0 }), /build number/)
  assert.throws(() => renderReleaseNotes({ template: 'Hello', ...INPUT, runUrl: '' }), /run URL/)
})

test('CLI writes the rendered body', async () => {
  const { main } = await import('../../linux/scripts/render-release-notes.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'notes-'))
  const output = join(dir, 'release-notes.md')
  const summary = join(dir, 'summary.md')
  writeFileSync(summary, 'summary from CI\n')
  const code = main([
    '--template', TEMPLATE,
    '--output', output,
    '--version', INPUT.version,
    '--tag', INPUT.tag,
    '--build-number', String(INPUT.buildNumber),
    '--run-url', INPUT.runUrl,
    '--summary-file', summary,
  ])
  assert.equal(code, 0)
  const body = readFileSync(output, 'utf8')
  assert.match(body, /summary from CI/)
  assert.equal(body.includes('{{'), false)
})
