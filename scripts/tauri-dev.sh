#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repo_root="${script_dir:h}"
cd "$repo_root"
env_file="${MEWORK_DEV_ENV_FILE:-$repo_root/.env.dev}"

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

if [[ ! -f "$env_file" ]]; then
  print -u2 "development environment file is missing: $env_file"
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ -z "${MEWORK_DEV_JIRA_PAT:-}" ]]; then
  print -u2 "MEWORK_DEV_JIRA_PAT is missing or empty in $env_file"
  exit 1
fi
if [[ -z "${MEWORK_DEV_BITBUCKET_PAT:-}" ]]; then
  print -u2 "MEWORK_DEV_BITBUCKET_PAT is missing or empty in $env_file"
  exit 1
fi

if [[ "${MEWORK_DEV_PREFLIGHT_ONLY:-false}" == "true" ]]; then
  print "development environment loaded with Node $(node --version)"
  exit 0
fi

exec npm run tauri -- dev
