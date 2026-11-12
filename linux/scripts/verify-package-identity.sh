#!/usr/bin/env bash
# Verify the packed package identity and build-number ordering of a release set.
#
# Usage: linux/scripts/verify-package-identity.sh <dir> <version> <build-number>
#
# The release file names stay version-only by design, so the Linux build number
# must live in the package metadata: deb/rpm iteration and pacman pkgrel. This
# script asserts that metadata, the overlay maintainer/vendor/homepage identity
# (DeepSeek must not be named as the packager), the deb Section and copyright
# file, and the bundled LICENSE/NOTICE resources.

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <dir> <version> <build-number>" >&2
  exit 2
fi

dir=$1
version=$2
build_number=$3

if [[ ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: build number must be a positive integer, got '$build_number'" >&2
  exit 2
fi

MAINTAINER='DSH Linux maintainers <dsh-linux@invalid>'
VENDOR='DSH Linux maintainers'
HOMEPAGE='https://github.com/CaullenOmdahl/deepseek-harness-linux'
DEB_VERSION="${version//-/\~}-${build_number}"
RPM_VERSION="${version//-/\~}"
PACMAN_VERSION="${version//-/_}-${build_number}"

deb="$dir/deepseek-harness_${version}_amd64.deb"
rpm="$dir/deepseek-harness-${version}-1.x86_64.rpm"
pacman="$dir/deepseek-harness-${version}-1-x86_64.pkg.tar.zst"

for file in "$deb" "$rpm" "$pacman"; do
  [[ -f "$file" ]] || { echo "error: missing $file" >&2; exit 1; }
done

problems=0

fail() {
  echo "error: $*" >&2
  problems=1
}

expect() {
  local actual=$1 expected=$2 label=$3
  if [[ "$actual" != "$expected" ]]; then
    fail "$label is '$actual', expected '$expected'"
  fi
}

# Prefer bsdtar (libarchive) because it reads zstd without a separate binary.
archive_pkginfo() {
  if command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xOf "$1" .PKGINFO 2>/dev/null
  else
    tar --zstd -xOf "$1" .PKGINFO 2>/dev/null
  fi
}

archive_list() {
  if command -v bsdtar >/dev/null 2>&1; then
    bsdtar -tf "$1" 2>/dev/null
  else
    tar --zstd -tf "$1" 2>/dev/null
  fi
}

# ---- deb -------------------------------------------------------------------
expect "$(dpkg-deb -f "$deb" Package)" "deepseek-harness" "deb Package"
expect "$(dpkg-deb -f "$deb" Version)" "$DEB_VERSION" "deb Version"
expect "$(dpkg-deb -f "$deb" Maintainer)" "$MAINTAINER" "deb Maintainer"
expect "$(dpkg-deb -f "$deb" Homepage)" "$HOMEPAGE" "deb Homepage"
expect "$(dpkg-deb -f "$deb" Section)" "utils" "deb Section"

deb_files=$(dpkg-deb --fsys-tarfile "$deb" | tar -tf -)
for path in "./opt/DeepSeek Harness/resources/LICENSE" "./opt/DeepSeek Harness/resources/NOTICE" \
  "./usr/share/doc/deepseek-harness/copyright"; do
  grep -qxF -- "$path" <<< "$deb_files" || fail "deb is missing $path"
done

# ---- rpm -------------------------------------------------------------------
expect "$(rpm -qp --qf '%{VERSION}' "$rpm" 2>/dev/null)" "$RPM_VERSION" "rpm Version"
expect "$(rpm -qp --qf '%{RELEASE}' "$rpm" 2>/dev/null)" "$build_number" "rpm Release"
expect "$(rpm -qp --qf '%{VENDOR}' "$rpm" 2>/dev/null)" "$VENDOR" "rpm Vendor"
expect "$(rpm -qp --qf '%{PACKAGER}' "$rpm" 2>/dev/null)" "$MAINTAINER" "rpm Packager"
expect "$(rpm -qp --qf '%{URL}' "$rpm" 2>/dev/null)" "$HOMEPAGE" "rpm URL"
expect "$(rpm -qp --qf '%{LICENSE}' "$rpm" 2>/dev/null)" "MIT" "rpm License"

rpm_files=$(rpm -qlp "$rpm" 2>/dev/null)
for path in "/opt/DeepSeek Harness/resources/LICENSE" "/opt/DeepSeek Harness/resources/NOTICE"; do
  grep -qxF -- "$path" <<< "$rpm_files" || fail "rpm is missing $path"
done

# ---- pacman ----------------------------------------------------------------
pkginfo=$(archive_pkginfo "$pacman")
expect "$(awk -F' = ' '$1 == "pkgname" { print $2 }' <<< "$pkginfo")" "deepseek-harness" "pacman pkgname"
expect "$(awk -F' = ' '$1 == "pkgver" { print $2 }' <<< "$pkginfo")" "$PACMAN_VERSION" "pacman pkgver"
expect "$(awk -F' = ' '$1 == "packager" { print $2 }' <<< "$pkginfo")" "$MAINTAINER" "pacman packager"
expect "$(awk -F' = ' '$1 == "url" { print $2 }' <<< "$pkginfo")" "$HOMEPAGE" "pacman url"

pacman_files=$(archive_list "$pacman")
for path in "opt/DeepSeek Harness/resources/LICENSE" "opt/DeepSeek Harness/resources/NOTICE"; do
  grep -qxF -- "$path" <<< "$pacman_files" || fail "pacman is missing $path"
done

# ---- build-number ordering -------------------------------------------------
# The exact metadata above must also order after the preceding build of the same
# upstream version: -linux.2 upgrades -linux.1.
if (( build_number > 1 )); then
  previous_deb="${version//-/\~}-$((build_number - 1))"
  if ! dpkg --compare-versions "$DEB_VERSION" gt "$previous_deb"; then
    fail "deb version $DEB_VERSION does not upgrade $previous_deb"
  fi
  previous_pacman="${version//-/_}-$((build_number - 1))"
  if [[ "$(printf '%s\n%s\n' "$previous_pacman" "$PACMAN_VERSION" | sort -V | tail -1)" != "$PACMAN_VERSION" ]]; then
    fail "pacman pkgver $PACMAN_VERSION does not upgrade $previous_pacman"
  fi
fi

# ---- identity --------------------------------------------------------------
# DeepSeek is the upstream author, not this package's maintainer or vendor.
if grep -E 'DeepSeek' <<< "$(dpkg-deb -f "$deb" Maintainer)"
then
  fail "deb Maintainer names DeepSeek"
fi
if grep -E 'DeepSeek' <<< "$(rpm -qp --qf '%{VENDOR}\n%{PACKAGER}' "$rpm" 2>/dev/null)"
then
  fail "rpm Vendor/Packager names DeepSeek"
fi
if grep -E 'DeepSeek' <<< "$(awk -F' = ' '$1 == "packager" { print $2 }' <<< "$pkginfo")"
then
  fail "pacman packager names DeepSeek"
fi

if (( problems != 0 )); then
  exit 1
fi

echo "verified package identity for ${version}-linux.${build_number}: deb ${DEB_VERSION}, rpm ${RPM_VERSION}-${build_number}, pacman ${PACMAN_VERSION}"
