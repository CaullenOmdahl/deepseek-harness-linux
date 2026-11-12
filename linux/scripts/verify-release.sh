#!/usr/bin/env bash
# Verify the detached signatures next to the release metadata.
#
# Usage: linux/scripts/verify-release.sh <dir>
#
# Exits 0 only when both SHA256SUMS and linux-update.json verify against their
# .asc signatures. When GPG_PRIVATE_KEY is set (CI), its public key is imported
# into a temporary GNUPGHOME first, so signing and verification work in the same
# keyless job; otherwise the ambient keyring is used.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <dir>" >&2
  exit 2
fi

dir=$1

for name in SHA256SUMS linux-update.json; do
  for path in "$dir/$name" "$dir/$name.asc"; do
    if [[ ! -f "$path" ]]; then
      echo "error: missing $path" >&2
      exit 1
    fi
  done
done

tmp_home=""

cleanup() {
  if [[ -n "$tmp_home" ]]; then
    gpgconf --homedir "$tmp_home" --kill all >/dev/null 2>&1 || true
    rm -rf "$tmp_home"
  fi
}
trap cleanup EXIT INT TERM

if [[ -n "${GPG_PRIVATE_KEY:-}" ]]; then
  tmp_home=$(mktemp -d "${TMPDIR:-/tmp}/dsh-gnupg.XXXXXXXX")
  chmod 700 "$tmp_home"
  export GNUPGHOME="$tmp_home"

  import_output=""
  if ! import_output=$(printf '%s\n' "$GPG_PRIVATE_KEY" | gpg --batch --yes --no-tty --import 2>&1); then
    echo "error: failed to import GPG_PRIVATE_KEY" >&2
    printf '%s\n' "$import_output" >&2
    exit 1
  fi
fi

status=0

for name in SHA256SUMS linux-update.json; do
  verify_output=""
  if verify_output=$(gpg --batch --verify "$dir/$name.asc" "$dir/$name" 2>&1); then
    echo "verified $dir/$name.asc"
  else
    echo "error: signature verification failed for $dir/$name.asc" >&2
    printf '%s\n' "$verify_output" >&2
    status=1
  fi
done

exit "$status"
