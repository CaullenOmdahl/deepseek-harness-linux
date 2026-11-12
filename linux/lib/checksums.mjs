// Checksums for the DeepSeek Harness Linux release artifacts.
// `SHA256SUMS` is a plain `sha256sum` file: `<hash>  <name>` per line.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const SUMS_NAME = 'SHA256SUMS'

const SHA256_PATTERN = /^([0-9a-fA-F]{64}) [ *](.+)$/

/** Lowercase SHA-256 hex digest of a file's contents. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Render `sha256sum`-compatible lines, sorted by artifact name. */
export function formatSums(entries) {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ sha256, name }) => `${sha256}  ${name}\n`)
    .join('')
}

/**
 * Parse `SHA256SUMS` text into a `Map` of artifact name to lowercase digest.
 * Throws on malformed or duplicate entries so a damaged file is never trusted.
 */
export function parseSums(text) {
  const entries = new Map()
  const lines = String(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    const match = SHA256_PATTERN.exec(line)
    if (!match) throw new Error(`line ${index + 1} is not a valid "<sha256>  <name>" entry`)
    const [, sha256, name] = match
    if (entries.has(name)) throw new Error(`duplicate entry for ${name}`)
    entries.set(name, sha256.toLowerCase())
  }
  return entries
}
