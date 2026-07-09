# Trade Edge Handoff

**Date:** 2026-07-09  
**Branch:** `main`  
**Current focus:** TE-0001 / TE-0005A — Background Ranked Screener + app-level task workflow  
**Recommended next chat opener:** `Continue Trade Edge from planning/HANDOFF.md and planning/SPRINT_STATUS.md.`

---

## Current Working Mode

Use short implementation-mode responses:

- State the next task.
- Make the smallest safe code change.
- Report commit SHA, what changed, and what to test.
- Avoid duplicate docs; update existing `planning/*`, `docs/decisions/*`, `docs/tickets/*`, and `docs/reviews/*` files.

---

## Completed This Session

### Background Ranked Screener / Navigation Survival

- Ranked scan returned to the stable client TaskManager path after the server-side TastyTrade/Vercel worker experiment failed with 401s.
- Added root-level scan/task mirroring so the global scan card continues to update while navigating inside the app.
- Removed duplicate generic Background Tasks popup from the app shell.
- Added global status card behavior for ranked scans.
- Prevented completed/error/stopped scan cards from resurrecting after hard refresh.
- Fixed `Open Results` behavior so it only appears when it can navigate somewhere useful.
- Fixed Next build failure by removing `useSearchParams()` from the globally mounted status card.

### Screener Card UI Polish

- Hid redundant yellow `⚠ DTE` pill.
- Forced scheduled/re-screen follow-up badges to remain one-line tokens.
- Current implementation uses `components/ScreenerCardPolish.tsx`, mounted in `app/providers.tsx`, as a low-risk DOM polish helper. This is acceptable as temporary UI polish but should eventually be folded directly into `app/screener/page.tsx` during a refactor.

### AI Model Resilience

- Added API-level fallback in `app/api/analyze/route.ts` so unavailable coded models do not hard-fail analysis.
- Centralized cost-effective defaults in `lib/ai/models.ts`.
- Default analysis/chat/summary/fast model is `gpt-4o-mini` unless overridden by env vars.

---

## Important Recent Commits

- `09da04e` — fix(screener): avoid useSearchParams in global status card
- `81e7f79` — fix(screener): do not restore completed scan card after reload
- `a05a57e` — fix(tasks): remove duplicate task status popup
- `a0eeab6` — feat(screener): mount ranked scan task mirror
- `7d753b3` — fix(ai): fallback to default model when requested model fails
- `a53d28b` — fix(ai): default analysis profile to cost-effective model
- `29d92dc` — fix(screener): polish earnings follow-up badges
- `4d0ce6a` — fix(screener): mount card polish helper

---

## Outstanding TE-0001 / Background Screener Items

1. **Cancel Scan**
   - ADR exists: `docs/decisions/ADR-0003-ranked-scan-cancellation.md`.
   - Preferred design: cooperative cancellation via TaskManager/CommandBus, not server-side TastyTrade worker.
   - Current status: UX has been discussed; final behavior still needs verification/implementation cleanup.

2. **Refresh/Reconnect Behavior**
   - Browser refresh should not show stale completed cards.
   - Need final decision: if a ranked scan is running and browser refreshes, either reconnect if the task is still available or mark it as stopped/stale cleanly.

3. **Regression Test**
   - Start ranked scan.
   - Navigate from Screener to Portfolio/Engine/Repeat Strategies/Trade Log.
   - Confirm progress continues or at least the global card remains truthful.
   - Confirm completion only shows one notification.
   - Confirm hard refresh does not resurrect old completed cards.
   - Confirm `Open Results` navigates only from non-results pages.

4. **Temporary UI Helper Cleanup**
   - `components/ScreenerCardPolish.tsx` is a pragmatic patch.
   - Fold it into first-class React rendering when touching `ResultCard` again.

---

## Known Issues / Risks

- Google OAuth preview URL management remains annoying. Long-term solution is a stable preview/staging URL or custom Vercel domain.
- The app currently relies on Vercel as the primary build gate because local npm/build is constrained.
- `app/screener/page.tsx` is very large and increasingly fragile. Future changes should favor extraction over direct large edits.
- Server-side TastyTrade scan execution failed due to token/auth behavior from Vercel. Do not reintroduce server-side TastyTrade scan calls until auth design is explicitly solved.

---

## Next Recommended Task

Finish **Cancel Scan** for the client TaskManager ranked scan path.

Target outcome:

- User clicks `STOP SCAN`.
- Current ranked task is marked `cancelled`.
- UI stops scanning/loading.
- No partial results are promoted as completed results.
- One clear stopped/cancelled card appears and can be dismissed.

---

## Next Major Product Phase After TE-0001

**Portfolio Intelligence**

Purpose: move Trade Edge from symbol-level scanning to portfolio-aware recommendations.

Initial questions the app should answer automatically:

- Do I already own this ticker or similar exposure?
- Does this duplicate an existing expiration/strategy?
- How much sector concentration does this add?
- How much buying power/cash remains after the trade?
- Does this violate allocation/risk rules?
- Is this candidate actually additive to the portfolio?

---

## Product Direction

Trade Edge is evolving from an options screener into a portfolio decision engine. The goal is not just to list candidates; the app should eventually recommend the best few actions, explain why, and reject weaker alternatives with clear reasoning.
