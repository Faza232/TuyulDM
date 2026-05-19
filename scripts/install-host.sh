#!/usr/bin/env bash
# install-host.sh — register the TuyulDM native messaging host with the local browser.
#
# Usage:
#   scripts/install-host.sh [CHROMIUM_EXTENSION_ID] [path/to/tuyuldm-daemon] [FIREFOX_EXTENSION_ID]
#
# If the daemon path is omitted, we build it from native-host/ and use the
# resulting binary's absolute path.
#
# Supports Chrome, Brave, Chromium, and Firefox on Linux and macOS. Firefox can
# also be enabled with FIREFOX_EXTENSION_ID=<gecko-id> when you only want the
# native host registered there.

set -euo pipefail

CHROMIUM_EXTENSION_ID="${1:-${CHROMIUM_EXTENSION_ID:-}}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON_PATH="${2:-${DAEMON_PATH:-}}"
FIREFOX_EXTENSION_ID="${3:-${FIREFOX_EXTENSION_ID:-}}"

if [[ -z "$CHROMIUM_EXTENSION_ID" && -z "$FIREFOX_EXTENSION_ID" ]]; then
  echo "usage: $0 [CHROMIUM_EXTENSION_ID] [path/to/tuyuldm-daemon] [FIREFOX_EXTENSION_ID]" >&2
  exit 64
fi

if [[ -z "$DAEMON_PATH" ]]; then
  echo "Building daemon..."
  (cd "$REPO_ROOT/native-host" && go build -o tuyuldm-daemon ./...)
  DAEMON_PATH="$REPO_ROOT/native-host/tuyuldm-daemon"
fi

if [[ ! -x "$DAEMON_PATH" ]]; then
  echo "error: $DAEMON_PATH is not an executable file" >&2
  exit 1
fi
DAEMON_PATH="$(cd "$(dirname "$DAEMON_PATH")" && pwd)/$(basename "$DAEMON_PATH")"

TEMPLATE="$REPO_ROOT/extension/com.tuyuldm.daemon.json.template"
if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

FIREFOX_TEMPLATE="$REPO_ROOT/extension/com.tuyuldm.daemon.firefox.json.template"
if [[ -n "$FIREFOX_EXTENSION_ID" && ! -f "$FIREFOX_TEMPLATE" ]]; then
  echo "error: firefox template not found at $FIREFOX_TEMPLATE" >&2
  exit 1
fi

chromium_rendered=''
if [[ -n "$CHROMIUM_EXTENSION_ID" ]]; then
  chromium_rendered="$(sed -e "s|__DAEMON_PATH__|$DAEMON_PATH|g" -e "s|__EXTENSION_ID__|$CHROMIUM_EXTENSION_ID|g" "$TEMPLATE")"
fi

firefox_rendered=''
if [[ -n "$FIREFOX_EXTENSION_ID" ]]; then
  firefox_rendered="$(sed -e "s|__DAEMON_PATH__|$DAEMON_PATH|g" -e "s|__FIREFOX_EXTENSION_ID__|$FIREFOX_EXTENSION_ID|g" "$FIREFOX_TEMPLATE")"
fi

chromium_targets=()
firefox_target=''
case "$(uname -s)" in
  Linux)
    chromium_targets=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/chromium/NativeMessagingHosts"
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    firefox_target="$HOME/.mozilla/native-messaging-hosts"
    ;;
  Darwin)
    chromium_targets=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    firefox_target="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  *)
    echo "error: unsupported OS $(uname -s); use scripts/install-host.ps1 on Windows" >&2
    exit 1
    ;;
esac

installed=0
if [[ -n "$CHROMIUM_EXTENSION_ID" ]]; then
  for dir in "${chromium_targets[@]}"; do
    parent="$(dirname "$dir")"
    if [[ ! -d "$parent" ]]; then
      continue
    fi
    mkdir -p "$dir"
    out="$dir/com.tuyuldm.daemon.json"
    printf '%s\n' "$chromium_rendered" > "$out"
    echo "wrote $out"
    installed=$((installed + 1))
  done
fi

if [[ -n "$FIREFOX_EXTENSION_ID" ]]; then
  mkdir -p "$firefox_target"
  firefox_out="$firefox_target/com.tuyuldm.daemon.json"
  printf '%s\n' "$firefox_rendered" > "$firefox_out"
  echo "wrote $firefox_out"
  installed=$((installed + 1))
fi

if [[ $installed -eq 0 ]]; then
  echo "warning: no supported browsers found; nothing installed" >&2
  exit 2
fi

echo "done. registered daemon at $DAEMON_PATH"
