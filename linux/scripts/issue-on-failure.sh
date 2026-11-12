#!/usr/bin/env bash
# Report a failed workflow run without opening a duplicate issue per retry.
#
# Usage: linux/scripts/issue-on-failure.sh <title> <run-url>
#
# If an open issue with exactly the same title exists, the run URL is added as a
# comment; otherwise one issue is created. One issue therefore tracks all failed
# runs of the same build/version instead of one issue per attempt.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <title> <run-url>" >&2
  exit 2
fi

title=$1
run_url=$2

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "error: GH_TOKEN is required" >&2
  exit 1
fi

body="Run: $run_url"

existing=$(gh issue list --state open --limit 200 --json number,title \
  | jq -r --arg title "$title" '.[] | select(.title == $title) | .number' \
  | head -n 1)

if [[ -n "$existing" ]]; then
  gh issue comment "$existing" --body "$body"
  echo "commented on existing issue #$existing: $title"
else
  gh issue create --title "$title" --body "$body"
  echo "opened issue: $title"
fi
