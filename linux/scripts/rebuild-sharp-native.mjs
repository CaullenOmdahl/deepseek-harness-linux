#!/usr/bin/env node
// Rebuild sharp's native addon for the packaged Electron runtime.
//
// Why: upstream's Linux tree ships sharp's npm prebuilt addon, whose bundled libvips
// statically links glib. Inside Electron that static glib corrupts GObject state and the
// first image decode (any attached image) segfaults the DSH host. Rebuilding the addon
// alone does not fix it; it must link a libvips that uses the system glib dynamically.
//
// linux/scripts/build-libvips.sh builds that libvips. This script rebuilds the addon
// against it for the packaged Electron version, points its rpath at the bundled library,
// installs it over the prebuilt addon, and verifies image decoding with the packaged
// binary so a broken artifact can never be produced silently.

import { execFileSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HEADERS_URL = 'https://electronjs.org/headers'
const EXECUTABLE_NAME = 'deepseek-harness'
// resources/app.asar.unpacked/dsh/node_modules/@img/sharp-linux-x64/lib -> resources/libvips/lib
const ADDON_RPATH = '$ORIGIN/../../../../../../libvips/lib'

/** Version encoded in sharp's addon filename, e.g. sharp-linux-x64-0.35.5.node. */
export function parseSharpAddonVersion(fileName) {
  const match = /^sharp-linux-x64-(.+)\.node$/.exec(fileName)
  if (!match) throw new Error(`unexpected sharp addon name: ${fileName}`)
  return match[1]
}

/** Directory holding the sharp addon inside the packaged app. */
export function sharpAddonDir(appOutDir) {
  return path.join(appOutDir, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@img', 'sharp-linux-x64', 'lib')
}

/** Locate the single prebuilt sharp addon the packaged tree ships. */
export function findSharpAddon(appOutDir) {
  const dir = sharpAddonDir(appOutDir)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    throw new Error(`sharp addon directory not found: ${dir}`)
  }
  const matches = entries.filter((name) => /^sharp-linux-x64-.*\.node$/.test(name))
  if (matches.length !== 1) {
    throw new Error(`expected exactly one sharp addon in ${dir}, found ${matches.length}`)
  }
  return path.join(dir, matches[0])
}

/** Packaged Electron version, from the app itself when not given explicitly. */
export function electronVersionOf(appOutDir, explicit) {
  if (explicit) return explicit
  const executable = path.join(appOutDir, EXECUTABLE_NAME)
  if (!existsSync(executable)) throw new Error(`packaged executable not found: ${executable}`)
  const version = execFileSync(
    executable,
    ['-e', "process.stdout.write(process.versions.electron)"],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
  ).trim()
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`could not determine Electron version (got ${JSON.stringify(version)})`)
  return version
}

function run(command, args, cwd, env = {}) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

/** Build sharp's addon for Electron against the bundled libvips; returns the .node path. */
export function buildSharpAddon({ sharpVersion, electronVersion, libvipsPrefix }) {
  const pkgConfig = path.join(libvipsPrefix, 'lib', 'pkgconfig')
  if (!existsSync(path.join(pkgConfig, 'vips-cpp.pc'))) {
    throw new Error(`vips-cpp.pc not found under ${pkgConfig}; run build-libvips.sh first`)
  }
  const work = mkdtempSync(path.join(tmpdir(), 'dsh-sharp-'))
  try {
    run('npm', ['init', '-y'], work)
    run('npm', ['install', `sharp@${sharpVersion}`, '--no-audit', '--no-fund'], work)
    run('npm', ['install', '--save-dev', 'node-gyp', 'node-addon-api', '--no-audit', '--no-fund'], work)
    const sharpDir = path.join(work, 'node_modules', 'sharp')
    // sharp's build spawns bare `node-gyp`; expose the copy npm installed here.
    const localBin = path.join(work, 'node_modules', '.bin')
    run(process.execPath, ['install/build.js'], sharpDir, {
      PATH: `${localBin}${path.delimiter}${process.env.PATH ?? ''}`,
      SHARP_FORCE_GLOBAL_LIBVIPS: '1',
      PKG_CONFIG_PATH: pkgConfig,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: HEADERS_URL,
      npm_config_arch: 'x64',
    })
    const built = path.join(sharpDir, 'src', 'build', 'Release', `sharp-linux-x64-${sharpVersion}.node`)
    if (!existsSync(built)) throw new Error(`sharp build produced no addon at ${built}`)
    // The work tree is removed below; hand the caller its own copy of the addon.
    const output = mkdtempSync(path.join(tmpdir(), 'dsh-sharp-addon-'))
    const staged = path.join(output, path.basename(built))
    cpSync(built, staged)
    return staged
  } finally {
    // The caller copies the addon out before this returns; keep the tree for debugging
    // when DSH_KEEP_SHARP_BUILD is set.
    if (!process.env.DSH_KEEP_SHARP_BUILD) rmSync(work, { recursive: true, force: true })
  }
}

/** Point the addon at the bundled libvips and install it into the packaged tree. */
export function installAddon({ appOutDir, builtAddon, sharpVersion }) {
  const target = path.join(sharpAddonDir(appOutDir), `sharp-linux-x64-${sharpVersion}.node`)
  if (!existsSync(target)) throw new Error(`packaged sharp addon missing: ${target}`)
  run('patchelf', ['--set-rpath', ADDON_RPATH, builtAddon])
  cpSync(builtAddon, target, { force: true })
  chmodSync(target, 0o755)
  return target
}

/** Decode a generated image with the packaged app's own sharp, failing on a crash. */
export function verifyDecode(appOutDir) {
  const executable = path.join(appOutDir, EXECUTABLE_NAME)
  const sharpModule = path.join(appOutDir, 'resources', 'app.asar', 'dsh', 'node_modules', 'sharp')
  const source = `
    const sharp = require(${JSON.stringify(sharpModule)})
    sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
      .then((png) => sharp(png).metadata())
      .then((meta) => {
        if (meta.format !== 'png') throw new Error('unexpected decoded format ' + meta.format)
        process.stdout.write('sharp decode ok (libvips ' + sharp.versions.vips + ')\\n')
      })
      .catch((error) => { console.error(error); process.exit(1) })
  `
  execFileSync(executable, ['-e', source], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 120_000,
  })
}

/** Full fix used by the electron-builder afterPack hook. */
export function fixPackagedSharp({ appOutDir, libvipsPrefix, electronVersion }) {
  const addon = findSharpAddon(appOutDir)
  const sharpVersion = parseSharpAddonVersion(path.basename(addon))
  // electron-builder can run afterPack more than once for one app dir; rebuild only once,
  // but still verify that the packaged runtime can decode an image.
  const rpath = execFileSync('patchelf', ['--print-rpath', addon], { encoding: 'utf8' }).trim()
  if (rpath.includes('libvips/lib')) {
    console.log('sharp: addon already rebuilt for the bundled libvips; verifying')
    verifyDecode(appOutDir)
    return
  }
  const resolvedElectron = electronVersionOf(appOutDir, electronVersion)
  console.log(`sharp: rebuilding ${sharpVersion} addon for Electron ${resolvedElectron}`)
  const built = buildSharpAddon({ sharpVersion, electronVersion: resolvedElectron, libvipsPrefix })
  try {
    installAddon({ appOutDir, builtAddon: built, sharpVersion })
  } finally {
    rmSync(path.dirname(built), { recursive: true, force: true })
  }
  verifyDecode(appOutDir)
  console.log('sharp: packaged addon rebuilt and verified')
}

function parseArgs(argv) {
  const args = {}
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!value) throw new Error(`missing value for ${key}`)
    args[key.replace(/^--/, '')] = value
  }
  return args
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv)
  const libvipsPrefix = args['libvips-prefix'] ?? process.env.DSH_VIPS_PREFIX
  const electronVersion = args['electron-version'] ?? process.env.DSH_ELECTRON_VERSION
  if (!args['app-out-dir'] || !libvipsPrefix) {
    console.error('usage: rebuild-sharp-native.mjs --app-out-dir <dir> --libvips-prefix <prefix> [--electron-version <version>]')
    process.exit(2)
  }
  fixPackagedSharp({ appOutDir: args['app-out-dir'], libvipsPrefix, electronVersion })
}
