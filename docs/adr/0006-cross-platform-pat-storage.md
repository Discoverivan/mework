# ADR-0006: Cross-platform PAT storage

- **Status:** Accepted for MVP
- **Date:** 2026-09-12

## Context

mework stores Jira and Bitbucket personal access tokens. The renderer must never receive secret material, and the same release must work on macOS and Windows without a second credential implementation.

## Decision

Store PATs through the Rust core using the `keyring` crate behind the `CredentialStore` trait. Tauri commands receive only redacted integration DTOs and credential references.

The release backend is the native OS credential store:

- macOS: Keychain;
- Windows: Credential Manager;
- other desktop targets supported by the crate: their native secure credential service.

SQLite stores only a `credential_ref` and integration metadata. PAT values are not written to SQLite, renderer state, prompts, diagnostics, logs, or Git history. Credential errors are returned as safe classifications.

Debug builds keep the repository's explicit development boundary: `MEWORK_DEV_JIRA_PAT` and `MEWORK_DEV_BITBUCKET_PAT` are read transiently into process memory for local checks and are never persisted.

## Alternatives considered

Tauri Stronghold was not selected for PATs in this MVP. Stronghold provides an encrypted vault, but the application would still need a secure, portable master-key lifecycle. Native OS credential stores already provide platform-managed protection and unlock behavior for these user credentials.

## Consequences

- The same Rust command and application interfaces work on macOS and Windows.
- Release builds depend on the user's OS credential service being available.
- Credential references can be migrated or deleted without exposing the PAT itself.
- A future vault requirement would be a separate ADR and migration, not a renderer-side fallback.
