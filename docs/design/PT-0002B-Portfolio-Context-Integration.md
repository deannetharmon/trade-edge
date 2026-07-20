# PT-0002B — Portfolio Context Integration

**Status:** Implemented on `feature/portfolio-context-integration`, pushed for review in draft PR #15, awaiting Quinn approval, and not merged.
**Project:** TradeEdge
**Owner:** Dean Harmon

## 0. Provenance of this spec

No dedicated PT-0002B ticket/design brief existed before this document. The scope below is drawn directly from PT-0002A's own explicit deferral list (`docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` §8, "Deferred to PT-0002B") and its Known Limitations (§7 items 1–2), which is the only place PT-0002B's scope was previously specified. This document turns that deferral list into a concrete, safety-scoped implementation plan and narrows two of its six items with an explicit, documented decision rather than open-ended discretion (§3).

## 1. Objective

Make `/dashboard` and `/portfolio` mode-aware — they now read the global `PortfolioMode` and refuse to render LIVE portfolio content unless mode is confirmed LIVE — and wire the PT-0002A guardrails (`assertLiveContext`) into the real LIVE broker-submission call sites, closing the ambiguous-context gap PT-0002A's corrective round identified (a screen could claim one mode while rendering another). Reactivate the global mode selector now that this gap is closed.

## 2. Scope

### 2.1 In scope

1. **`/dashboard` (`app/dashboard/page.tsx`) and `/portfolio` (`app/portfolio/page.tsx`) become mode-aware.** Both call `usePortfolioMode()`. LIVE content renders only when `status === 'ready' && mode === 'LIVE'` — otherwise a neutral mode-gate screen renders instead (never LIVE data, never a silent default). The LIVE path is wired through `useLivePortfolioModeAdapter()` (PT-0002A's adapter) rather than calling `usePortfolioData()` directly, satisfying "wire to PT-0002A's mode-aware adapters" literally.
2. **`assertLiveContextReady` guardrail** (new, additive function in `lib/portfolio-mode/guardrails.ts`) wired at every real LIVE broker-submission entry point in `app/portfolio/page.tsx`: `BatchConfirmModal.submitAll`, `SetStopLossButton.submit`, `PortfolioPage.cancelPendingOrder`, `PortfolioPage.replacePendingOrder` — one guard call at the top of each, before any `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder` call reachable beneath it. This is a single choke point per user-triggered mutating action, matching this file's existing pattern (ES-0001/ES-0002: "no broker-reaching statement outside of [the guarded callback]") rather than one assertion per individual `ttPost`/`ttDelete` call.
3. **Reactivate the global mode selector** (`PortfolioModeIndicator`): now that the two screens that previously could silently show LIVE data under a "PAPER" label are mode-gated, the corrective round's disabled-PAPER-control and full-screen PAPER-block are no longer the only safety mechanism, so both are replaced with a normal, working two-way switch (LIVE amber / PAPER emerald), matching the original design intent (PT-0002A §5.4).
4. **Execution-context confirmation copy** (Mandatory Invariant 6): `BatchConfirmModal`'s order-confirmation summary now states the active mode explicitly ("Submitting N orders — LIVE").

### 2.2 Explicit scope decisions (narrowing PT-0002A §8's open items)

5. **PAPER rendering for `/dashboard` and `/portfolio`: deliberately NOT a parallel UI.** When mode is PAPER, both screens render a placeholder directing to `/paper-trading` rather than attempting to force PT-0001's `PaperTradingLedgerView` through the existing LIVE-shaped rendering surface (thousands of lines of `Position`-based UI: Greeks, broker fields, stop/roll/OTOCO controls that have no PAPER equivalent). Building a second, parallel PAPER rendering path for `/dashboard`/`/portfolio` is new feature work on the scale of its own ticket, not "wiring an existing adapter" — attempting it inside this ticket, inside this file, without its own design review would be exactly the kind of undisclosed scope growth this project's process exists to prevent. `contract.ts`'s shared envelope (`PortfolioModeAdapterState<TData>`) is still what a future ticket would build that UI against.
6. **PT-0001 paper-mutation guardrail wiring (`assertPaperContext`) is NOT wired into `lib/paper-trading/service.ts` in this ticket.** Rationale: `assertPaperContext(mode, action)` needs a `PortfolioMode` value to check, and the global mode is an explicitly client-only, browser-`localStorage` concept with "no server-side meaning today" (`lib/portfolio-mode/persistence.ts`'s own module doc). `service.ts`'s four mutation entry points run server-side inside the PT-0001 API routes and have no caller today that reads global mode — `/paper-trading` (the only caller) does not read it (§2.2 item 7), and this ticket does not add a new PAPER-mode mutation UI to `/portfolio` (§2.2 item 5 explicitly declines that). Wiring `assertPaperContext` into `service.ts` today would mean inventing request plumbing (a mode parameter/header) with no real caller ever passing anything but an implicit PAPER — speculative scaffolding, not "wiring into a real call site." The isolation this guard would eventually reinforce is already structurally enforced today by `lib/paper-trading/__tests__/liveIsolation.test.ts` (source-scan proving the paper-trading domain never imports the broker module), unchanged by this ticket. Revisit this the moment a real caller needs it — e.g., if a future ticket adds a mode-aware paper-mutation surface to `/portfolio`.
7. **`/paper-trading` remains its own dedicated route and does not read the global mode.** It is definitionally paper-only regardless of the global selector's state (the page's own identity disambiguates context, unlike `/dashboard`/`/portfolio`, which is the actual defect PT-0002A's corrective round fixed). No change to `app/paper-trading/page.tsx` in this ticket.
8. **`/screener`, `/performance`, `/trade-log`, and Decision/Opportunity Engine inputs remain untouched and out of scope**, unchanged from PT-0002A's own conclusion (§4.7): none of them consume `PortfolioDataProvider` today, so none are affected by, or relevant to, portfolio-mode wiring.

### 2.3 Out of scope (unchanged from PT-0002A, still deferred)

Autopilot activation, new Decision/Opportunity Engine rules, new PAPER strategy/order-entry logic, Capital Allocation Engine, Income Engine, multi-portfolio support, copying LIVE positions into PAPER, automatic LIVE/PAPER synchronization, screen redesigns beyond the mode-gate itself, broker submission semantic changes. `app/rinse-repeat/page.tsx`'s separate OTOCO path (ES-0002 broker inventory item 11) is untouched — a different ticket's candidate (ES-0003), not this one's.

## 3. Architecture

### 3.1 New: `assertLiveContextReady` (`lib/portfolio-mode/guardrails.ts`)

`usePortfolioMode()`'s `mode` is `PortfolioMode | null` — `null` while `status` is `'resolving'` or `'invalid'`. PT-0002A's `assertLiveContext(mode: PortfolioMode, action: string)` cannot accept `null`, and was never meant to be called directly from a React call site that might observe that window. `assertLiveContextReady` is a thin, additive wrapper for real UI call sites:

```ts
export function assertLiveContextReady(
  status: 'resolving' | 'ready' | 'invalid',
  mode: PortfolioMode | null,
  action: string,
): void {
  if (status !== 'ready' || mode == null) {
    throw new PortfolioModeGuardError('LIVE', 'PAPER', action);
  }
  assertLiveContext(mode, action);
}
```

Fails closed on `resolving`/`invalid` (treated as "not LIVE," never as "assume LIVE"). `assertLiveContext`/`assertPaperContext` and every existing PT-0002A test are byte-for-byte unchanged.

### 3.2 `/dashboard` and `/portfolio` mode gate

Both pages already call hooks unconditionally at the top of the component (existing React rules-of-hooks discipline in this codebase); the mode gate is a plain conditional on the final JSX return, not an early `return` spliced between hook calls — no hook-ordering change.

- `app/dashboard/page.tsx`: adds `const portfolioMode = usePortfolioMode();`. If not `status === 'ready' && mode === 'LIVE'`, renders a small inline notice instead of `<CommandCenter />` (three cases: resolving → neutral placeholder; invalid → "resolve portfolio mode using the indicator, top-right"; PAPER → "Dashboard is LIVE-only today — visit /paper-trading").
- `app/portfolio/page.tsx`: adds `const portfolioMode = usePortfolioMode();` alongside the existing `usePortfolioData()` destructure (~line 8678). The single top-level `return (` at line 8965 becomes a branch: LIVE-ready renders the existing page byte-for-byte; otherwise the same three-case placeholder as `/dashboard`. `BatchConfirmModal` and `SetStopLossButton` each call `usePortfolioMode()` directly (global context, no prop drilling) for their own guard calls, independent of whether the parent page happens to still be mid-render — defense in depth, not reliance on a single gate (matching ES-0001/ES-0002's own layered pattern).

### 3.3 Guardrail wiring detail

| Component | Function | Guard call | Real broker calls beneath it |
|---|---|---|---|
| `BatchConfirmModal` | `submitAll` | `assertLiveContextReady(...)` at top, before `setStatus('submitting')` | `cancelOrder`, `ttValidateOrder`, `ttPost`, `ttPostComplex` |
| `SetStopLossButton` | `submit` | `assertLiveContextReady(...)` at top, before `setLoading(true)` | `ttDelete`, `ttPostComplex`, `ttPost` |
| `PortfolioPage` | `cancelPendingOrder` | `assertLiveContextReady(...)` at top | `ttDelete` |
| `PortfolioPage` | `replacePendingOrder` | `assertLiveContextReady(...)` at top | `ttDelete`, `ttPost` (via `runPendingOrderReplacementWorkflow`'s `deps`) |

No `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder` primitive itself is modified — no payload construction, no ES-0001/ES-0002 safety-gate semantics change. This is purely an additive precondition in front of the four existing orchestrating functions.

### 3.4 `PortfolioModeIndicator` reactivation

The corrective round's disabled-PAPER-control and full-viewport PAPER-block existed because no screen was mode-aware yet (PT-0002A §9.1: a trader could select PAPER, see the badge, and still be looking at real LIVE data). With `/dashboard` and `/portfolio` now refusing to render LIVE content outside `status==='ready' && mode==='LIVE'` (§3.2), that failure mode is closed at the screens themselves, not just at the shell. `PortfolioModeIndicator` changes:
- `ready` state: a real two-way switch (LIVE amber / PAPER emerald badge, matching §5.4's original, un-rejected design), `setMode('PAPER')` enabled.
- `invalid` state: PAPER becomes a real, selectable resolution option (previously disabled), not only LIVE.
- The full-screen PAPER-block is removed — no longer needed once every current PortfolioDataProvider-consuming screen (`/dashboard`, `/portfolio`) is self-gating.

## 4. Test plan

- Extend `lib/portfolio-mode/__tests__/guardrails.test.ts` with `assertLiveContextReady` coverage (ready+LIVE passes; resolving/invalid/PAPER all throw `PortfolioModeGuardError`).
- New/extended component tests for `app/dashboard/page.tsx`'s and `app/portfolio/page.tsx`'s mode-gate rendering (resolving/invalid/PAPER render the placeholder, never `<CommandCenter />`/the LIVE page body; ready+LIVE renders unchanged).
- `PortfolioModeIndicator.test.tsx`: update for the reactivated switch (PAPER now selectable, no more full-screen block asserted).
- Full existing regression suite re-run unmodified to confirm zero behavior change to ES-0001/ES-0002 safety gates, `closeOrderSafety`/`closeOrderSubmission`/`pendingOrderReplacementSafety`/`pendingOrderReplacementSubmission`, and `liveIsolation.test.ts`.
- `npx tsc --noEmit` clean.

## 5. Acceptance criteria

- With mode LIVE (the default/first-use value, unchanged from PT-0002A): `/dashboard` and `/portfolio` render byte-identical output and behavior to `main` @ `ce28842`.
- With mode PAPER: neither screen renders any LIVE position/balance data; both show the placeholder; the global indicator no longer blocks the whole shell.
- Any attempt to reach a real broker-submission call site while mode is not confirmed LIVE throws `PortfolioModeGuardError` before any `fetch()` to TastyTrade fires.
- No change to any ES-0001/ES-0002 file, any `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder` payload, or `lib/paper-trading/service.ts`.
- Full test suite passes; `tsc --noEmit` clean.

## 6. Branch strategy

`feature/portfolio-context-integration`, branched from `main` @ `ce28842`. Not merged by this ticket — Product Owner review required first, per this repo's standing process.
