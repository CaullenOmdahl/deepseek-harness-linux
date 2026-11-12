#!/usr/bin/env bash
# Install the built packages in clean distro containers and assert the installed app.
#
# Usage: linux/scripts/test-containers.sh <dist-dir>
#
# The dist directory must contain exactly one deb, one rpm, and one pacman package
# (the AppImage is not installed; it is verified by extraction in Task 8). Each
# container installs its native format and then checks:
#   1. /opt/DeepSeek Harness/deepseek-harness is executable,
#   2. /usr/share/applications/deepseek-harness.desktop exists and names the app,
#   3. ldd on the installed binary reports no unresolved shared library.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <dist-dir>" >&2
  exit 2
fi

dist=$1
if [[ ! -d "$dist" ]]; then
  echo "error: not a directory: $dist" >&2
  exit 1
fi
dist=$(cd "$dist" && pwd)

for specification in '*.deb' '*.rpm' '*.pkg.tar.zst'; do
  shopt -s nullglob
  matches=("$dist"/$specification)
  shopt -u nullglob
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "error: expected exactly one $specification in $dist, found ${#matches[@]}" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to run the container install tests" >&2
  exit 1
fi

# Run one container: install the package, then apply the three install assertions.
# $1 image, $2 shell command that installs the package from /dist.
run_container() {
  local image=$1
  local install=$2
  echo "== $image =="
  docker run --rm -v "$dist:/dist:ro" "$image" bash -c "set -euo pipefail
$install
binary='/opt/DeepSeek Harness/deepseek-harness'
test -x \"\$binary\"
ls /usr/share/applications/*.desktop
desktop='/usr/share/applications/deepseek-harness.desktop'
test -f \"\$desktop\"
grep -qx 'Name=DeepSeek Harness' \"\$desktop\"
grep -qx 'StartupWMClass=deepseek-harness' \"\$desktop\"
if ldd \"\$binary\" | grep 'not found'; then
  echo 'error: unresolved shared libraries' >&2
  exit 1
fi
echo \"container checks passed: \$desktop\"
"
}

run_container debian:12 'apt-get update -qq && apt-get install -y /dist/*.deb'
run_container ubuntu:22.04 'apt-get update -qq && apt-get install -y /dist/*.deb'
run_container fedora:44 'dnf install -y /dist/*.rpm'
# The packages are unsigned (the release is authenticated by SHA256SUMS and the GPG manifest).
run_container 'opensuse/tumbleweed:latest' 'zypper --non-interactive --no-gpg-checks install /dist/*.rpm'
# A full upgrade first: the rolling image is older than the repositories and -Sy alone
# leaves conflicting partial-upgrade packages.
run_container 'archlinux:latest' 'pacman -Syu --noconfirm && pacman -U --noconfirm /dist/*.pkg.tar.zst'

echo "test-containers: all install tests passed"
