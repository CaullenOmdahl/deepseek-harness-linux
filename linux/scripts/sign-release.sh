#!/usr/bin/env bash
# Sign the release metadata produced by linux/scripts/assemble-release.mjs.
#
# Usage: linux/scripts/sign-release.sh <dir> [--pubkey <file>]
#
# Requires GPG_KEY_ID, the fingerprint or key id used to sign. The signing key
# must match the public key that verifies the release: the committed
# `dsh-linux-pubkey.asc` by default, or `--pubkey` for tests with throwaway keys.
# Signing with a key that does not match the published key fails before any
# signature is written, so a mis-set secret cannot produce an unverifiable release.
#
# When GPG_PRIVATE_KEY holds an armored private key (CI), the key is imported into
# a temporary GNUPGHOME that is removed on exit and never leaves this process.
# When GPG_PRIVATE_KEY is unset, the ambient keyring is used (local runs/tests).

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

# Fingerprint of dsh-linux-pubkey.asc. Rotation must update this constant, the
# committed key, and the fingerprint in README.md and docs/.
EXPECTED_FINGERPRINT=D1C8807B90F7A51E7537FD7F4B692295FFFB9452

usage() {
  echo "usage: $0 <dir> [--pubkey <file>]" >&2
}

dir=""
pubkey="$ROOT/dsh-linux-pubkey.asc"
pubkey_override=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pubkey)
      if [[ $# -lt 2 ]]; then usage; exit 2; fi
      pubkey=$2
      pubkey_override=true
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [[ -n "$dir" ]]; then
        echo "error: unexpected argument: $1" >&2
        usage
        exit 2
      fi
      dir=$1
      shift
      ;;
  esac
done

if [[ -z "$dir" ]]; then
  usage
  exit 2
fi

if [[ -z "${GPG_KEY_ID:-}" ]]; then
  echo "error: GPG_KEY_ID is required" >&2
  exit 2
fi

if [[ ! -f "$pubkey" ]]; then
  echo "error: public key not found: $pubkey" >&2
  exit 1
fi

for name in SHA256SUMS linux-update.json; do
  if [[ ! -f "$dir/$name" ]]; then
    echo "error: missing $dir/$name; run assemble-release.mjs first" >&2
    exit 1
  fi
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

  # The armored key is fed on stdin, so it is never written outside the
  # temporary home. gpg diagnostics are only shown when the import fails.
  import_output=""
  if ! import_output=$(printf '%s\n' "$GPG_PRIVATE_KEY" | gpg --batch --yes --no-tty --import 2>&1); then
    echo "error: failed to import GPG_PRIVATE_KEY" >&2
    printf '%s\n' "$import_output" >&2
    exit 1
  fi
fi

published_fingerprint=$(gpg --batch --with-colons --import-options show-only --import "$pubkey" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print toupper($10); exit }')
if [[ -z "$published_fingerprint" ]]; then
  echo "error: cannot read a fingerprint from $pubkey" >&2
  exit 1
fi
if [[ "$pubkey_override" == false && "$published_fingerprint" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "error: committed $pubkey has fingerprint $published_fingerprint, expected $EXPECTED_FINGERPRINT" >&2
  exit 1
fi

signing_fingerprint=$(gpg --batch --with-colons --list-secret-keys -- "$GPG_KEY_ID" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print toupper($10); exit }')
if [[ -z "$signing_fingerprint" ]]; then
  echo "error: no secret key matches GPG_KEY_ID=$GPG_KEY_ID" >&2
  exit 1
fi
if [[ "$signing_fingerprint" != "$published_fingerprint" ]]; then
  echo "error: signing key $signing_fingerprint does not match the published key $published_fingerprint" >&2
  echo "error: refusing to sign a release that would not verify against $pubkey" >&2
  exit 1
fi

for name in SHA256SUMS linux-update.json; do
  gpg --batch --yes --armor \
    --local-user "$signing_fingerprint" \
    --detach-sign \
    --output "$dir/$name.asc" \
    "$dir/$name"
  echo "signed $dir/$name.asc with $signing_fingerprint"
done
