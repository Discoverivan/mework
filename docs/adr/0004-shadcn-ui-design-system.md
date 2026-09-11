# ADR-0004: shadcn/ui design system foundation

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

Work Hub's renderer has a small, source-owned stylesheet and must gain an accessible component foundation before later UI migration. The existing application already exposes exactly two themes through `document.documentElement.dataset.theme`: `light` (shown to users as White) and `dark`. The foundation must not require changing `App.tsx` or `AppShell.tsx`, and it must not introduce a second theme state or a runtime component dependency.

The current official shadcn/ui Vite, theming, CLI, components, and skills documentation was checked on 2026-09-05:

- <https://ui.shadcn.com/docs/installation/vite>
- <https://ui.shadcn.com/docs/theming>
- <https://ui.shadcn.com/docs/cli>
- <https://ui.shadcn.com/docs/components>
- <https://ui.shadcn.com/docs/skills>
- <https://ui.shadcn.com/schema.json>

## Decision

- Use the current Vite/Tailwind CSS v4 setup: `tailwindcss` with `@tailwindcss/vite`, `@import "tailwindcss"`, and the Vite `@` alias.
- Keep `components.json` as the CLI source of truth with the official schema, `style: "default"`, CSS variables enabled, Lucide icons, and aliases rooted at `@/`.
- Use CSS custom properties for semantic shadcn tokens and expose them through Tailwind v4's `@theme inline` block. New primitives use semantic utilities such as `bg-background`, `text-foreground`, `border-border`, and `ring-ring`.
- Keep the existing `data-theme` contract. A custom Tailwind `dark` variant targets `[data-theme="dark"]`, while light and dark semantic token values preserve the existing palette. No provider or extra theme package is introduced.
- Generate source-owned primitives under `src/components/ui` with the official CLI's default/Radix registry: Button, Card, Input, Label, Select, Switch, Badge, Alert, Separator, and Skeleton. Components can be reviewed and customized locally; later migrations must not import a hosted component runtime.
- Keep `cn` in `src/lib/utils.ts` as the documented `twMerge(clsx(...))` composition helper.
- Add only dependencies required by the generated primitives and current Vite integration: Radix primitives used by the selected registry components, Lucide icons, class variance utilities, Tailwind CSS, and Node types for Vite configuration.

## Consequences

The CLI can add future components consistently using `npx shadcn@latest add <component>`. The component files are part of Work Hub's source and are testable without launching Tauri. Tailwind v4 has no JavaScript config file in this setup. Existing App/AppShell theme behavior remains the owner of theme selection; this foundation only supplies semantic tokens and styling primitives.

## Permanent rules

See the shadcn/ui rules in the repository `AGENTS.md`. In particular, keep component additions source-owned, use the configured aliases, preserve the two-theme `data-theme` contract, review CLI-generated changes, and add only the dependencies required by a component's documented registry entry.
