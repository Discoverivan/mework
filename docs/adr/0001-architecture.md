# ADR-0001: Local-first Tauri and Rust architecture

- **Status:** Accepted for MVP
- **Date:** 2026-09-04

## Context

Mework must run as a single-user desktop application on macOS and Windows, remain useful offline, persist polling and workflow state locally, integrate with native OS capabilities, and keep credentials and external writes outside the renderer. The first vertical slice is a Jira watcher and actionable inbox. Incoming webhooks, cloud services, remote databases, microservices, and a global Hermes conversation are out of scope.

## Decision

Use Tauri 2 as the native shell, React + TypeScript + Vite for the renderer, Rust for the local core, and SQLite accessed only by Rust through SQLx migrations.

The Rust core owns provider polling, checkpoints, snapshots, event normalization, inbox persistence, workflow queues, Hermes adapter selection, session/run state, approvals, idempotent external actions, OS keyring access, notifications, diagnostics, recovery, and native shell integration.

The renderer communicates only through typed Tauri commands and events. Hermes is reached by Rust adapters, primarily authenticated loopback HTTP/SSE, with ACP and CLI fallback adapters behind one interface. Jira task creation is a direct approved Rust REST action, not an AI or renderer action.

SQLite uses WAL mode, foreign keys, a busy timeout, append-only migrations, and a single write coordinator. Credentials are represented in SQLite only by references and metadata; secret material belongs in the OS keyring.

## Consequences

- The application has a small local footprint and a strong security boundary around secrets and side effects.
- Rust domain types must remain synchronized with mirrored TypeScript DTOs through contract tests.
- Tauri, Rust, and native packaging add toolchain and platform verification requirements.
- Provider and Hermes capabilities must be probed and fixture-tested rather than guessed.
- Polling and durable SQLite state are the only MVP ingestion and coordination mechanisms.
