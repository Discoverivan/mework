#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repo_root="${script_dir:h}"
cd "$repo_root"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
node_version="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || true)"
nvm_node_bin="$NVM_DIR/versions/node/v${node_version}/bin"
if [[ -x "$nvm_node_bin/node" ]]; then
  export PATH="$nvm_node_bin:$PATH"
elif [[ -x "$HOME/.local/bin/node" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  print -u2 "Node.js >=24.15.0 <25 is required, but node was not found"
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 15 ? 0 : 1)'; then
  print -u2 "Node.js >=24.15.0 <25 is required (detected $(node --version))"
  exit 1
fi

exec node ./scripts/tauri-dev.mjs
