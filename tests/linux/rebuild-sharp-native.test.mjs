import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  electronVersionOf,
  findSharpAddon,
  parseSharpAddonVersion,
  sharpAddonDir,
} from '../../linux/scripts/rebuild-sharp-native.mjs'

function packagedTree() {
  const appOutDir = mkdtempSync(join(tmpdir(), 'sharp-tree-'))
  const addonDir = sharpAddonDir(appOutDir)
  mkdirSync(addonDir, { recursive: true })
  return { appOutDir, addonDir }
}

test('reads the sharp version from the prebuilt addon name', () => {
  assert.equal(parseSharpAddonVersion('sharp-linux-x64-0.35.5.node'), '0.35.5')
  assert.throws(() => parseSharpAddonVersion('sharp-linux-arm64-0.35.5.node'), /unexpected sharp addon name/)
})

test('places the addon under resources/app.asar.unpacked for the packaged tree', () => {
  const dir = sharpAddonDir('/tmp/app-out')
  assert.equal(
    dir,
    join('/tmp/app-out', 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@img', 'sharp-linux-x64', 'lib'),
  )
})

test('finds exactly one prebuilt addon in the packaged tree', () => {
  const { appOutDir, addonDir } = packagedTree()
  try {
    const addon = join(addonDir, 'sharp-linux-x64-0.35.5.node')
    writeFileSync(addon, '')
    assert.equal(findSharpAddon(appOutDir), addon)
  } finally {
    rmSync(appOutDir, { recursive: true, force: true })
  }
})

test('rejects a packaged tree with no addon or several addons', () => {
  const { appOutDir, addonDir } = packagedTree()
  try {
    assert.throws(() => findSharpAddon(appOutDir), /expected exactly one sharp addon/)
    writeFileSync(join(addonDir, 'sharp-linux-x64-0.35.5.node'), '')
    writeFileSync(join(addonDir, 'sharp-linux-x64-0.35.6.node'), '')
    assert.throws(() => findSharpAddon(appOutDir), /expected exactly one sharp addon/)
  } finally {
    rmSync(appOutDir, { recursive: true, force: true })
  }
})

test('explains a missing packaged executable instead of guessing an Electron version', () => {
  const appOutDir = mkdtempSync(join(tmpdir(), 'sharp-no-exe-'))
  try {
    assert.throws(() => electronVersionOf(appOutDir), /packaged executable not found/)
  } finally {
    rmSync(appOutDir, { recursive: true, force: true })
  }
})

test('uses an explicit Electron version without running the app', () => {
  assert.equal(electronVersionOf('/does/not/matter', '44.7.0'), '44.7.0')
})
