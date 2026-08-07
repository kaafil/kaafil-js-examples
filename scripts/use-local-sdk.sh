#!/usr/bin/env bash
# Links a local kaafil-js checkout into node_modules for development against unpublished changes.
# kaafil-js is not yet on npm, so `pnpm install` alone cannot resolve the dependency declared in
# package.json — this script is the bridge until it is published.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SDK_PATH="${1:-"$REPO_ROOT/../kaafil-js"}"

# Resolve to an absolute path up front so the symlink target is unambiguous regardless of where
# this script was invoked from.
if [[ "$SDK_PATH" != /* ]]; then
  SDK_PATH="$(cd "$REPO_ROOT" && cd "$SDK_PATH" 2>/dev/null && pwd)" || {
    echo "error: SDK path '$1' does not exist or is not a directory" >&2
    exit 1
  }
else
  SDK_PATH="$(cd "$SDK_PATH" 2>/dev/null && pwd)" || {
    echo "error: SDK path '$1' does not exist or is not a directory" >&2
    exit 1
  }
fi

if [[ ! -f "$SDK_PATH/package.json" ]]; then
  echo "error: '$SDK_PATH' has no package.json — it does not look like the kaafil-js checkout" >&2
  exit 1
fi

# A symlink to an unbuilt package resolves to missing files, and the resulting error surfaces at
# import time in whatever example script happens to import the SDK first — nothing about that
# error points back to "the SDK was never built". Catch it here instead, where the cause is obvious.
if [[ ! -f "$SDK_PATH/dist/index.js" || ! -f "$SDK_PATH/dist/client-entry.js" ]]; then
  echo "error: '$SDK_PATH/dist' is missing index.js and/or client-entry.js" >&2
  echo "       run 'pnpm build' in the kaafil-js checkout first, then re-run this script." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/node_modules"

# kaafil-js has zero runtime dependencies, so a bare symlink is enough — there is no nested
# node_modules to worry about missing.
ln -sfn "$SDK_PATH" "$REPO_ROOT/node_modules/kaafil-js"

echo "linked node_modules/kaafil-js -> $SDK_PATH"
