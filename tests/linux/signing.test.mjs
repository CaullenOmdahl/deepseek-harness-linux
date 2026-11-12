// tests/linux/signing.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SIGN = fileURLToPath(new URL('../../linux/scripts/sign-release.sh', import.meta.url))
const VERIFY = fileURLToPath(new URL('../../linux/scripts/verify-release.sh', import.meta.url))

// Generate a throwaway signing key in a fresh keyring and return its fingerprint.
function makeKey(name = 'DSH Test <test@example.invalid>') {
  const gnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const env = { ...process.env, GNUPGHOME: gnupg }
  execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', name, 'ed25519', 'sign', '0'], { env, stdio: 'pipe' })
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

function exportPublicKey({ env, key }) {
  const path = join(mkdtempSync(join(tmpdir(), 'pub-')), 'key.asc')
  writeFileSync(path, execFileSync('gpg', ['--batch', '--armor', '--export', key], { env, stdio: 'pipe' }))
  return path
}

function sign({ env, key }, dir, pubkey) {
  return spawnSync('bash', [SIGN, dir, '--pubkey', pubkey], {
    env: { ...env, GPG_KEY_ID: key },
    encoding: 'utf8',
  })
}

function verify({ env }, dir, pubkey) {
  return spawnSync('bash', [VERIFY, dir, ...(pubkey === undefined ? [] : ['--pubkey', pubkey])], {
    env,
    encoding: 'utf8',
  })
}

test('signs and verifies the release files against the selected key', () => {
  const keyring = makeKey()
  const pubkey = exportPublicKey(keyring)
  const dir = makeReleaseDir()
  const signed = sign(keyring, dir, pubkey)
  assert.equal(signed.status, 0, signed.stderr)
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), true)
  assert.equal(existsSync(join(dir, 'linux-update.json.asc')), true)

  const verified = verify(keyring, dir, pubkey)
  assert.equal(verified.status, 0, verified.stderr)
  assert.match(verified.stdout, /fingerprint [0-9A-F]{40}/)
})

test('verification fails on a tampered release file', () => {
  const keyring = makeKey()
  const pubkey = exportPublicKey(keyring)
  const dir = makeReleaseDir()
  assert.equal(sign(keyring, dir, pubkey).status, 0)
  writeFileSync(join(dir, 'linux-update.json'), '{"tampered":true}')
  const result = verify(keyring, dir, pubkey)
  assert.notEqual(result.status, 0, 'verify-release.sh must fail on tampered input')
})

test('verification fails for a signature made by a second key', () => {
  const signer = makeKey('DSH Signer A <a@example.invalid>')
  const other = makeKey('DSH Signer B <b@example.invalid>')
  const signerPubkey = exportPublicKey(signer)
  const otherPubkey = exportPublicKey(other)
  const dir = makeReleaseDir()
  assert.equal(sign(signer, dir, signerPubkey).status, 0)

  const result = verify(other, dir, otherPubkey)
  assert.notEqual(result.status, 0, 'a signature by another key must not verify against the published key')
  assert.match(result.stderr, /not signed by the published key|signature verification failed/)
})

test('verification defaults to the committed project key and rejects a throwaway signature', () => {
  const signer = makeKey()
  const pubkey = exportPublicKey(signer)
  const dir = makeReleaseDir()
  assert.equal(sign(signer, dir, pubkey).status, 0)

  // No --pubkey: the script must pin to dsh-linux-pubkey.asc, not the ambient keyring.
  const result = verify(signer, dir)
  assert.notEqual(result.status, 0, 'a signature from a non-project key must fail default verification')
})

test('signing refuses a key that does not match the published key', () => {
  const signer = makeKey('DSH Signer A <a@example.invalid>')
  const other = makeKey('DSH Signer B <b@example.invalid>')
  const otherPubkey = exportPublicKey(other)
  const dir = makeReleaseDir()

  const result = sign(signer, dir, otherPubkey)
  assert.notEqual(result.status, 0, 'signing with a key other than the published key must fail')
  assert.match(result.stderr, /does not match the published key/)
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), false, 'no signature may be written')
})

test('imports GPG_PRIVATE_KEY into a temporary GNUPGHOME when set', () => {
  const keyring = makeKey()
  const pubkey = exportPublicKey(keyring)
  const dir = makeReleaseDir()
  // An empty keyring that must not be needed: the signing key comes from the environment.
  const emptyGnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const privateKey = execFileSync('gpg', ['--batch', '--armor', '--export-secret-keys', keyring.key], { env: keyring.env, stdio: 'pipe' })
    .toString()

  const result = spawnSync('bash', [SIGN, dir, '--pubkey', pubkey], {
    env: { ...process.env, GNUPGHOME: emptyGnupg, GPG_KEY_ID: keyring.key, GPG_PRIVATE_KEY: privateKey },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), true)
  assert.equal(existsSync(join(dir, 'linux-update.json.asc')), true)
  // The armored private key must never be echoed back to the caller's output.
  assert.equal(`${result.stdout}${result.stderr}`.includes('PRIVATE KEY'), false)

  // The signatures must verify against the published key.
  assert.equal(verify(keyring, dir, pubkey).status, 0)
})
