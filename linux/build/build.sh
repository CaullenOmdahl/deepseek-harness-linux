#!/usr/bin/env bash
# Build the four Linux release artifacts from a prepared upstream checkout.
#
# Usage: VERSION=<version> BUILD_NUMBER=<n> DIST_DIR=<dir> linux/build/build.sh
#
# Required environment:
#   VERSION       Upstream product version, e.g. 0.2.2-rc.1. Must match the upstream
#                 checkout's desktop package version.
#   BUILD_NUMBER  1-based release build number. Release file names use VERSION only,
#                 but the wrapped electron-builder config maps this number to the
#                 package iteration/release so a rebuild upgrades the previous one.
#   DIST_DIR      Output directory for the four renamed release artifacts.
#
# Optional environment:
#   PNPM_CMD      pnpm command, e.g. "corepack pnpm" on hosts where the standalone
#                 native pnpm makes upstream's `node $npm_execpath` child fail.
#
# Prerequisites, as run by .github/workflows/build-linux.yml:
#   - upstream/ checked out at tag dsh-v$VERSION and `pnpm install --frozen-lockfile` done;
#   - Node.js, git, and the fpm host tools (rpmbuild, bsdtar, xz) available.
#
# Packaging mechanism: upstream's package-target prepares the complete unsigned Linux
# tree but hard-codes AppImage as the only electron-builder target. This script runs
# that command with `--prepare-only`, then runs electron-builder itself with the
# overlay wrapper config (linux/electron-builder.config.mjs), which reuses upstream's
# config factory and adds deb/rpm/pacman plus the Linux branding. The four unsigned
# outputs are then copied to DIST_DIR under the release artifact names.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: VERSION=<version> BUILD_NUMBER=<n> DIST_DIR=<dir> linux/build/build.sh
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

for name in VERSION BUILD_NUMBER DIST_DIR; do
  if [[ -z "${!name:-}" ]]; then
    usage
    fail "$name is required"
  fi
done

if [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  fail "BUILD_NUMBER must be a positive integer, got '$BUILD_NUMBER'"
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
UPSTREAM="$ROOT/upstream"
DESKTOP="$UPSTREAM/apps/desktop"
ARTIFACT_DIR="$DESKTOP/.desktop-build/targets/linux-x64/unsigned-artifacts"
WRAPPER_CONFIG="$ROOT/linux/electron-builder.config.mjs"

[[ -d "$UPSTREAM/.git" ]] || fail "missing upstream checkout at $UPSTREAM; clone deepseek-harness at dsh-v$VERSION there"
[[ -f "$DESKTOP/package.json" ]] || fail "missing $DESKTOP/package.json"
[[ -d "$UPSTREAM/node_modules" ]] || fail "missing $UPSTREAM/node_modules; run 'pnpm install --frozen-lockfile' in upstream/"
[[ -f "$WRAPPER_CONFIG" ]] || fail "missing wrapper config $WRAPPER_CONFIG"

upstream_version=$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$DESKTOP/package.json")
if [[ "$upstream_version" != "$VERSION" ]]; then
  fail "VERSION=$VERSION does not match upstream desktop version $upstream_version"
fi

mkdir -p "$DIST_DIR"
DIST_DIR=$(cd "$DIST_DIR" && pwd)

if [[ -n "${PNPM_CMD:-}" ]]; then
  read -r -a pnpm_command <<< "$PNPM_CMD"
else
  pnpm_command=(pnpm)
fi

# The overlay patch series must be applied exactly once; the applier is idempotent so
# reruns and the workflow's explicit apply step are both safe.
node "$ROOT/linux/scripts/apply-patches.mjs" --series "$ROOT/linux/patches" --target "$UPSTREAM"

# The local/unsigned profile otherwise brands the window "DSH Local Build"; the branding
# patch (linux/patches/0002-brand-window-title.patch) reads this overlay-owned selector.
linux_env=(
  "DSH_DESKTOP_TARGET_PLATFORM=linux"
  "DSH_DESKTOP_TARGET_ARCH=x64"
  "DSH_DESKTOP_UNSIGNED=1"
  "DSH_DESKTOP_APP_ID=com.deepseek.harness"
  "DSH_LINUX_CLIENT_TITLE=DeepSeek Harness"
  "BUILD_NUMBER=$BUILD_NUMBER"
)

formats=(appimage deb rpm pacman)
patterns=('*-unsigned.AppImage' '*-unsigned.deb' '*-unsigned.rpm' '*-unsigned.pacman')

echo "build: upstream $VERSION, Linux release build $BUILD_NUMBER (package iteration $BUILD_NUMBER)"
echo "build: pnpm command: ${pnpm_command[*]}"

# Remove outputs from earlier builds so the collection step can require exactly one file.
shopt -s nullglob
for pattern in "${patterns[@]}"; do
  for stale in "$ARTIFACT_DIR"/${pattern}; do
    rm -f -- "$stale"
  done
done
shopt -u nullglob

# 1. Build the runtime and prepare the unsigned Linux tree (no electron-builder artifacts).
(
  cd "$UPSTREAM"
  env "${linux_env[@]}" "${pnpm_command[@]}" exec tsx apps/desktop/scripts/package-target.ts linux-x64 --prepare-only
)

# The prepared tree ships sharp's prebuilt addon, whose bundled libvips statically links
# glib: inside Electron that corrupts GObject state and the first image decode segfaults
# the host. Build a glib-dynamic libvips to bundle with every artifact; the wrapper's
# afterPack hook (linux/electron-builder.config.mjs) rebuilds sharp's addon against it and
# verifies a decode with the packaged binary before any artifact is written.
VIPS_VERSION=${VIPS_VERSION:-8.18.7}
VIPS_PREFIX="$ROOT/.cache/linux-libvips-$VIPS_VERSION"
if [[ ! -e "$VIPS_PREFIX/lib/pkgconfig/vips-cpp.pc" ]]; then
  bash "$ROOT/linux/scripts/build-libvips.sh" "$VIPS_PREFIX" "$VIPS_VERSION"
fi
export DSH_VIPS_PREFIX="$VIPS_PREFIX"
if [[ -z "${DSH_ELECTRON_VERSION:-}" ]]; then
  DSH_ELECTRON_VERSION=$(node --input-type=module -e '
    import { createRequire } from "node:module"
    const require = createRequire(process.argv[1] + "/package.json")
    process.stdout.write(require("electron/package.json").version)
  ' "$DESKTOP")
fi
export DSH_ELECTRON_VERSION

# 2. Package the prepared tree with all four formats and the Linux branding.
(
  cd "$DESKTOP"
  env "${linux_env[@]}" "${pnpm_command[@]}" exec electron-builder \
    --config "$WRAPPER_CONFIG" \
    --linux --x64 \
    --publish never
)

# 3. Copy the unsigned outputs to DIST_DIR under the release artifact names.
mapfile -t release_names < <(node --input-type=module -e '
  const { artifactName } = await import(process.argv[1])
  for (const format of ["appimage", "deb", "rpm", "pacman"]) process.stdout.write(`${artifactName(format, process.argv[2])}\n`)
' "$ROOT/linux/lib/release.mjs" "$VERSION")
if [[ "${#release_names[@]}" -ne "${#formats[@]}" ]]; then
  fail "could not resolve the four release artifact names"
fi

shopt -s nullglob
for index in "${!formats[@]}"; do
  format=${formats[$index]}
  matches=("$ARTIFACT_DIR"/${patterns[$index]})
  if [[ "${#matches[@]}" -ne 1 ]]; then
    fail "expected exactly one unsigned $format artifact in $ARTIFACT_DIR, found ${#matches[@]}"
  fi
  source=${matches[0]}
  destination="$DIST_DIR/${release_names[$index]}"
  cp -f -- "$source" "$destination"
  echo "dist: ${release_names[$index]} ($(stat -c %s "$destination") bytes)"
done
shopt -u nullglob

echo "build: four artifacts in $DIST_DIR"
