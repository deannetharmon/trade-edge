# ADR-0004 — Feature-Oriented Architecture

## Status

Proposed

## Context

Trade Edge is growing beyond a simple page/component structure. The Screener page has become large enough that future changes are risky if related code remains concentrated in a single route file.

The project already has shared infrastructure under `lib/`, route entry points under `app/`, and reusable UI under `components/`. As features grow, related code should be easier to find, review, and evolve.

## Decision

Adopt a feature-oriented module structure for major Trade Edge domains.

Preferred structure:

```text
features/
  screener/
    components/
    hooks/
    services/
    types.ts
  portfolio/
  engine/
  autopilot/
```

Route files under `app/` should remain route entry points and high-level orchestrators. They should not own large amounts of feature-specific UI, calculation, or workflow logic.

Shared infrastructure remains in existing shared locations:

```text
lib/tasks/
lib/commands/
lib/scans/
components/tasks/
components/commands/
```

Feature code may import shared infrastructure, but shared infrastructure should not import feature modules unless explicitly approved.

## Boundaries

### `app/`

Route entry points, layout composition, route-specific orchestration.

### `features/`

Feature-specific components, hooks, adapters, and local orchestration.

### `lib/`

Shared infrastructure, domain services, calculation utilities, and code designed for reuse across features.

### `components/`

Shared UI or infrastructure providers that are not specific to one feature.

## Consequences

### Positive

- Makes large features easier to understand.
- Reduces route file size and risk.
- Clarifies ownership.
- Helps Claude and future contributors find the right place for changes.
- Creates a pattern for Portfolio, Engine, and Autopilot.

### Trade-offs

- Introduces another top-level folder.
- Requires discipline to avoid arbitrary movement.
- Some imports will change during refactors.

## Migration Strategy

Use incremental extraction.

Do not move entire domains at once. Extract one feature slice at a time:

1. Ranked Scan UI
2. Remaining Screener modes
3. Portfolio intelligence
4. Autopilot paper-mode workflows

Each refactor ticket must preserve behavior unless explicitly scoped otherwise.

## Guardrails

- Do not mix refactoring with feature behavior changes.
- Do not rename functions/types unless required.
- Do not duplicate logic to avoid imports.
- Do not move shared infrastructure into feature modules.
- Keep `app/` files as orchestrators, not dumping grounds.

## Follow-ups

- RF-0001 starts with Ranked Scan UI extraction.
- Future RF tickets can continue reducing `app/screener/page.tsx`.
- `docs/architecture/System-Map.md` should be updated as major modules are introduced.
