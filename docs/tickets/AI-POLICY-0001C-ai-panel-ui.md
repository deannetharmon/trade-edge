# AI-POLICY-0001C — AI Panel UI, Lifecycle States, Accessible Citations

**Status:** Draft — **blocked until Diane's mocks are approved** (standing rule: no UI to code without mocks)
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec ACs:** 5, 8, 12 (UI), 13

## Problem

The routes from 0001B have no user-facing surface. The spec requires an opt-in, non-blocking, accessible panel that keeps the explanatory/read-only boundary obvious and renders citations a trader can actually read.

## User value

The trader can ask for an explanation, read it with evidence one keystroke away, and is never blocked or misled if AI is off, slow, stale, or wrong.

## Scope

1. **Diane's deliverables (gate):** mocks for the seven states (requested, loading, ready, unavailable, rejected, stale, retry) on Screener results (host for `scan_summary` / `grounded_chat`), desktop and mobile; placement and visual weight consistent with Ian's three-tier principle (the panel is ambient-informational, never louder than decision content); the **field-label catalog** (the human `label` for every citable field in each route registry); wording for the persistent label line and each neutral unavailable/rejected message. LEAPS and PMCC/Positions hosts are mocked in 0001D/0001E.
2. `features/ai-policy/` (feature-oriented, ADR-0004):
   - `components/AiExplanationPanel.tsx`, `CitationChip.tsx`, `EvidenceDisclosure.tsx`, `AiStatusRegion.tsx`
   - `hooks/useAiArtifact.ts` (request → poll/GET → state machine), `state.ts` (pure reducer)
   - `api.ts` (typed fetch wrappers for `/api/ai-policy/*`)
3. **Persistent label line** in the panel: "AI explanation — does not change scan results or trading eligibility." plus model tier, "read-only", source-specific as-of times, and the analysis reference (short form of the input id / payload hash) — exact copy from Diane.
4. **State behavior:** opt-in button only; deterministic results render first and are never hidden or blocked; `loading` never disables scanning; `stale` (refresh or superseded `current` pointer) shows the old artifact clearly marked stale with an explicit **Rerun** — never silently replaced; `rejected`/`unavailable` show only the neutral message; `retry` is available for transient reasons only.
5. **Accessibility:** a polite live region announces state changes (`role="status"`); errors use `role="alert"`; focus is never stolen on completion; after Rerun/Retry focus stays on the invoking control's replacement; every citation is a real `<button>` (Enter/Space) that toggles an inline disclosure showing **label, canonical value, source, as-of time** in plain language; if a deterministic element registered an evidence anchor (`data-ai-evidence="<label-id>"`), the disclosure also offers "Show in results" that scrolls/focuses it; otherwise the disclosure alone is the fallback. Never render a raw pointer or hash. Touch targets ≥ 44 px; layout uses relative units/flex and works at narrow widths (the app currently has little responsive design — this panel must not add fixed pixel widths).
6. **Host integration:** one `<AiExplanationPanel />` mount in the Screener results area with a minimal hook in `app/screener/page.tsx`. No new named exports from any `page.tsx`. The freeze call reads the active session through the existing session accessors and never mutates it.

## Non-goals

No LEAPS/PMCC deep-analysis UI (0001D/E). No chat persistence beyond server artifacts. No changes to scan rendering, ranking, or eligibility display. Evidence anchors are added only where Diane's mock names them.

## Acceptance criteria

1. Panel is invisible unless the server reports the route enabled (the panel asks the server; the client never derives the flag itself — same lesson as the LEAPS advisor flag mismatch).
2. All seven states covered by component tests with role/name/live-region/focus assertions (Testing Library; no new dependency).
3. Every citation is reachable and operable by keyboard alone; disclosure content equals the server-rendered `{label, displayValue, sourceLabel, asOf}`; no test output or DOM contains a JSON Pointer or hash as citation text.
4. With AI unavailable/rejected/erroring, the Screener DOM outside the panel is identical to AI-off (snapshot test), and scan controls remain enabled.
5. Refresh/new scan marks the visible artifact stale and offers Rerun; no automatic re-request.
6. Manual checklist (recorded in the report): keyboard-only pass, screen-reader announcement pass (state changes and citation disclosure), 320 px-wide layout pass.
7. Vercel preview build passes (no named exports from `page.tsx`).

## Implementation notes

- Verify `app/screener/page.tsx` (~12.6k lines) exact insertion point and existing session accessors before patching; keep the diff to an import, a mount, and the smallest wiring. Sibling check: other panels already in the results area (advisor panels) so the new panel does not collide with them.
- Tests: `features/ai-policy/__tests__/*.test.tsx` (jsdom via the `.test.tsx` glob).
- Copy strings live in one module (`features/ai-policy/copy.ts`) so Diane can edit wording without touching logic.

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build, then Diane and Quinn walk the seven states on the preview at desktop and phone widths.

## Rollout notes

Panel ships hidden; visible only for routes whose flag and launch gate are on.
