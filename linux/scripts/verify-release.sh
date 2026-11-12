#!/usr/bin/env bash
# Verify the detached signatures next to the release metadata.
#
# Usage: linux/scripts/verify-release.sh <dir> [--pubkey <file>]
#
# Verification is pinned to the project key: the committed
# `dsh-linux-pubkey.asc` is checked against the expected fingerprint, imported
# into a private temporary GNUPGHOME, and every signature must carry a VALIDSIG
# fingerprint equal to that key. A signature from any other key fails, even when
# that key is trusted in the caller's keyring. `--pubkey` exists only for tests
# with throwaway keys: it pins verification to that key instead of the committed
# one, so a second key cannot pass for the project key. CI always uses the
# committed key and therefore also checks it against the expected fingerprint.
#
# Exits 0 only when both SHA256SUMS and linux-update.json verify against their
# .asc signatures.

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

if [[ ! -f "$pubkey" ]]; then
  echo "error: public key not found: $pubkey" >&2
  exit 1
fi

for name in SHA256SUMS linux-update.json; do
  for path in "$dir/$name" "$dir/$name.asc"; do
    if [[ ! -f "$path" ]]; then
      echo "error: missing $path" >&2
      exit 1
    fi
  done
done

# Resolve the key fingerprint before touching GNUPGHOME; the selected key must
# be the published one or every signature below would be meaningless.
key_fingerprint=$(gpg --batch --with-colons --import-options show-only --import "$pubkey" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print toupper($10); exit }')
if [[ -z "$key_fingerprint" ]]; then
  echo "error: cannot read a fingerprint from $pubkey" >&2
  exit 1
fi
if [[ "$pubkey_override" == false && "$key_fingerprint" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "error: committed $pubkey has fingerprint $key_fingerprint, expected $EXPECTED_FINGERPRINT" >&2
  exit 1
fi
# Verification is always pinned to the selected key's fingerprint.
expected_fingerprint=$key_fingerprint

# The copy shipped on the release page must be byte-identical to the committed key.
if [[ -f "$dir/dsh-linux-pubkey.asc" ]] && ! cmp -s "$pubkey" "$dir/dsh-linux-pubkey.asc"; then
  echo "error: release copy $dir/dsh-linux-pubkey.asc differs from $pubkey" >&2
  exit 1
fi

tmp_home=""
tmp_err=""

cleanup() {
  if [[ -n "$tmp_home" ]]; then
    gpgconf --homedir "$tmp_home" --kill all >/dev/null 2>&1 || true
    rm -rf "$tmp_home"
  fi
  if [[ -n "$tmp_err" ]]; then
    rm -f "$tmp_err"
  fi
}
trap cleanup EXIT INT TERM

tmp_home=$(mktemp -d "${TMPDIR:-/tmp}/dsh-gnupg.XXXXXXXX")
chmod 700 "$tmp_home"
export GNUPGHOME="$tmp_home"
tmp_err=$(mktemp "${TMPDIR:-/tmp}/dsh-gpg-err.XXXXXXXX")

import_output=""
if ! import_output=$(gpg --batch --yes --no-tty --import "$pubkey" 2>&1); then
  echo "error: failed to import $pubkey" >&2
  printf '%s\n' "$import_output" >&2
  exit 1
fi

status=0

for name in SHA256SUMS linux-update.json; do
  status_output=""
  if status_output=$(gpg --batch --status-fd 1 --verify "$dir/$name.asc" "$dir/$name" 2>"$tmp_err"); then
    if ! printf '%s\n' "$status_output" | awk -v expected="$expected_fingerprint" '
      $2 == "VALIDSIG" {
        found = 1
        # VALIDSIG <sig-key-fpr> ... <primary-key-fpr>: both must be the published key.
        if (toupper($3) != expected) bad = 1
        if (NF >= 12 && toupper($NF) != expected) bad = 1
      }
      END { exit (found && !bad) ? 0 : 1 }
    '; then
      echo "error: $dir/$name.asc is not signed by the published key $expected_fingerprint" >&2
      printf '%s\n' "$status_output" | grep '^\[GNUPG:\]' >&2 || true
      status=1
      continue
    fi
    echo "verified $dir/$name.asc (fingerprint $expected_fingerprint)"
  else
    echo "error: signature verification failed for $dir/$name.asc" >&2
    cat "$tmp_err" >&2
    status=1
  fi
done

exit "$status"
