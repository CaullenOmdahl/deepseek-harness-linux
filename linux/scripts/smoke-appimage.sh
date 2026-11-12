#!/usr/bin/env bash
# Boot a built AppImage under a private Xvfb display and assert its window title.
#
# Usage: linux/scripts/smoke-appimage.sh <appimage>
#
# Regression guard for the shipped desktop identity: the visible window title
# must be exactly `DeepSeek Harness` and WM_CLASS must be `deepseek-harness`
# (matching `StartupWMClass` in the installed desktop entry). Runs with a fresh
# HOME and a private display, uses the AppImage extraction fallback so FUSE is
# not required, and fails with the app log and window list on a timeout.

set -euo pipefail

if [[ "${DSH_SMOKE_INSIDE:-}" != "1" ]]; then
  if [[ $# -ne 1 ]]; then
    echo "usage: $0 <appimage>" >&2
    exit 2
  fi
  if [[ ! -f "$1" ]]; then
    echo "error: AppImage not found: $1" >&2
    exit 1
  fi
  appimage=$(realpath "$1")
  exec xvfb-run -a --server-args="-screen 0 1400x1000x24" \
    env DSH_SMOKE_INSIDE=1 DSH_SMOKE_APPIMAGE="$appimage" bash "${BASH_SOURCE[0]}"
fi

appimage=${DSH_SMOKE_APPIMAGE:?missing DSH_SMOKE_APPIMAGE}
work=$(mktemp -d "${TMPDIR:-/tmp}/dsh-smoke.XXXXXXXX")
log="$work/appimage.log"
pid=""

cleanup() {
  if [[ -n "$pid" ]]; then
    kill -TERM -- "-$pid" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL -- "-$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

export HOME="$work/home"
mkdir -p "$HOME"
# Electron follows Wayland even when DISPLAY is set; this display is X11 only.
unset WAYLAND_DISPLAY WAYLAND_SOCKET

setsid "$appimage" --appimage-extract-and-run --no-sandbox --ozone-platform=x11 \
  >"$log" 2>&1 < /dev/null &
pid=$!

window_id=""
title=""
for _ in $(seq 1 120); do
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "error: AppImage exited before a window appeared" >&2
    tail -n 60 "$log" >&2 || true
    exit 1
  fi
  window_id=$(xdotool search --onlyvisible --name '^DeepSeek Harness$' 2>/dev/null | head -n 1 || true)
  if [[ -n "$window_id" ]]; then
    title=$(xdotool getwindowname "$window_id" 2>/dev/null || true)
    [[ "$title" == "DeepSeek Harness" ]] && break
    window_id=""
  fi
  sleep 1
done

if [[ -z "$window_id" || "$title" != "DeepSeek Harness" ]]; then
  echo "error: no visible window titled exactly 'DeepSeek Harness' appeared within 120s" >&2
  echo "--- visible windows ---" >&2
  xdotool search --onlyvisible --name '.*' 2>/dev/null | while read -r id; do
    printf 'id=%s name=%q class=%q\n' "$id" \
      "$(xdotool getwindowname "$id" 2>/dev/null || true)" \
      "$(xprop -id "$id" WM_CLASS 2>/dev/null || true)" >&2
  done
  echo "--- app log ---" >&2
  tail -n 80 "$log" >&2 || true
  exit 1
fi

wm_class=$(xprop -id "$window_id" WM_CLASS 2>/dev/null || true)
net_name=$(xprop -id "$window_id" _NET_WM_NAME 2>/dev/null || true)
if [[ "$wm_class" != *'"deepseek-harness"'* ]]; then
  echo "error: WM_CLASS does not contain deepseek-harness: $wm_class" >&2
  exit 1
fi
if [[ "$net_name" != *'"DeepSeek Harness"'* ]]; then
  echo "error: _NET_WM_NAME is not 'DeepSeek Harness': $net_name" >&2
  exit 1
fi

echo "smoke: window title is exactly 'DeepSeek Harness'"
echo "smoke: $wm_class"
echo "smoke: $net_name"
