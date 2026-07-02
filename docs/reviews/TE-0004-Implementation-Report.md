# TE-0004 Implementation Report

## 1. Executive Summary

TE-0004 implements the client-side Command Bus foundation: a dependency-free `CommandBus` class, a typed command model, a React `CommandProvider` mounted alongside the existing `TaskProvider`, and a `useCommandBus()` hook. No existing workflow (Ranked Scan, Screener, Portfolio AI, Autopilot) was migrated to dispatch through the bus — `command-handlers.ts` intentionally registers zero handlers in this ticket.

The implementation stayed completely within TE-0004 scope. No trading logic, UI, or existing provider behavior was modified beyond adding `CommandProvider` to the provider tree.

One process issue: a temporary local helper script (`apply-te-0004.sh`) was accidentally committed to the branch in a follow-up commit. It has since been removed in a separate `chore:` commit. It contained no application code and did not affect the build.

---

## 2. Files Changed

**Created:**
- `lib/commands/command-types.ts`
- `lib/commands/command-bus.ts`
- `lib/commands/command-handlers.ts`
- `components/commands/CommandProvider.tsx`
- `hooks/useCommandBus.ts`

**Modified:**
- `app/providers.tsx` — added `CommandProvider` inside the existing `TaskProvider`/`SessionProvider` tree.

**Removed (follow-up commit):**
- `apply-te-0004.sh` — temporary delivery script, accidentally committed, not part of the application.

---

## 3. Architecture Decisions

**Command Bus structure.** `CommandBus` is a plain TypeScript class with no React or external dependencies, per TE-0004's requirement that it "stay independent from React whenever practical." It holds a `Map<TradeEdgeCommandType, TradeEdgeCommandHandler>` and exposes `dispatch`, `registerHandler`, and `getRegisteredCommandTypes`. This mirrors the `TaskManager`/`TaskStore` pattern from TE-0003, keeping the two systems structurally consistent.

**Handler registration.** `registerHandler(type, handler)` stores one handler per command type and returns an unsubscribe function that removes the handler only if it's still the currently registered one (avoids a stale unsubscribe clobbering a newer handler for the same type). Only one handler per type is supported, matching the ticket's simple routing model — no middleware or handler chains were introduced.

**Dispatch.** `dispatch(input)` builds a full `TradeEdgeCommand` by generating an id (`crypto.randomUUID()` with a fallback), stamping `createdAt`, and defaulting `source` to `'user'` when omitted. If no handler is registered for the command type, it resolves `{ handled: false }` rather than throwing — this was a hard requirement so that dispatching an unimplemented command (all of them, currently) fails safely. Handler exceptions are caught and returned as `{ handled: true, error }` rather than propagating.

**Provider wiring.** `CommandProvider` follows the same shape as `TaskProvider`: a `useRef`-held singleton instance exposed via React Context, with a `useCommandBusContext()` accessor that throws outside the provider. It is mounted *inside* `TaskProvider` in `app/providers.tsx`, so both bus and task state are available together without changing `SessionProvider`'s position or behavior.

**Alignment with ADR-0002.** ADR-0002's core boundary — Command Bus answers "what should happen," Task Manager answers "what is happening now" — is preserved structurally: `CommandBus` has no awareness of `TaskManager` and does not import from `lib/tasks/`. The two are wired as sibling providers, not merged. Future command handlers (in `command-handlers.ts`) are the intended integration point where a handler would call into `useTaskManager()`'s `createTask`/`startTask`, but that wiring doesn't exist yet, per scope.

**Deviations from the ticket.** None. All required files, types, and behaviors (dispatch, registerHandler, getRegisteredCommandTypes, safe unhandled result, provider wiring preserving `TaskProvider`) were implemented as specified.

---

## 4. Public API

**`lib/commands/command-types.ts`**
- `TradeEdgeCommandType` — union of the 6 required command types.
- `TradeEdgeCommandSource` — `'user' | 'system' | 'ai' | 'autopilot'`.
- `TradeEdgeCommand<TPayload>` — full command record (id, type, payload, source, createdAt).
- `TradeEdgeCommandInput<TPayload>` — input shape for `dispatch` (source optional).
- `TradeEdgeCommandResult<TResult>` — `{ commandId, handled, result?, error? }`.
- `TradeEdgeCommandHandler<TPayload, TResult>` — handler function type, sync or async.

**`lib/commands/command-bus.ts`**
- `class CommandBus`
  - `registerHandler<TPayload, TResult>(type, handler): () => void`
  - `dispatch<TPayload, TResult>(input): Promise<TradeEdgeCommandResult<TResult>>`
  - `getRegisteredCommandTypes(): TradeEdgeCommandType[]`

**`lib/commands/command-handlers.ts`**
- `registerCommandHandlers(bus: CommandBus): () => void` — currently registers nothing; returns a no-op teardown. Documented as the extension point for future tickets.

**`components/commands/CommandProvider.tsx`**
- `CommandProvider({ children })` — mounts the singleton `CommandBus`, renders no UI.
- `useCommandBusContext(): CommandBus` — low-level context accessor (throws outside provider).

**`hooks/useCommandBus.ts`**
- `useCommandBus(): { dispatch, registerHandler, getRegisteredCommandTypes }` — the intended app-facing hook; wraps the context bus with `useCallback`-stabilized references.

---

## 5. Provider Wiring

```tsx
// app/providers.tsx
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>{children}</CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}
```

`SessionProvider` and `TaskProvider` are untouched in position and props. `CommandProvider` was added as a new innermost layer wrapping `children`, so every existing page still receives the same session and task context it had before, plus command bus access. No provider was removed, reordered, or reconfigured.

---

## 6. Build Results

**`npm run build`** — passed. All 39 routes compiled and generated successfully. No new errors or warnings introduced by this change. (Pre-existing `ioredis ECONNREFUSED` log lines occur during static generation due to no local Redis instance; unrelated to this ticket.)

**`npm run lint`** — not run. This repo has no ESLint configuration committed; `next lint` prompts to interactively scaffold one rather than running against an existing config. Same state as TE-0003.

---

## 7. Diff Statistics

```
$ git diff --stat 90176ac dad010e
 app/providers.tsx                       |  6 ++-
 components/commands/CommandProvider.tsx | 42 +++++++++++++++++++
 hooks/useCommandBus.ts                  | 49 ++++++++++++++++++++++
 lib/commands/command-bus.ts             | 73 +++++++++++++++++++++++++++++++++
 lib/commands/command-handlers.ts        | 25 +++++++++++
 lib/commands/command-types.ts           | 37 +++++++++++++++++
 6 files changed, 231 insertions(+), 1 deletion(-)
```

Note: `90176ac` (docs: add TE-0004 ticket) is the commit immediately preceding the implementation; `dad010e` is the implementation commit itself. A subsequent commit accidentally added a temporary helper script (`apply-te-0004.sh`, 274 lines) to the branch; that commit has been reverted in a follow-up `chore:` commit and is excluded from the stats above as it contained no application code.

---

## 8. Technical Debt

**Known limitations:**
- Only one handler per command type is supported — no fan-out or middleware chain.
- `command-handlers.ts` is an empty scaffold; no command currently does anything when dispatched.
- No logging/telemetry on dispatch, unhandled commands, or handler errors.

**Deferred improvements:**
- Wiring real handlers for `START_RANKED_SCAN`, `START_SCREENER_SCAN`, `RUN_PORTFOLIO_AI_REVIEW`, `START_AUTOPILOT_PAPER_RUN`, `CANCEL_TASK`, `OPEN_TASK_RESULT` (future tickets, per TE-0002 follow-ups).
- Connecting command handlers to `useTaskManager()` so commands actually create/update tasks.

**Future extension points:**
- `registerCommandHandlers()` is the designated place to add handler registration once workflows migrate — it already runs inside `CommandProvider`'s effect lifecycle, so new handlers won't require provider changes.
- `TradeEdgeCommandSource` already distinguishes `ai`/`autopilot` from `user`/`system`, supporting ADR-0002's guardrail that AI/autopilot-originated commands remain distinguishable for review.

---

## 9. Recommendations

Before TE-0005 (Ranked Scan migration is the presumed next step per TE-0002's follow-up list):
- Add a minimal dev-only console warning when `dispatch()` resolves `handled: false`, so silent no-ops during early integration are easier to spot — currently failing safe also means failing silently.
- Confirm whether `registerHandler` should support multiple handlers per type before the first real migration locks in the current one-handler assumption; Ranked Scan migration is a natural point where this constraint gets tested.
- Add a `.gitignore` entry or delivery-process note to prevent temporary helper scripts from being committed again, since this happened on both TE-0003 and TE-0004.
