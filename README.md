# mework

mework is a local-first macOS/Windows desktop application for turning Jira and later source-control changes into a durable, actionable inbox and running isolated Hermes workflows with explicit approval for external writes.

## Architecture

- Tauri 2 shell with a React + TypeScript + Vite renderer.
- Rust local core owns polling, SQLite state, event normalization, workflows, approvals, credentials, notifications, and recovery.
- SQLite is local-only; production/release secrets are stored in the operating system keyring and never in the renderer or database. Debug development runs can use transient `MEWORK_DEV_JIRA_PAT` and `MEWORK_DEV_BITBUCKET_PAT` environment variables; they are never persisted or logged.
- Polling is the only external-change ingestion mechanism. Webhooks are out of scope.

The first vertical slice is Jira subscription → polling → snapshot → event → inbox → native notification. Hermes is deliberately not required for that slice.

## Development

Prerequisites: Node.js `>=20.19.0`/npm and the Rust toolchain required by the selected Tauri 2 template. The repository pins the dev Node version in [`.nvmrc`](.nvmrc); `scripts/tauri-dev.sh` selects it before launching the UI.

```bash
npm install
npm test -- --run
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

These checks do not launch the desktop application. For an intentional UI verification only, fill the local ignored `.env.dev` file and run the Zed task `mework: UI dev (explicit launch)`:

```dotenv
MEWORK_DEV_JIRA_URL=https://jira.example
MEWORK_DEV_JIRA_PAT=<local Jira PAT>
MEWORK_DEV_BITBUCKET_URL=https://bitbucket.example
MEWORK_DEV_BITBUCKET_PAT=<local Bitbucket PAT>
```

The task sources `.env.dev` and launches `npm run tauri -- dev`. The debug Rust process reads the PAT variables instead of Keychain. They are held only in process memory and are not written to SQLite or returned to the renderer. The file is ignored by Git.

See [`AGENTS.md`](AGENTS.md) for source-of-truth boundaries, safety constraints, and development conventions. Architecture decisions are recorded in [`docs/adr/`](docs/adr/).
