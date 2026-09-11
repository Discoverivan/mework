# Hermes integration contract probe

- **Probe date:** 2026-09-04
- **Installed build:** Hermes Agent v0.21.0 (2026.8.31), upstream `63279301`
- **Install:** git at `~/.hermes/hermes-agent`

## Read-only probe evidence

Commands run without credentials or writes:

```text
hermes --version
Hermes Agent v0.21.0 (2026.8.31) · upstream 63279301

hermes acp --version
0.21.0

hermes acp --check
Hermes ACP check OK

hermes serve --status
No hermes dashboard or serve processes running.
```

`hermes acp --help` confirms ACP server mode with `--accept-hooks`, `--version`, `--check`, `--setup`, and `--setup-browser`. The installed command does not expose an API-server subcommand.

`hermes serve --help` exposes a headless JSON-RPC/WebSocket backend server on port 9119. It does not document the planned authenticated HTTP/SSE contract (`POST /v1/runs`, SSE lifecycle stream).

`hermes api-server --help` was also probed read-only and failed with argparse `invalid choice: 'api-server'`.

## Decision and blocker

Do not create `create-run.json`, `sse-events.txt`, or `final-run.json` from guessed fields. The installed Hermes build provides a verified ACP capability but no verified HTTP/SSE API contract matching the implementation plan.

Task 18 (HTTP/SSE adapter) is blocked until one of these is supplied and re-probed:

1. the exact Hermes build/API server that implements the planned `/v1/runs` and SSE contract; or
2. an approved contract update selecting the installed `hermes serve` JSON-RPC/WebSocket protocol.

ACP fallback work may proceed against the installed ACP protocol. No credentials, prompts, external writes, or server processes were used by this probe.
