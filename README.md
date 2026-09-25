<div align="center">
  <a href="https://discoverivan.github.io/mework/#downloads">
    <img src="docs/assets/mework-icon.png" alt="mework" width="96" height="96">
  </a>
  <h1>mework</h1>
  <p><strong>A local-first desktop workspace for Jira, pull requests, and AI-assisted delivery.</strong></p>
  <p>
    <a href="https://discoverivan.github.io/mework/#downloads"><strong>Download latest</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Discoverivan/mework/releases/latest">Release notes</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Discoverivan/mework/actions">Build status</a>
  </p>
  <p>
    <a href="https://discoverivan.github.io/mework/#downloads">macOS · Apple Silicon</a>
    &nbsp;·&nbsp;
    <a href="https://discoverivan.github.io/mework/#downloads">macOS · Intel</a>
    &nbsp;·&nbsp;
    <a href="https://discoverivan.github.io/mework/#downloads">Windows</a>
  </p>
  <p>
    <img src="https://img.shields.io/github/v/release/Discoverivan/mework?display_name=tag&sort=semver&label=latest" alt="Latest release">
    <a href="https://github.com/Discoverivan/mework/actions/workflows/ci.yml?query=branch%3Amaster"><img src="https://github.com/Discoverivan/mework/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI status"></a>
    <a href="https://github.com/Discoverivan/mework/actions/workflows/release.yml?query=branch%3Amaster"><img src="https://github.com/Discoverivan/mework/actions/workflows/release.yml/badge.svg?branch=master" alt="Release status"></a>
  </p>
</div>

## Download

The [download page](https://discoverivan.github.io/mework/#downloads) reads the latest published GitHub release at runtime, so its platform links stay current without changing this README.

| Platform | Latest download |
| --- | --- |
| macOS · Apple Silicon | [Open latest download](https://discoverivan.github.io/mework/#downloads) |
| macOS · Intel | [Open latest download](https://discoverivan.github.io/mework/#downloads) |
| Windows · Installer | [Open latest download](https://discoverivan.github.io/mework/#downloads) |
| Windows · MSI | [Open latest download](https://discoverivan.github.io/mework/#downloads) |
| Updater metadata | [`latest.json`](https://github.com/Discoverivan/mework/releases/latest/download/latest.json) |
| All release assets | [Open latest GitHub release](https://github.com/Discoverivan/mework/releases/latest) |

> **macOS note:** the application is ad-hoc signed and not notarized. On first launch, macOS may require **System Settings → Privacy & Security → Open Anyway**.

## What it does

mework keeps day-to-day engineering work in one local desktop workspace:

- **Create task** — describe work in natural language, generate an editable AI draft, choose `Task` or `Spike`, review Jira fields, and create the issue only after an explicit action.
- **Sprint tasks** — choose a Jira sprint, inspect all work by assignee, refresh status, and open a second-window presenter view for stand-ups.
- **Pull requests awaiting your review** — poll Bitbucket pull requests, track new or updated activity, run an AI review, inspect severity-grouped comments, and publish an edited comment or decision from the review flow.
- **Pull requests authored by you** — follow authored pull requests, surface items that need attention, and optionally run automatic AI review for configured activity.
- **Command Board** — keep local scripts and commands close at hand and run them from a small, editable command board.
- **Settings** — manage Jira and Bitbucket connections, AI providers, managed teams, notifications, themes, and application updates.

## How it works

- **Tauri 2 shell** with a React, TypeScript, and Vite renderer.
- **Rust local core** owns polling, SQLite state, provider requests, AI adapters, credentials, notifications, workflows, and recovery.
- **Jira and Bitbucket** are read through polling; the background refresh interval is five minutes. Webhooks are intentionally out of scope.
- **Remote writes require an explicit user action** and are handled by the Rust core rather than the renderer or an AI agent.
- **AI providers:** local Codex CLI, local Claude Code CLI, or an OpenAI-compatible API. Claude Code uses its existing login and supports the `sonnet`, `opus`, and `haiku` model aliases. OpenAI-compatible models are discovered from `GET <base URL>/models`; static model metadata is not used.
- **Windows Codex CLI:** mework checks `PATH` for `codex.exe`/`codex.cmd` and the standalone installer location `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`; Codex keeps its own authentication and configuration under `%USERPROFILE%\.codex`.
- **Themes:** white/light and dark, with the initial choice following the operating-system preference.

## Privacy and credentials

- Jira, Bitbucket, and OpenAI-compatible API credentials are stored only in the native operating-system keyring.
- SQLite stores local application state and credential references, not token values.
- Credentials, authorization headers, and full prompts are not returned to the renderer or written to logs.
- OpenAI-compatible external URLs must use HTTPS; HTTP is reserved for localhost. `allow_insecure_tls` is an explicit opt-in for trusted environments and should not be enabled for untrusted endpoints.
- Development (`mework-dev`) and release (`mework`) use separate application data and keyring namespaces.

## Development

### Prerequisites

- Node.js `>=24.15.0 <25` and npm
- Rust stable and the native toolchain required by Tauri 2
- The repository-pinned Node version from [`.nvmrc`](.nvmrc)

### Checks

```bash
npm ci
npm test -- --run
npm run lint
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

These checks do not launch the desktop application. Launch the UI only for an intentional, specific verification:

```bash
npm run tauri:dev
```

The development launcher uses `src-tauri/tauri.dev.conf.json`, the `mework-dev` identity, a separate SQLite database, and a separate OS keyring namespace. Configure integrations through **Settings → Integrations**; never put credentials in `.env` files, source code, SQLite, or test fixtures.

To run the local mock scenario with synthetic Jira, Bitbucket, and Confluence data (AI may still use the configured provider), opt in explicitly:

```bash
npm run tauri:dev -- --mock
```

Mock mode is debug-build-only and resets a dedicated `mework-mock.sqlite` database on every launch, then seeds synthetic Jira/Bitbucket/Confluence integration settings plus sample Task Tracker monitors and issues. The regular DEV database is preserved; only non-secret AI settings are copied. Mework's mock path skips OS-keyring preload and access: an OpenAI-compatible API key entered during a mock session is held in memory only and must be re-entered after restart. Configured local AI CLIs can still be used; any authentication prompts originating inside those external tools are separate from Mework's keyring access. All application screens remain available without data-integration calls; provider polling and external writes are disabled. The overlay can add synthetic Jira tasks and PRs and change task status. Running `npm run tauri:dev` without `--mock` retains the normal integration behavior.

Mock mode also opens a synthetic **What's new** preview at startup. Close it with **Got it**, then reopen it from **About → What's new**. The preview uses sample versions and does not mark any real release notes as seen.

See [`AGENTS.md`](AGENTS.md) for repository boundaries and safety rules. Architecture decisions live in [`docs/adr/`](docs/adr/).

## GitHub Pages

The static download landing page is [`docs/index.html`](docs/index.html). [`Deploy GitHub Pages`](.github/workflows/pages.yml) publishes the `docs/` directory from `master` and exposes it at:

**https://discoverivan.github.io/mework/**

The page reads the public GitHub Releases API at runtime and falls back to the latest GitHub release page if the API is unavailable. It contains no credentials, requires no build step, and does not require version-specific edits when a new release is published.

To enable it in a repository that has not used Pages before, select **Settings → Pages → Source: GitHub Actions** once; subsequent updates deploy from the workflow.

## License

No license has been published yet.
