#!/usr/bin/env bash
# Build the libvips that ships with the packaged app.
#
# Why this exists: sharp 0.35.x requires libvips >= 8.18.7, and sharp's npm prebuilds
# bundle a libvips whose glib/GObject are statically linked. Inside the Electron runtime
# that static glib collides with the system glib Electron loads, corrupting GObject state:
# the first image decode (any attached image) segfaults the DSH host. Rebuilding sharp's
# addon against that bundled libvips still crashes; a libvips that links the system glib
# dynamically works. So the Linux build compiles libvips itself, bundles it beside the
# app, and links sharp's addon against it.
#
# Usage: linux/scripts/build-libvips.sh <prefix> [version]
#
# Build-host prerequisites (installed by .github/workflows/build-linux.yml):
#   meson, ninja, pkg-config, patchelf, a C/C++ toolchain, and the development packages
#   for glib-2.0 (glib2-devel on Arch), zlib, libjpeg, libpng, libwebp, libexif and lcms2.
#
# Output layout under <prefix>:
#   lib/libvips.so.42, lib/libvips-cpp.so.42   the library sharp links against
#   lib/pkgconfig/vips-cpp.pc                  pkg-config metadata for the addon build
#   lib/bundle/                                non-glib codec libraries for portability
# Both libvips libraries get an $ORIGIN rpath so the bundle is self-contained.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: linux/scripts/build-libvips.sh <prefix> [version]
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

PREFIX=$1
VIPS_VERSION=${2:-8.18.7}
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT

mkdir -p -- "$PREFIX"
PREFIX=$(cd "$PREFIX" && pwd)

for tool in meson ninja patchelf pkg-config; do
  command -v "$tool" >/dev/null 2>&1 || { echo "vips: error: missing $tool" >&2; exit 1; }
done

echo "vips: building $VIPS_VERSION into $PREFIX"

cd "$WORK"
URL="https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz"
echo "vips: fetching $URL"
curl -fsSL --retry 3 -o "vips-${VIPS_VERSION}.tar.xz" "$URL"
tar -xf "vips-${VIPS_VERSION}.tar.xz"
cd "vips-${VIPS_VERSION}"

# Explicit features keep the build reproducible across hosts: the codecs sharp needs are
# required (the build fails rather than silently omitting them), everything else is off.
# modules=disabled keeps libvips hermetic; the artifacts carry the library itself.
meson setup build \
  --prefix="$PREFIX" \
  --libdir=lib \
  --buildtype=release \
  -Ddeprecated=false \
  -Dexamples=false \
  -Dcplusplus=true \
  -Ddocs=false \
  -Dcpp-docs=false \
  -Dvapi=false \
  -Dintrospection=disabled \
  -Dmodules=disabled \
  -Dzlib=enabled \
  -Djpeg=enabled \
  -Dpng=enabled \
  -Dwebp=enabled \
  -Dexif=enabled \
  -Dlcms=enabled \
  -Dtiff=disabled \
  -Dheif=disabled \
  -Dheif-module=disabled \
  -Djpeg-xl=disabled \
  -Djpeg-xl-module=disabled \
  -Duhdr=disabled \
  -Dimagequant=disabled \
  -Dquantizr=disabled \
  -Dmagick=disabled \
  -Dmagick-module=disabled \
  -Dopenexr=disabled \
  -Dopenjpeg=disabled \
  -Dopenslide=disabled \
  -Dopenslide-module=disabled \
  -Dpdfium=disabled \
  -Dpoppler=disabled \
  -Dpoppler-module=disabled \
  -Dcfitsio=disabled \
  -Dcgif=disabled \
  -Dfftw=disabled \
  -Dfontconfig=disabled \
  -Dpangocairo=disabled \
  -Draw=disabled \
  -Darchive=disabled \
  -Dmatio=disabled \
  -Dnifti=disabled \
  -Drsvg=disabled \
  -Dspng=disabled \
  -Dhighway=disabled \
  -Dorc=disabled \
  -Dnsgif=false \
  -Dppm=false \
  -Danalyze=false \
  -Dradiance=false

ninja -C build
ninja -C build install

for lib in libvips.so.42 libvips-cpp.so.42; do
  [[ -e "$PREFIX/lib/$lib" ]] || { echo "vips: error: $PREFIX/lib/$lib was not built" >&2; exit 1; }
done
[[ -e "$PREFIX/lib/pkgconfig/vips-cpp.pc" ]] || { echo "vips: error: missing vips-cpp.pc" >&2; exit 1; }

# Bundle the runtime dependencies of libvips that a desktop system may not have, walking
# the NEEDED graph but never copying glib/libc/libstdc++/zlib: glib must stay the system's
# copy (two glib instances in one process is the bug this script avoids), and the rest are
# universal. This keeps the shipped tree to the codec libraries actually needed.
BUNDLE="$PREFIX/lib/bundle"
mkdir -p "$BUNDLE"
skip_lib() {
  case "$1" in
    libvips.so*|libvips-cpp.so*|libc.so*|libm.so*|libpthread.so*|libdl.so*|librt.so*|libgcc_s.so*|libstdc++.so*|ld-linux*|libz.so*|libglib-2.0.so*|libgobject-2.0.so*|libgio-2.0.so*|libgmodule-2.0.so*|libgthread-2.0.so*) return 0 ;;
  esac
  return 1
}
queue=("$PREFIX/lib/libvips.so.42" "$PREFIX/lib/libvips-cpp.so.42")
seen=" "
while [[ ${#queue[@]} -gt 0 ]]; do
  lib=${queue[0]}
  queue=("${queue[@]:1}")
  while read -r soname; do
    [[ "$soname" == "" ]] && continue
    skip_lib "$soname" && continue
    case "$seen" in *" $soname "*) continue ;; esac
    seen+="$soname "
    dep=$(ldd "$lib" 2>/dev/null | awk -v s="$soname" '$1 == s { print $3; exit }')
    [[ -f "$dep" ]] || continue
    cp -fL -- "$dep" "$BUNDLE/$soname"
    queue+=("$BUNDLE/$soname")
  done < <(readelf -d "$lib" 2>/dev/null | sed -n 's/.*(NEEDED).*\[\(.*\)\].*/\1/p')
done

# $ORIGIN resolves the sibling libvips library; $ORIGIN/bundle resolves the codecs.
patchelf --set-rpath '$ORIGIN:$ORIGIN/bundle' "$PREFIX/lib/libvips-cpp.so.42"
patchelf --set-rpath '$ORIGIN:$ORIGIN/bundle' "$PREFIX/lib/libvips.so.42"

echo "vips: built $VIPS_VERSION into $PREFIX ($(ls "$BUNDLE" | wc -l) bundled libs)"
