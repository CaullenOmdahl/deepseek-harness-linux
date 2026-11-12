# DSH Linux Desktop — Build and Automated Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish installable, signed DSH Desktop artifacts (AppImage, deb, rpm, pacman) for x86_64 from a public overlay repository, rebuilt automatically whenever upstream's `latest` line advances.

**Architecture:** The public overlay repo holds only our additions. CI checks out `deepseek-ai/deepseek-harness` at the release tag, applies a small patch series if the spike proved one is required, builds with a wrapper electron-builder config, verifies installability in distro containers, signs the checksums and manifest with a project key, and publishes a GitHub Release. A scheduled sync workflow maps the npm `latest` version to its `dsh-v<version>` tag and dispatches the build; any failure stops before publish and opens an issue, leaving the last good release live.

**Tech Stack:** Node 24.9+, pnpm 11.28.5 (corepack), upstream electron-builder 26.17, GitHub Actions on `ubuntu-22.04`, Docker containers, GPG, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-11-13-dsh-linux-desktop-design.md`

**Scope:** This plan covers packaging, signing, publishing, and the sync pipeline. The in-app **Update** button, per-format self-update, and restart flow are Plan 2; this plan's manifest and release format are built for it.

## Global Constraints

- glibc 2.35 floor, built on `ubuntu-22.04`. Supported: Ubuntu 22.04+, Debian 12+, Fedora 36+, RHEL 10+. RHEL 9 and older excluded. x86_64 only in this plan.
- Upstream version = npm dist-tag `latest` (currently `0.2.2-rc.1`); its git tag is `dsh-v<version>`.
- Release tag `v<version>-linux.<n>`, `<n>` starting at 1, incremented only when rebuilding the same upstream version.
- Product name stays **DeepSeek Harness**; the repo is `CaullenOmdahl/deepseek-harness-linux`; the project is unofficial and states so.
- Artifact names:
  - AppImage `deepseek-harness-<version>-x86_64.AppImage`
  - deb `deepseek-harness_<version>_amd64.deb`
  - rpm `deepseek-harness-<version>-1.x86_64.rpm`
  - pacman `deepseek-harness-<version>-1-x86_64.pkg.tar.zst`
- Every release also carries `SHA256SUMS`, `SHA256SUMS.asc`, `linux-update.json`, `linux-update.json.asc`.
- No manual per-release step: the only one-time actions are repo creation, Actions enablement, and secret creation.
- Never publish unless artifact verification and GPG signatures pass.
- MIT license, upstream copyright notices preserved, NOTICE describing the overlay.
- Tests run with `node --test tests/linux/*.test.mjs` (Node 24 built-in runner, no extra dependencies).

## Review Focus

1. An artifact built on Ubuntu 22.04 installs cleanly (no unresolved libraries, no `GLIBC_2.35` symbol error) on Debian 12, Fedora 44, and Ubuntu 22.04; on this Fedora machine the window manager title reads exactly `DeepSeek Harness`.
2. Re-dispatching a build for the same upstream version increments `<n>` and never overwrites or deletes an existing release's assets.
3. A missing, truncated, or renamed artifact, or a checksum mismatch, aborts the release job before anything is published.
4. npm `latest` and the expected `dsh-v<version>` git tag disagree (or the tag is missing): sync does nothing and opens an issue instead of building the wrong tree.
5. An upstream change makes the patch series fail to apply: the build stops before publish, opens an issue, and the previous release remains the latest.

---

### Task 1: Spike — prove the Linux build path, patch surface, and boot

**Files:**
- Create: `linux/patches/0001-desktop-linux-target.patch` (only if the build is blocked without an edit)
- Create: `docs/spike/linux-build.md`
- Create: `.gitignore`

**Interfaces:**
- Produces: the exact upstream build command, the artifact output path, the patch file list, and the boot/title observations that Task 6 consumes.

- [ ] **Step 1: Create the public overlay repository**

```bash
gh repo create CaullenOmdahl/deepseek-harness-linux --public \
  --description "Unofficial Linux desktop builds of DeepSeek Harness" --clone
cd deepseek-harness-linux
printf 'upstream/\n.cache/\ndist/\n' > .gitignore
git add .gitignore && git commit -m "chore: start overlay repo"
```

Expected: repository exists, one commit.

- [ ] **Step 2: Check out upstream at the pinned tag**

```bash
git clone --depth 1 --branch dsh-v0.2.2-rc.1 \
  https://github.com/deepseek-ai/deepseek-harness.git upstream
```

Expected: `upstream/apps/desktop/scripts/desktop-build-paths.mjs` exists.

- [ ] **Step 3: Install the workspace and observe the Linux rejection**

```bash
corepack enable
cd upstream && pnpm install --frozen-lockfile
DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64 --check
```

Expected: FAIL with a message naming an unsupported target such as `desktop build paths: unsupported target linux-x64`. Record the message and the file it names in the spike doc.

- [ ] **Step 4: Write the minimal patch and prove `--check` passes**

Edit only the files the failure names (expected: `apps/desktop/scripts/desktop-build-paths.mjs`, plus the target table in `apps/desktop/scripts/package-target.ts` if it rejects `linux-x64`). Add `linux-x64` as a supported target and map its output paths to the same `.desktop-build` layout used by the other targets. Then rerun the Step 3 command.

Expected: exit 0.

- [ ] **Step 5: Produce an AppImage**

```bash
DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm exec tsx apps/desktop/scripts/package-target.ts linux-x64
```

Expected: one AppImage under `apps/desktop/.desktop-build/linux-x64/artifacts/` (record the exact path).

- [ ] **Step 6: Prove the app boots headlessly**

```bash
APPIMAGE=$(ls apps/desktop/.desktop-build/linux-x64/artifacts/*.AppImage | head -1)
timeout 25 xvfb-run -a "$APPIMAGE" --appimage-extract-and-run --no-sandbox &
sleep 15 && ps -p $! >/dev/null && echo "app still running"
```

Expected: `app still running`. If it exits, capture stderr into the spike doc and stop — the rest of the plan depends on this boot.

- [ ] **Step 7: Capture the patch and write the spike report**

```bash
git -C upstream diff > ../linux/patches/0001-desktop-linux-target.patch
git -C upstream apply --check --reverse ../linux/patches/0001-desktop-linux-target.patch
```

Write `docs/spike/linux-build.md` with: install time, the rejection message, every patched file and why, the build command, the artifact path, boot result, AppImage size, and any caveat the builder must know.

- [ ] **Step 8: Commit**

```bash
git add linux/patches docs/spike .gitignore
git commit -m "spike: prove Linux desktop build path and Linux target patch"
```

---

### Task 2: Patch application with conflict detection

**Files:**
- Create: `linux/scripts/apply-patches.mjs`
- Create: `tests/linux/apply-patches.test.mjs`

**Interfaces:**
- Produces: `applyPatches({ seriesDir, targetDir })` → `{ applied: string[], skipped: string[] }`; throws `PatchConflictError` with the failing patch's stderr when a patch cannot apply.

- [ ] **Step 1: Write the failing test**

```js
// tests/linux/apply-patches.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyPatches, PatchConflictError } from '../../linux/scripts/apply-patches.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'patch-'))
  const target = join(root, 'target')
  execFileSync('git', ['init', '-q', target])
  execFileSync('git', ['-C', target, 'config', 'user.email', 't@e'])
  execFileSync('git', ['-C', target, 'config', 'user.name', 'T'])
  writeFileSync(join(target, 'a.txt'), 'one\n')
  execFileSync('git', ['-C', target, 'add', '.'])
  execFileSync('git', ['-C', target, 'commit', '-qm', 'init'])
  const series = join(root, 'patches')
  mkdirSync(series)
  return { target, series }
}

test('applies a patch once and reports it already applied', () => {
  const { target, series } = fixture()
  writeFileSync(join(series, '0001-add-line.patch'),
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n one\n+two\n')
  assert.deepEqual(applyPatches({ seriesDir: series, targetDir: target }), { applied: ['0001-add-line.patch'], skipped: [] })
  assert.equal(readFileSync(join(target, 'a.txt'), 'utf8'), 'one\ntwo\n')
  assert.deepEqual(applyPatches({ seriesDir: series, targetDir: target }), { applied: [], skipped: ['0001-add-line.patch'] })
})

test('throws PatchConflictError when a patch cannot apply', () => {
  const { target, series } = fixture()
  writeFileSync(join(series, '0001-bad.patch'),
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n nope\n+two\n')
  assert.throws(() => applyPatches({ seriesDir: series, targetDir: target }), PatchConflictError)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/linux/apply-patches.test.mjs`
Expected: FAIL — cannot find module `../../linux/scripts/apply-patches.mjs`.

- [ ] **Step 3: Implement `applyPatches`**

In `linux/scripts/apply-patches.mjs`: sort `*.patch` by filename; for each, run `git -C <targetDir> apply --check <file>`; if it exits 0, run `git -C <targetDir> apply <file>` and add to `applied`; if it fails, run `git -C <targetDir> apply --reverse --check <file>` — exit 0 means already applied → `skipped`, otherwise throw `PatchConflictError` carrying the file name and stderr. Export the class and function.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/linux/apply-patches.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add linux/scripts/apply-patches.mjs tests/linux/apply-patches.test.mjs
git commit -m "feat: apply the Linux patch series with conflict detection"
```

---

### Task 3: Release model — tags, build numbers, artifact names, sync decision

**Files:**
- Create: `linux/lib/release.mjs`
- Create: `tests/linux/release.test.mjs`

**Interfaces:**
- Produces: `releaseTag(version, n)`, `nextBuildNumber(version, tags)`, `artifactName(format, version)`, `decideSync({ latestVersion, releaseTags })`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/linux/release.test.mjs`
Expected: FAIL — cannot find module `../../linux/lib/release.mjs`.

- [ ] **Step 3: Implement `linux/lib/release.mjs`**

`releaseTag` returns `v${version}-linux.${n}`. `nextBuildNumber` filters tags matching `^v${escapeRegex(version)}-linux\.(\d+)$` and returns `max + 1` (1 when none). `artifactName` maps the format to the names in Global Constraints. `decideSync` returns `{ action: 'build', version }` when no release tag starts with `v${version}-linux.`, else `{ action: 'none' }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/linux/release.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add linux/lib/release.mjs tests/linux/release.test.mjs
git commit -m "feat: release tag, build number, artifact naming, and sync decision"
```

---

### Task 4: Checksums, manifest, and pre-publish verification

**Files:**
- Create: `linux/lib/checksums.mjs`
- Create: `linux/lib/manifest.mjs`
- Create: `linux/scripts/assemble-release.mjs`
- Create: `linux/scripts/verify-artifacts.mjs`
- Create: `tests/linux/checksums.test.mjs`
- Create: `tests/linux/manifest.test.mjs`
- Create: `tests/linux/verify-artifacts.test.mjs`

**Interfaces:**
- Produces:
  - `sha256File(path)` → lowercase hex string.
  - `formatSums(entries)` where `entries: [{ name, sha256 }]` → `"<hash>  <name>\n"` lines sorted by name.
  - `buildManifest({ version, tag, assets })` where `assets: [{ format, arch, name, size, sha256 }]` → object `{ version, tag, generatedAt, assets: { '<format>/<arch>': { name, size, sha256 } } }`.
  - `writeReleaseMetadata({ dir, version, tag })` → writes `SHA256SUMS` and `linux-update.json` from the four artifacts and returns the manifest.
  - `verifyArtifacts({ dir, version })` → `{ ok: true, assets }` or throws `ArtifactError` naming the missing/mismatched file.
  - CLI `assemble-release.mjs --dir <dir> --version <version> --tag <tag>` writes the metadata; CLI `verify-artifacts.mjs --dir <dir> --version <version>` exits 0/1 with one message per problem.

- [ ] **Step 1: Write the failing tests**

```js
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
```

```js
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
```

```js
// tests/linux/verify-artifacts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArtifacts, ArtifactError } from '../../linux/scripts/verify-artifacts.mjs'
import { writeReleaseMetadata } from '../../linux/scripts/assemble-release.mjs'
import { artifactName } from '../../linux/lib/release.mjs'

function releaseDir(version) {
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  for (const format of ['appimage', 'deb', 'rpm', 'pacman']) writeFileSync(join(dir, artifactName(format, version)), format)
  writeReleaseMetadata({ dir, version, tag: `v${version}-linux.1` })
  return dir
}

test('accepts a complete release', () => {
  const dir = releaseDir('0.2.2-rc.1')
  assert.equal(verifyArtifacts({ dir, version: '0.2.2-rc.1' }).ok, true)
})

test('rejects a checksum mismatch', () => {
  const dir = releaseDir('0.2.2-rc.1')
  writeFileSync(join(dir, artifactName('rpm', '0.2.2-rc.1')), 'tampered')
  assert.throws(() => verifyArtifacts({ dir, version: '0.2.2-rc.1' }), ArtifactError)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/linux/checksums.test.mjs tests/linux/manifest.test.mjs tests/linux/verify-artifacts.test.mjs`
Expected: FAIL — modules and exports missing.

- [ ] **Step 3: Implement the three modules**

`checksums.mjs`: `sha256File` via `createHash('sha256').update(readFileSync(path))`; `formatSums` sorts by name and joins `` `${sha256}  ${name}` ``. `manifest.mjs`: `MANIFEST_NAME = 'linux-update.json'`; `buildManifest` stamps `generatedAt` as an ISO string and builds the asset map. `assemble-release.mjs`: `writeReleaseMetadata` collects the four named artifacts, computes sizes and hashes, writes `SHA256SUMS` and `linux-update.json`; CLI parses `--dir/--version/--tag`. `verify-artifacts.mjs`: reads `SHA256SUMS`, requires every format's expected name, recomputes each hash, and also requires `linux-update.json` to reference the same names and hashes; throws `ArtifactError` with one message per failure; a CLI wrapper parses `--dir/--version`, prints each problem to stderr, and exits 1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/linux/checksums.test.mjs tests/linux/manifest.test.mjs tests/linux/verify-artifacts.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add linux/lib/checksums.mjs linux/lib/manifest.mjs linux/scripts/assemble-release.mjs linux/scripts/verify-artifacts.mjs tests/linux
git commit -m "feat: checksums, update manifest, and pre-publish artifact verification"
```

---

### Task 5: GPG signing and verification scripts

**Files:**
- Create: `linux/scripts/sign-release.sh`
- Create: `linux/scripts/verify-release.sh`
- Create: `tests/linux/signing.test.mjs`

**Interfaces:**
- Produces: `sign-release.sh <dir>` → writes `<dir>/SHA256SUMS.asc` and `<dir>/linux-update.json.asc` using `GPG_KEY_ID`; `verify-release.sh <dir>` → exit 0 only when both signatures verify.

- [ ] **Step 1: Write the failing test**

```js
// tests/linux/signing.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('signs and verifies the release files', () => {
  const gnupg = mkdtempSync(join(tmpdir(), 'gnupg-'))
  const dir = mkdtempSync(join(tmpdir(), 'rel-'))
  writeFileSync(join(dir, 'SHA256SUMS'), 'x  a\n')
  writeFileSync(join(dir, 'linux-update.json'), '{}')
  const env = { ...process.env, GNUPGHOME: gnupg }
  execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'DSH Test <test@example.invalid>', 'ed25519', 'sign', '0'], { env })
  const key = execFileSync('gpg', ['--batch', '--with-colons', '--list-secret-keys'], { env })
    .toString().split('\n').find(l => l.startsWith('fpr:')).split(':')[9]
  const run = (args) => execFileSync('bash', args, { env: { ...env, GPG_KEY_ID: key }, stdio: 'pipe' })
  run(['linux/scripts/sign-release.sh', dir])
  assert.equal(existsSync(join(dir, 'SHA256SUMS.asc')), true)
  assert.equal(existsSync(join(dir, 'linux-update.json.asc')), true)
  run(['linux/scripts/verify-release.sh', dir])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/linux/signing.test.mjs`
Expected: FAIL — scripts do not exist.

- [ ] **Step 3: Implement the scripts**

`sign-release.sh`: `set -euo pipefail`; require `GPG_KEY_ID`. If `GPG_PRIVATE_KEY` is set (CI), create a temporary `GNUPGHOME`, import the armored key from the environment, and sign with that home; otherwise sign with the current keyring (local tests). Sign both `SHA256SUMS` and `linux-update.json` with `gpg --batch --yes --armor --local-user "$GPG_KEY_ID" --detach-sign --output <file>.asc <file>`. `verify-release.sh`: `gpg --batch --verify` both `.asc` files against their originals, exit nonzero on any failure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/linux/signing.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add linux/scripts/sign-release.sh linux/scripts/verify-release.sh tests/linux/signing.test.mjs
git commit -m "feat: sign and verify release checksums and manifest"
```

---

### Task 6: Build workflow — matrix, container install tests, publish

**Files:**
- Create: `linux/electron-builder.config.mjs` (wrapper config importing the upstream export; adds the Linux formats and branding)
- Modify: `linux/scripts/apply-patches.mjs` (add a guarded `--series/--target` CLI; keep the module export unchanged)
- Create: `linux/build/build.sh`
- Create: `linux/scripts/test-containers.sh`
- Create: `.github/workflows/build-linux.yml`

**Interfaces:**
- Consumes: Task 2 `apply-patches.mjs`, Task 3 `release.mjs`, Task 4 `verify-artifacts.mjs`, Task 5 signing scripts, and the Task 1 spike's build command/artifact path and branding findings.
- Produces: a GitHub Release `v<version>-linux.<n>` with exactly the assets from Global Constraints, whose packaged window title is `DeepSeek Harness`, whose `.desktop` entry and icon are installed, and whose window class matches the desktop entry.

- [ ] **Step 1: Write the wrapper config, applier CLI, and build script**

Add a guarded CLI to `linux/scripts/apply-patches.mjs` so `node linux/scripts/apply-patches.mjs --series linux/patches --target upstream` applies the series (same `applyPatches` export; import must not run the CLI). `linux/electron-builder.config.mjs` imports upstream's config factory (the spike doc records the exact module) and extends the Linux side to produce `AppImage`, `deb`, `rpm`, and `pacman` artifacts. The spike proved the upstream packaging command emits AppImage only; choose the mechanism that produces all four (extend the packaging call, or run `electron-builder --config linux/electron-builder.config.mjs` against the prepared tree) and record the exact command in the build script. `linux/build/build.sh` takes `VERSION`, `BUILD_NUMBER`, `DIST_DIR`; runs from the repo root, enters `upstream/`, runs that command with `DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=x64`, then collects the four outputs into `DIST_DIR` under the exact Global-Constraints names (copy/rename). Nonzero exit on any missing format.

- [ ] **Step 2: Write the container install script**

`linux/scripts/test-containers.sh <dist-dir>` runs, with `set -euo pipefail`:
- `docker run --rm -v "$PWD/dist:/dist:ro" debian:12 bash -c 'apt-get update -qq && apt-get install -y /dist/*.deb && test -x "/opt/DeepSeek Harness/deepseek-harness" && ls /usr/share/applications/*.desktop && ldd "/opt/DeepSeek Harness/deepseek-harness" | (! grep "not found")'`
- `fedora:44` with `dnf install -y /dist/*.rpm` and the same three checks
- `archlinux:latest` with `pacman -U --noconfirm /dist/*.pkg.tar.zst` and the same checks
- `opensuse/tumbleweed:latest` with `zypper --non-interactive install /dist/*.rpm` and the same checks
- `ubuntu:22.04` with the deb and the same checks

If the spike records a different install path, use that exact path in each command; the three assertions (binary executable, desktop entry present, no unresolved shared libraries) do not change.

- [ ] **Step 3: Brand the package and fix the window title**

The spike built the unsigned/local profile and produced the window title `DSH Local Build`, a default Electron icon, and a `StartupWMClass` that does not match the real window classes. In the wrapper config and build script: set the product title to `DeepSeek Harness` (use the official client assets/profile title — `DSH_CLIENT_TITLE=DeepSeek Harness` — or the smallest overlay patch that achieves it without enabling signing or upload), set `executableName` to `deepseek-harness`, install the DeepSeek Harness icon, and set the electron-builder Linux desktop metadata so the installed `.desktop` `Name` and `StartupWMClass` match the packaged window. Then verify: launch the built AppImage under Xvfb (same isolation recipe as the spike) and assert with `xdotool search --name '^DeepSeek Harness$'` that a window exists, and that the extracted `.desktop` file's `Name=DeepSeek Harness`.

- [ ] **Step 4: Write the workflow**

`.github/workflows/build-linux.yml`:
```yaml
name: Build Linux
on:
  workflow_dispatch:
    inputs:
      version: { type: string, required: true }
      build_number: { type: number, required: true }
permissions:
  contents: write
  issues: write
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { repository: deepseek-ai/deepseek-harness, ref: "dsh-v${{ inputs.version }}", path: upstream }
      - uses: pnpm/action-setup@v4
        with: { version: 11.28.5 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node linux/scripts/apply-patches.mjs --series linux/patches --target upstream
      - run: corepack enable && pnpm install --frozen-lockfile
        working-directory: upstream
      - run: bash linux/build/build.sh
        env: { VERSION: "${{ inputs.version }}", BUILD_NUMBER: "${{ inputs.build_number }}", DIST_DIR: dist }
      - run: node linux/scripts/assemble-release.mjs --dir dist --version "${{ inputs.version }}" --tag "v${{ inputs.version }}-linux.${{ inputs.build_number }}"
      - run: node linux/scripts/verify-artifacts.mjs --dir dist --version "${{ inputs.version }}"
      - run: bash linux/scripts/test-containers.sh dist
      - run: bash linux/scripts/sign-release.sh dist
        env: { GPG_PRIVATE_KEY: "${{ secrets.GPG_PRIVATE_KEY }}", GPG_KEY_ID: "${{ secrets.GPG_KEY_ID }}" }
      - run: bash linux/scripts/verify-release.sh dist
        env: { GPG_PRIVATE_KEY: "${{ secrets.GPG_PRIVATE_KEY }}", GPG_KEY_ID: "${{ secrets.GPG_KEY_ID }}" }
      - run: |
          gh release create "v${{ inputs.version }}-linux.${{ inputs.build_number }}" dist/* \
            --title "DSH Linux ${{ inputs.version }}-linux.${{ inputs.build_number }}" \
            --notes "Built from upstream dsh-v${{ inputs.version }}."
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
      - if: failure()
        run: |
          gh issue create \
            --title "Linux build failed for v${{ inputs.version }}-linux.${{ inputs.build_number }}" \
            --body "Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

- [ ] **Step 5: Validate the workflow locally where possible**

Run: `bash -n linux/build/build.sh linux/scripts/test-containers.sh linux/scripts/sign-release.sh linux/scripts/verify-release.sh`
Expected: no syntax errors. After Task 8's one-time setup, run the workflow with `version=0.2.2-rc.1`, `build_number=1` and follow the first failure to its step.

- [ ] **Step 6: Commit**

```bash
git add linux/build linux/scripts/test-containers.sh .github/workflows/build-linux.yml
git commit -m "feat: Linux build workflow with container install tests and signing"
```

---

### Task 7: Sync workflow — upstream `latest` to a release

**Files:**
- Create: `linux/scripts/resolve-upstream.mjs` (pure helpers + CLI)
- Create: `linux/scripts/decide-sync.mjs` (CLI over `decideSync`)
- Create: `tests/linux/upstream.test.mjs`
- Create: `.github/workflows/sync-upstream.yml`

**Interfaces:**
- Produces: `resolveUpstream({ latestVersion, tags })` → `{ version, tag }`; throws `UpstreamError` when `dsh-v<latestVersion>` is absent; `releaseTagsFromList(list)` → tags matching the linux release pattern (used by Task 8 and the workflow).

- [ ] **Step 1: Write the failing test**

```js
// tests/linux/upstream.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveUpstream, UpstreamError } from '../../linux/scripts/resolve-upstream.mjs'

test('maps the npm latest version to its git tag', () => {
  assert.deepEqual(resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.1', 'dsh-v0.2.2-rc.2'] }),
    { version: '0.2.2-rc.1', tag: 'dsh-v0.2.2-rc.1' })
})

test('throws when the tag is missing', () => {
  assert.throws(() => resolveUpstream({ latestVersion: '0.2.2-rc.1', tags: ['dsh-v0.2.2-rc.2'] }), UpstreamError)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/linux/upstream.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers and the workflow**

`resolve-upstream.mjs` exports `resolveUpstream`/`UpstreamError` and a CLI `--latest <version> --tags-file <path>` that prints `tag=dsh-v<version>` and exits 1 with a message when the tag is missing. `decide-sync.mjs` imports `decideSync` and, given `--latest <version> --releases-file <path>`, prints `action=build|none` and `version=<version>` lines so the workflow can append them to `$GITHUB_OUTPUT`. `.github/workflows/sync-upstream.yml`:

```yaml
name: Sync upstream
on:
  schedule: [{ cron: "*/30 * * * *" }]
  workflow_dispatch:
permissions:
  contents: read
  actions: write
  issues: write
jobs:
  sync:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - id: latest
        run: echo "version=$(npm view @deepseek-ai/dsh@latest version)" >> "$GITHUB_OUTPUT"
      - name: Validate the upstream tag exists
        run: |
          git ls-remote --tags https://github.com/deepseek-ai/deepseek-harness.git 'dsh-v*' > /tmp/tags.txt
          node linux/scripts/resolve-upstream.mjs --latest "${{ steps.latest.outputs.version }}" --tags-file /tmp/tags.txt
      - id: decide
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
        run: |
          gh release list --limit 100 --json tagName --jq '.[].tagName' > /tmp/releases.txt
          node linux/scripts/decide-sync.mjs --latest "${{ steps.latest.outputs.version }}" --releases-file /tmp/releases.txt >> "$GITHUB_OUTPUT"
      - if: steps.decide.outputs.action == 'build'
        run: gh workflow run build-linux.yml --ref "${{ github.event.repository.default_branch }}" -f version="${{ steps.decide.outputs.version }}" -f build_number=1
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
      - if: failure()
        run: |
          gh issue create --title "Upstream sync failed" \
            --body "Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

- [ ] **Step 4: Run the tests and lint the YAML**

Run: `node --test tests/linux/upstream.test.mjs`
Expected: PASS (2 tests). Then `git push` and manually dispatch `sync-upstream` once; it must dispatch `build-linux` exactly once for an unreleased version.

- [ ] **Step 5: Commit**

```bash
git add linux/scripts/resolve-upstream.mjs tests/linux/upstream.test.mjs .github/workflows/sync-upstream.yml
git commit -m "feat: scheduled upstream sync with tag validation and failure issues"
```

---

### Task 8: Repo bootstrap, docs, first release, and Fedora verification

**Files:**
- Create: `README.md`
- Create: `LICENSE` (MIT, upstream copyright preserved)
- Create: `NOTICE`
- Create: `docs/install.md`
- Create: `docs/maintainers.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: a live release `v0.2.2-rc.1-linux.1` installable on the supported distros and runnable on this Fedora 44 machine.

- [ ] **Step 1: Write the docs**

`README.md`: what this is (unofficial Linux desktop builds), supported distros, install commands per format, verify commands (`sha256sum -c SHA256SUMS`, `gpg --verify`), FUSE fallback, one-line downgrade path, a pointer to the issue tracker, and a **known limitations** section carried over from the spike (image attachments can crash on Linux because of the sharp/Electron GLib issue; Office-to-PDF conversion is unavailable until upstream ships a Linux LibreOfficeKit engine; the unsigned build must display the official client title). `docs/install.md`: per-distro commands. `docs/maintainers.md`: how sync/build/publish work, how to fix a failed patch, where secrets live, the release tag scheme. `NOTICE`: upstream MIT, DeepSeek authorship, modifications (overlay + Linux packaging).

- [ ] **Step 2: One-time repo setup**

```bash
# Generate the project key once (no expiry), keep the private half off-machine.
gpg --batch --passphrase '' --quick-generate-key "DSH Linux <dsh-linux@invalid>" ed25519 sign 0
FPR=$(gpg --batch --with-colons --list-secret-keys | awk -F: '/^fpr:/{print $10; exit}')
gpg --armor --export-secret-keys "$FPR" > key.asc
gpg --armor --export "$FPR" > dsh-linux-pubkey.asc

gh api -X PUT repos/CaullenOmdahl/deepseek-harness-linux/actions/permissions -f enabled=true
gh secret set GPG_PRIVATE_KEY < key.asc
gh secret set GPG_KEY_ID --body "$FPR"
```

Expected: Actions enabled; secrets present; `dsh-linux-pubkey.asc` committed to the repo and linked from the README. Delete `key.asc` after the secret is set.

- [ ] **Step 3: Run the first release**

```bash
git push -u origin HEAD
```

Dispatch `build-linux` with `version=0.2.2-rc.1`, `build_number=1`; wait for green. Expected: release with exactly the four artifacts plus `SHA256SUMS`, `SHA256SUMS.asc`, `linux-update.json`, `linux-update.json.asc`; `verify-release.sh` passes on the downloaded set.

- [ ] **Step 4: Verify on this Fedora 44 machine**

```bash
cd /tmp && mkdir -p dsh-linux-verify && cd dsh-linux-verify
gh release download v0.2.2-rc.1-linux.1 -R CaullenOmdahl/deepseek-harness-linux
sha256sum -c SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
chmod +x deepseek-harness-0.2.2-rc.1-x86_64.AppImage
timeout 30 xvfb-run -a ./deepseek-harness-0.2.2-rc.1-x86_64.AppImage --appimage-extract-and-run --no-sandbox &
sleep 15 && ps -p $! >/dev/null && echo "boots"
```

Then launch the AppImage on the Wayland session and check `wmctrl -l` (or GNOME's window title) shows `DeepSeek Harness`; install wmctrl if needed (`sudo dnf install -y wmctrl`). Record the screenshot or title in the issue announcing the release.

- [ ] **Step 5: Commit and tag**

```bash
git add README.md LICENSE NOTICE docs
git commit -m "docs: install, verification, and maintainer guide"
git push
```

---

## Self-Review Notes

- **Spec coverage:** repo model (Task 1/8), sync (Task 7), matrix and formats (Tasks 3/6), artifacts and signing (Tasks 4/5/6), failure handling and issue (Tasks 6/7), verification (Tasks 6/8), docs (Task 8). Deferred to Plan 2: the sidebar Update button, per-format self-update, restart, rollback UI, Flatpak, arm64.
- **Type consistency:** `artifactName(format, version)` is used identically in Tasks 4 and 6; `releaseTag`/`nextBuildNumber` feed Task 7 via `decideSync`; manifest asset keys `<format>/<arch>` are produced once in Task 4.
- **Review Focus tests:** (1) Task 8 title check + Task 6 Ubuntu 22.04/Debian 12 container checks; (2) Task 3 build-number test; (3) Task 4 checksum test; (4) Task 7 missing-tag test; (5) Task 2 conflict test + Task 6 failure issue.
