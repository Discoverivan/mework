#!/bin/zsh
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
node_version="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || true)"
nvm_node_bin="$NVM_DIR/versions/node/v${node_version}/bin"
if [[ -x "$nvm_node_bin/node" ]]; then
  export PATH="$nvm_node_bin:$PATH"
elif [[ -x "$HOME/.local/bin/node" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  print -u2 "Node.js >=20.19.0 is required, but node was not found"
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)'; then
  print -u2 "Node.js >=20.19.0 is required (detected $(node --version))"
  exit 1
fi

if [[ ! -f .env.dev ]]; then
  print -u2 ".env.dev is missing"
  exit 1
fi

set -a
source .env.dev
set +a

: "${MEWORK_DEV_JIRA_PAT:?MEWORK_DEV_JIRA_PAT is missing in .env.dev}"
: "${MEWORK_DEV_BITBUCKET_PAT:?MEWORK_DEV_BITBUCKET_PAT is missing in .env.dev}"

if [[ "${MEWORK_DEV_PREFLIGHT_ONLY:-false}" == "true" ]]; then
  print "development environment loaded with Node $(node --version)"
  exit 0
fi

exec npm run tauri -- dev
