# mework contributor instructions

## Source-of-truth boundaries

- Rust domain and core types are authoritative for persisted behavior and public command/event contracts.
- The Rust core is the only component allowed to access SQLite, providers, credentials, Hermes, notifications, and external writes.
- The React renderer uses typed Tauri commands/events and must not hold secrets or call providers directly.
- Route application-wide and background Tauri events through the typed native event bridge in `frontend/app/native-event-bridge.ts` and the typed app event bus in `frontend/app/app-events.ts`. Feature components should subscribe to app events instead of registering duplicate native listeners; keep direct Tauri listeners only for feature-local, window-specific transports such as the Daily Presenter.
- Treat app events as change or invalidation notifications, not as commands that make every subscriber repeat the same external request. Give each refreshable resource one owner that deduplicates refresh work and publishes the resulting state; explicitly revalidate durable caches during startup because the in-memory event bus does not replay events across process restarts.
- Jira integrations target Jira Data Center/Server only. Do not use Atlassian Cloud APIs or assume Cloud-specific endpoints, capabilities, authentication, or behavior; use the REST API supported by the configured Data Center/Server instance.
- Every external object is scoped by `(integration_id, object_type, external_id)`.
- Inbox state is a rebuildable read model; user state is persisted separately.
- Workflow runs, Hermes sessions/runs, approvals, and external actions are isolated and durable.

## Safety and product constraints

- Polling is the only external-change ingestion mechanism. Do not add webhook code, endpoints, tables, or acceptance criteria.
- Treat Jira, GitHub, Bitbucket, comments, descriptions, labels, and generated text as untrusted input.
- External writes require explicit human approval and a local idempotency key. Jira task creation is performed by the Rust core through REST, never by Hermes or the renderer.
- Store all provider credentials only through the OS keyring, using isolated services for release (`com.discoverivan.app.mework`) and development (`com.discoverivan.app.mework.dev`). Never commit them, persist them in SQLite, print them, or return them to the renderer. SQLite, logs, diagnostics exports, prompts, frontend bundles, and Git history must not contain tokens or raw authorization headers.
- Until the 1.0.0 release, evolve SQLite with forward compatibility migrations and never rewrite or remove a migration that may already have been applied to a development database. Before releasing 1.0.0, review and consolidate the migration history into a small clean baseline as an explicit release task.
- Do not invent provider fields, signed headers, destination metadata, or fallback values absent from the external contract.
- Product branding is fixed: the production name is exactly `mework` and the development name is exactly `mework-dev`, both lowercase. Do not change their spelling, capitalization, or user-visible/native metadata without an explicit product decision.
- Add localization as part of every new user-facing feature: use translation keys instead of hardcoded renderer copy and provide both English and Russian values in the same change. On first run, initialize the saved language from the operating-system locale when supported; otherwise use English, while preserving an existing saved language.
- Test fixtures and examples must use only synthetic identities, usernames, emails, repository/project/team names, task/PR titles, and reserved domains such as `example`, `example.com`, or `example.invalid`; never copy real surnames, people, internal or public production domains, company names, project keys, repository names, team names, task names, PR titles, or credentials into code, tests, fixtures, docs, prompts, or sample configuration. Keep all sample credential values empty.
- Do not commit or push changes unless explicitly authorized.
- Every application PR must include release notes under `## Release notes` in the PR description. English notes are required; Russian notes may also be provided when applicable. Prefer Markdown between `<!-- release-notes:<lang> -->` and `<!-- /release-notes:<lang> -->` on their own lines. As a fallback, put a GitHub attachment link named `release-notes.<lang>.md` inside that language's block; links elsewhere in the PR are ignored. Use only nonempty Added/Changed/Fixed/Removed sections (translated for each language). Use `###` category headings in inline PR blocks and `##` in attached files; the workflow lifts inline headings for standalone release assets. Do not commit source notes to the repository. Inline text takes precedence over a link in the same block; the workflow publishes available notes as GitHub Release assets and uses English notes for the release description. Exclude changes that only affect development or mock modes from user-facing release notes. If an application PR has no business/user-facing changes to report after excluding development/mock-only work, use the general English note `### Fixed` with `- Performance improvements and bug fixes.` The workflow currently allows a release to proceed when notes are missing, but that is a fallback and does not waive this requirement; add missing notes to the published release assets and description.

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

- Use a solid border and `px-4 py-3` (16 px horizontal, 12 px vertical) padding for empty states and standalone informational messages. Use `p-4` for compact settings subforms. Keep smaller spacing for embedded table/filter rows; do not copy indentation or leading separators from nested settings rows into peer fields.
- Alternate panel fill at every nesting level based on the actual parent surface: `bg-background` → `bg-card` → `bg-background`, repeating for deeper panels. Reserve muted fills for special elements such as table headers and status indicators, not generic nesting levels. Labels above controls have a shared minimal 4 px left inset through `Label`/`FieldLabel`; do not repeat that inset in feature components. Labels beside controls use `alignment="inline"` with no field-heading padding; horizontal `Field` labels also have no inset. Section headings do not receive this field-label inset.
- Before implementing any UI or styling change, load and follow your agent's shadcn/ui skill if available; otherwise consult the official shadcn/ui documentation. In both cases, apply the project-specific constraints below where they are more specific.
- `components.json` is the source of truth for shadcn/ui CLI configuration. Keep `style: "default"`, CSS variables enabled, the Lucide icon library, and the configured `@/*` aliases in sync with the repository.
- Components are source-owned under `frontend/components/ui`. Add or refresh them with `npx shadcn@latest add <component>` only after checking the current official component documentation, then review the generated diff before keeping it.
- Use Tailwind CSS v4's CSS-first setup (`@import "tailwindcss"` and `@tailwindcss/vite`); do not add a legacy `tailwind.config.*` solely for shadcn/ui.
- Use semantic CSS-variable tokens (`background`, `foreground`, `primary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and their foreground pairs) through `@theme inline`. Do not hard-code theme colors in migrated UI components.
- The application has only White/light and Dark themes. Preserve the existing `data-theme` selector contract; do not add a competing theme provider, `.dark` state store, or third selectable theme.
- Import shared utilities through `@/lib/utils` and compose classes with `cn`. Keep `@/*` imports resolvable in both TypeScript and Vite.
- Add only dependencies required by the selected shadcn/ui registry entry. Do not replace source-owned primitives with a hosted component runtime.
- Every new primitive or customization needs focused tests where behavior is meaningful, followed by `npm test -- --run`, `npm run lint`, and `npm run build`.
