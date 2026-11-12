// tests/linux/signing.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

test('signs and verifies the release files', () => {
  const gnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  writeFileSync(join(dir, 'SHA256SUMS'), 'x  a\n')
  writeFileSync(join(dir, 'linux-update.json'), '{}')
  const env = { ...process.env, GNUPGHOME: gnupg }
  execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'DSH Test <test@example.invalid>', 'ed25519', 'sign', '0'], { env, stdio: 'pipe' })
  const key = execFileSync('gpg', ['--batch', '--with-colons', '--list-secret-keys'], { env, stdio: 'pipe' })
    .toString().split('\n').find(l => l.startsWith('fpr:')).split(':')[9]
  const run = (args) => execFileSync('bash', args, { env: { ...env, GPG_KEY_ID: key }, stdio: 'pipe' })
  run(['linux/scripts/sign-release.sh', dir])
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), true)
  assert.equal(existsSync(join(dir, 'linux-update.json.asc')), true)
  run(['linux/scripts/verify-release.sh', dir])
})

// Generate a throwaway signing key in a fresh keyring and return its fingerprint.
function makeKey() {
  const gnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const env = { ...process.env, GNUPGHOME: gnupg }
  execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'DSH Test <test@example.invalid>', 'ed25519', 'sign', '0'], { env, stdio: 'pipe' })
  const key = execFileSync('gpg', ['--batch', '--with-colons', '--list-secret-keys'], { env, stdio: 'pipe' })
    .toString().split('\n').find(l => l.startsWith('fpr:')).split(':')[9]
  return { gnupg, env, key }
}

function makeReleaseDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  writeFileSync(join(dir, 'SHA256SUMS'), 'x  a\n')
  writeFileSync(join(dir, 'linux-update.json'), '{}')
  return dir
}

test('verification fails on a tampered release file', () => {
  const { env, key } = makeKey()
  const dir = makeReleaseDir()
  const run = (args) => execFileSync('bash', args, { env: { ...env, GPG_KEY_ID: key }, stdio: 'pipe' })
  run(['linux/scripts/sign-release.sh', dir])

  writeFileSync(join(dir, 'linux-update.json'), '{"tampered":true}')
  const result = spawnSync('bash', ['linux/scripts/verify-release.sh', dir], {
    env: { ...env, GPG_KEY_ID: key },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0, 'verify-release.sh must fail on tampered input')
})

test('imports GPG_PRIVATE_KEY into a temporary GNUPGHOME when set', () => {
  const { env, key } = makeKey()
  const dir = makeReleaseDir()
  // An empty keyring that must not be needed: the signing key comes from the environment.
  const emptyGnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const privateKey = execFileSync('gpg', ['--batch', '--armor', '--export-secret-keys', key], { env, stdio: 'pipe' })
    .toString()

  const result = spawnSync('bash', ['linux/scripts/sign-release.sh', dir], {
    env: { ...process.env, GNUPGHOME: emptyGnupg, GPG_KEY_ID: key, GPG_PRIVATE_KEY: privateKey },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), true)
  assert.equal(existsSync(join(dir, 'linux-update.json.asc')), true)
  // The armored private key must never be echoed back to the caller's output.
  assert.equal(`${result.stdout}${result.stderr}`.includes('PRIVATE KEY'), false)

  // The signatures must verify against the keyring that actually owns the key.
  execFileSync('bash', ['linux/scripts/verify-release.sh', dir], { env, stdio: 'pipe' })
})
