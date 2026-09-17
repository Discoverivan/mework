# mework

mework is a local-first macOS/Windows desktop application for turning Jira and later source-control changes into a durable, actionable inbox and running isolated Hermes workflows with explicit approval for external writes.

## Architecture

- Tauri 2 shell with a React + TypeScript + Vite renderer.
- Rust local core owns polling, SQLite state, event normalization, workflows, approvals, credentials, notifications, and recovery.
- SQLite is local-only; credentials for both production and development are stored in the operating system keyring and never in the renderer or database. Development uses a separate keyring namespace from the release application.
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

These checks do not launch the desktop application. For an intentional UI verification only, run `npm run tauri:dev` (or the Zed task `mework: UI dev (explicit launch)`) and configure Jira/Bitbucket credentials in **Settings → Integrations**. The save flow validates authentication before storing each PAT in the OS keyring.

The launcher starts `tauri dev` with `src-tauri/tauri.dev.conf.json`. The development application is named `mework-dev` and uses bundle identifier `com.discoverivan.app.mework.dev`; Tauri therefore gives it a separate `app_data_dir` and SQLite database from the release `mework` app. The debug Rust process uses the separate OS keyring namespace `com.discoverivan.app.mework.dev`; it never reads `.env` files, writes PATs to SQLite, or returns them to the renderer. The dev app also uses a separate icon with a `DEV` badge.

Release builds continue to use the standard `src-tauri/tauri.conf.json` and the regular `mework` identifier.

See [`AGENTS.md`](AGENTS.md) for source-of-truth boundaries, safety constraints, and development conventions. Architecture decisions are recorded in [`docs/adr/`](docs/adr/).
