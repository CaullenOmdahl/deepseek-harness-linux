#!/usr/bin/env bash
# Sign the release metadata produced by linux/scripts/assemble-release.mjs.
#
# Usage: linux/scripts/sign-release.sh <dir>
#
# Requires GPG_KEY_ID, the fingerprint or key id used to sign. When
# GPG_PRIVATE_KEY holds an armored private key (CI), the key is imported into a
# temporary GNUPGHOME that is removed on exit and never leaves this process.
# When GPG_PRIVATE_KEY is unset, the ambient keyring is used (local runs/tests).

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <dir>" >&2
  exit 2
fi

dir=$1

if [[ -z "${GPG_KEY_ID:-}" ]]; then
  echo "error: GPG_KEY_ID is required" >&2
  exit 2
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

for name in SHA256SUMS linux-update.json; do
  gpg --batch --yes --armor \
    --local-user "$GPG_KEY_ID" \
    --detach-sign \
    --output "$dir/$name.asc" \
    "$dir/$name"
  echo "signed $dir/$name.asc"
done
