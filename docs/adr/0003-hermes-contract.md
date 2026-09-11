# ADR-0003: Hermes contract discovery boundary

- **Status:** Accepted pending API contract selection
- **Date:** 2026-09-04

## Context

The implementation plan selected an authenticated loopback HTTP/SSE Hermes adapter with `POST /v1/runs`, lifecycle SSE, cancellation, reconnect, structured output, and permission events. The installed Hermes build must be probed before Mework enables runs; fields must not be guessed.

## Evidence

The installed build is Hermes Agent v0.21.0 (2026.8.31), upstream `63279301`. `hermes acp --check` passes. `hermes acp --help` exposes ACP server mode. `hermes serve --help` exposes a headless JSON-RPC/WebSocket backend. `hermes api-server --help` fails because `api-server` is not an installed command.

## Decision

Keep the HTTP/SSE adapter disabled and unimplemented until the exact API contract is available. Record no synthetic request, response, or SSE fixtures. ACP is the verified fallback protocol and can be implemented separately. An approved contract update is required before selecting `hermes serve` as the primary adapter.
