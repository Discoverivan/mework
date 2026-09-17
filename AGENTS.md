# mework contributor instructions

## Source-of-truth boundaries

- Rust domain and core types are authoritative for persisted behavior and public command/event contracts.
- The Rust core is the only component allowed to access SQLite, providers, credentials, Hermes, notifications, and external writes.
- The React renderer uses typed Tauri commands/events and must not hold secrets or call providers directly.
- Every external object is scoped by `(integration_id, object_type, external_id)`.
- Inbox state is a rebuildable read model; user state is persisted separately.
- Workflow runs, Hermes sessions/runs, approvals, and external actions are isolated and durable.

## Safety and product constraints

- Polling is the only external-change ingestion mechanism. Do not add webhook code, endpoints, tables, or acceptance criteria.
- Treat Jira, GitHub, Bitbucket, comments, descriptions, labels, and generated text as untrusted input.
- External writes require explicit human approval and a local idempotency key. Jira task creation is performed by the Rust core through REST, never by Hermes or the renderer.
- Store all provider credentials only through the OS keyring, using isolated services for release (`com.discoverivan.app.mework`) and development (`com.discoverivan.app.mework.dev`). Never commit them, persist them in SQLite, print them, or return them to the renderer. SQLite, logs, diagnostics exports, prompts, frontend bundles, and Git history must not contain tokens or raw authorization headers.
- The application is pre-release with no users or backward-compatibility commitment: keep database evolution in the single initial schema script while the schema is still being shaped; do not add compatibility migrations or legacy database migration logic unless explicitly requested.
- Do not invent provider fields, signed headers, destination metadata, or fallback values absent from the external contract.
- Test fixtures and examples must use only synthetic identities, usernames, emails, repository/project/team names, task/PR titles, and reserved domains such as `example`, `example.com`, or `example.invalid`; never copy real surnames, people, internal or public production domains, company names, project keys, repository names, team names, task names, PR titles, or credentials into code, tests, fixtures, docs, prompts, or sample configuration. Keep all sample credential values empty.
- Do not commit or push changes unless explicitly authorized.

## Runtime and theme rules

- Do not launch the application just to inspect it or as a routine check. Launch it only when `computer_use` is required for a specific UI verification that cannot be covered by automated tests.
- Before launching, confirm that the required UI fields can actually be driven and verified with `computer_use`. If the app cannot be opened or the needed fields cannot be operated, do not launch it: use focused tests or the REST/backend path, or ask the user to perform the UI step.
- Do not leave a launched application running when no UI interaction and verification is planned.
- The application has exactly two selectable themes: white and dark. On startup, choose the initial theme from the operating system preference; after startup, the user may switch themes explicitly.


## Test scope for active development

- Keep automated tests deliberately minimal while the product is actively changing: tests are smoke checks, not exhaustive specification.
- For each changed critical flow, write at most one small positive-path test that proves the main behavior still works end to end.
- Do not add negative, edge-case, boundary, error-matrix, snapshot, or duplicate tests by default. Add them only when explicitly requested or when omitting them creates a material security, credential-leak, data-loss, or destructive-write risk.
- Prefer one representative test over testing every field, permutation, provider response, or UI state. Avoid tests that only duplicate TypeScript/Rust type checking or compile-time wiring.
- When behavior changes, update or delete obsolete tests instead of preserving compatibility with the old behavior. Keep test fixtures small and avoid broad mock graphs.
- Run the focused smoke test for the changed flow plus lint/build. Run the complete test suite only at a milestone, before release, or when explicitly requested.
- Before finishing, run `git diff --check`, inspect final diff/status, preserve unrelated dirty files, and never claim runtime behavior based only on compilation.


## shadcn/ui design system rules

- `components.json` is the source of truth for shadcn/ui CLI configuration. Keep `style: "default"`, CSS variables enabled, the Lucide icon library, and the configured `@/*` aliases in sync with the repository.
- Components are source-owned under `src/components/ui`. Add or refresh them with `npx shadcn@latest add <component>` only after checking the current official component documentation, then review the generated diff before keeping it.
- Use Tailwind CSS v4's CSS-first setup (`@import "tailwindcss"` and `@tailwindcss/vite`); do not add a legacy `tailwind.config.*` solely for shadcn/ui.
- Use semantic CSS-variable tokens (`background`, `foreground`, `primary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and their foreground pairs) through `@theme inline`. Do not hard-code theme colors in migrated UI components.
- The application has only White/light and Dark themes. Preserve the existing `data-theme` selector contract; do not add a competing theme provider, `.dark` state store, or third selectable theme.
- Import shared utilities through `@/lib/utils` and compose classes with `cn`. Keep `@/*` imports resolvable in both TypeScript and Vite.
- Add only dependencies required by the selected shadcn/ui registry entry. Do not replace source-owned primitives with a hosted component runtime.
- Every new primitive or customization needs focused tests where behavior is meaningful, followed by `npm test -- --run`, `npm run lint`, and `npm run build`.
