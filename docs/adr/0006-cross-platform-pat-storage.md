# ADR-0006: Cross-platform PAT storage

- **Status:** Accepted for MVP
- **Date:** 2026-09-12

## Context

mework stores Jira and Bitbucket personal access tokens. The renderer must never receive secret material, and development and release builds must use the same credential behavior with isolated application namespaces.

## Decision

Store PATs through the Rust core using the `keyring` crate behind the `CredentialStore` trait. Tauri commands receive only redacted integration DTOs and credential references.

The release backend is the native OS credential store:

- macOS: Keychain;
- Windows: Credential Manager;
- other desktop targets supported by the crate: their native secure credential service.

SQLite stores only a `credential_ref` and integration metadata. PAT values are not written to SQLite, renderer state, prompts, diagnostics, logs, or Git history. Credential errors are returned as safe classifications. Development and release use the same native keyring backend, with `com.discoverivan.app.mework.dev` reserved for the `mework-dev` bundle and `com.discoverivan.app.mework` for the release bundle. At startup, mework gathers all configured integration and AI credential references and reads one app-owned generic-password bundle item; the bundle contains the values for those refs and is kept only in process memory. Existing standalone legacy items are deliberately not opened automatically because macOS can prompt separately for each item; users re-save those credentials through Settings once to populate the bundle. Subsequent command loads use process memory only, and successful save/delete operations update or invalidate the bundle/cache.

## Alternatives considered

Tauri Stronghold was not selected for PATs in this MVP. Stronghold provides an encrypted vault, but the application would still need a secure, portable master-key lifecycle. Native OS credential stores already provide platform-managed protection and unlock behavior for these user credentials.

## Consequences

- The same Rust command and application interfaces work on macOS and Windows.
- Release builds depend on the user's OS credential service being available.
- Credential references can be migrated or deleted without exposing the PAT itself.
- A future vault requirement would be a separate ADR and migration, not a renderer-side fallback.
