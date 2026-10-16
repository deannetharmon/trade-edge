# PORTFOLIO-AI-0003 — Portfolio Advisor: balanced, intent-aware portfolio report

Status: DRAFT v2 (2026-10-16). Not ready for Dane. Needs Ian (rubric), Alan (thresholds), Quinn (review), Diane (mock approved by Dean) before build.
v2 changes (Ian review, Dean decisions): verdict-mix cap replaced by fixture-based expected verdicts; Manage vs Roll defined; every verdict carries an invalidation line; intent = label by default, overridden by an explicit note; notes store gains a timestamp (slice A0).
Owner: Dane (build) | Reviewers: Ian (rubric and trading logic), Paul (scope), Alan (thresholds and math), Quinn (QA, balance evals), Diane (report screen)
Builds on: PORTFOLIO-AI-0001 (Ask AI panel, snapshot, figure guard) and PORTFOLIO-AI-0002 (per-position facts). Routes through the AI-POLICY-0001 gateway.

## Problem
Dean wants a comprehensive Portfolio analysis from the Portfolio page that takes his intent for each position into account, uses the primary indicators, and is a real, even assessment: not skewed toward safety (close everything) and not skewed toward optimism. The current panel is free-form chat. It guards figures (the model cannot quote a number that is not in the snapshot) but nothing guards tone or balance, and the snapshot carries no technicals (daily RSI, trend).

## What exists (do not rebuild)
- `PortfolioAiPanel` in `app/portfolio/page.tsx` (docked, read-only, stale after 20 minutes, Refresh).
- `lib/portfolio-ai/snapshot.ts` (tiles, watch lines, notAvailable, allowedFigures, contextText), `positionFacts.ts` (full workspace record per position, including intent, IV/IVR, Greeks, earnings), `fromPositions.ts`.
- `redactUnsupportedFigures` (figure guard). The model may not contradict the app's canonical suggested action.
- `lib/ai-policy` gateway (auth, provenance, kill switch, budgets) and `/api/ai-policy/grounded-chat`.
- `lib/ai/models.ts`: decision tier `gpt-5.6-terra` (D3, decided 2026-10-06). `/api/analyze` requires a session (AI-SEC-0001 implemented).

## Scope
1. A "Portfolio report" action in the existing panel. On demand only. Read-only: never changes scan, portfolio or order state.
2. A new gateway route returning a structured report (JSON schema, validated), decision-tier model.
3. Snapshot additions: daily RSI state (existing `lib/indicators/rsi.ts` and `rsiTurn.ts`, no second implementation), trend, and whether intent was set by the user or defaulted.
4. Soft spend limit (decision D6, Dean 2026-10-16): no hard budget. A monthly USD threshold (env var, starting value $25) triggers a confirm prompt ("You've reached $X this month. Continue?"). Confirming lets the request run and silences the prompt for the session. Login and the kill switch remain hard.
5. Evaluation set that checks balance (see Quinn gates).

## Report shape (schema, enforced by validator)
- Portfolio section: overall read, concentration and leveraged-ETF cluster, cash-secured collateral (no margin), theta against downside, the top three issues.
- One entry per position: verdict (Hold, Manage, Close, Roll), confidence (Low, Medium, High), case for the verdict, the strongest case against it, an invalidation line ("what changes this verdict": a stated price, RSI or DTE condition), the indicators that drove it, and the intent used with its source (label set, label default, or note).
- Verdict definitions (Ian, thresholds to be confirmed by Alan): Hold = no action. Manage = act on the position's risk without closing it (adjust, add a GTC or stop). Close = exit now. Roll = move the same exposure out in time.
- Every number must come from the snapshot (existing figure guard). Missing data prints "not available" and lowers confidence. Never estimated.
- The report may not contradict the app's canonical recommendation; where it disagrees it must say so explicitly as a flagged difference for Dean to judge.

## Inputs the verdict must consider (Ian to confirm rubric)
DTE against the 21-DTE management stop; percent of max profit against the 50% target; loss against the 2x credit stop; buffer to the short strike; delta; IVR; daily RSI against Dean's 40 rule; trend; earnings before expiry; position intent; concentration. Assignment on an Acquire or Wheel short put is not by itself a problem (POSITION-INTENT-0001).

## Balance rules (the "real, even" requirement)
- Every verdict carries a case for and a case against. "Do nothing" is a valid and expected verdict.
- No verdict may rest on safety alone. The reason must cite at least one indicator from the position's own data.
- No verdict-mix cap (the v1 80% rule is withdrawn: a calm book can legitimately be mostly Hold, and a cap would push invented Manage calls). Balance is tested with fixture portfolios where each position has a known correct verdict set by Ian; the report must match, and a mixed fixture must produce a mixed result. The verdict-mix bar on screen is information only.
- Defaulted intent is shown as defaulted and lowers confidence. A defaulted Acquire is not treated as a deliberate choice.

## Intent: label by default, overridden by an explicit note (Dean, 2026-10-16)
- The position's intent label is the default. A position note that states a plan ("will own below $X", "taking profit near target", "don't want assignment") overrides it. Commentary that does not state a plan does not override; the report says the note was read and not used.
- The card shows which one drove the verdict: label (set), label (default), or note, with the note text.
- An override changes what counts as a problem, never what is hidden. Buffer, loss against the 2x credit stop and DTE still appear on the card.
- An ambiguous note falls back to the label and says so.
- Staleness: the report shows the note's age and lowers confidence when the position has changed since (new expiry, roll). Legacy undated notes are treated as undated: usable, flagged, lower confidence.

## Notes store (Dane, verified 2026-10-16)
`app/api/position-notes/route.ts` stores plain text only, max 150 characters, keyed by account and position key (`position-notes:<userId>` in Redis). It stores NO date, and the portfolio AI snapshot does not read notes today. Slice A0: the store accepts and returns an optional `updatedAt` per note (backward compatible: a bare string is read as a legacy undated note), and positionFacts adds the note text and age. No change to the 150-character limit or to existing notes.

## Open items (not decided here)
- Ian and Alan: rubric thresholds (what moves Hold to Manage to Close to Roll) and the expected verdicts for each eval fixture.
- Open roadmap item: every lone short put defaults to Acquire, and the legacy recommendation and `managementIntent.ts` can disagree. The report reads the raw intent and its source. Fixing the default is a separate decision for Dean and Ian.
- Live baseline: Dean runs the current Analyze and shares the response; this is the "before" for the eval comparison.
- Vercel env check: `AI_ANALYSIS_MODEL`, `AI_CHAT_MODEL`, `AI_POLICY_ECONOMY_MODEL`, `AI_POLICY_REASONING_MODEL` (names and values only).
- Per-report cost is unknown until the first live runs; the $25 threshold is adjusted from real numbers.

## Quinn gates
- Eval fixtures: at least a mixed book (healthy CSP, tested CSP Acquire, spread near stop, LEAP, PMCC pair, leveraged ETF cluster). Assert: verdict spread, case-against present, no unsupported figures, "not available" handled, defaulted intent labelled.
- Soft-limit test: threshold crossed returns a confirm-required response, confirmed request runs, auth and kill switch still block.
- Fail closed: route unavailable if the model is not allowlisted or priced; the panel shows the existing deterministic tiles regardless.
- Sibling check: the other `/api/analyze` callers are untouched.

## Out of scope
Scoring or qualification changes, order placement, changing recommendation rules, the intent-default fix, mobile layout (follows the phone layer).

## Delivery
Slices after approvals: A0 notes timestamp and note facts; A snapshot additions (RSI, trend, intent source) + tests; B gateway route + schema + soft limit + tests; C report UI after Dean approves Diane's mock; D eval set and live check by Dean in market hours. One push per slice, CI green and Vercel preview Ready before merge.
