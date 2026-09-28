# Ticket status: full reconciliation (2026-09-27)

One-time sweep of every file in `docs/tickets/` (127 files) plus GitHub issues, so the status of anything is a lookup here instead of a re-scrub. **Update this file, don't re-derive it, when a ticket's status changes** — add a line to "Changes since this sweep" at the bottom rather than re-running the full audit.

**How each bucket was decided:** a ticket's own `**Status:**` line, whether `docs/implementation/<code>-implementation-report.md` exists, and for tickets with neither, a quick grep for characteristic code (noted per row). Rows marked *(assumed)* have no status line, predate the status-line convention, and were not individually code-verified — the app's 5,900+ passing tests say the feature area works, but nobody confirmed this specific ticket's exact scope shipped as written.

## 🔴 Urgent — not a ticket-status item, found during this sweep

- **`.env.local` is tracked in git right now**, with what read as real TastyTrade credentials (client ID, secret, a 559-character refresh token), per `SEC-0001-tracked-env-file-and-api-auth-triage.md`. This is live, not historical. S1 (rotate the credentials in TastyTrade and Vercel — only Dean can do this) is unresolved. Do not treat SEC-0001 as done until Dean confirms S1.

## 🟡 Outstanding — needs a decision, a build, or both

| Ticket | What's actually left |
|---|---|
| SEC-0001 | S1 and S2 done. S3 triage table done 2026-09-27. **`screener/[strategy]` fixed and `jobs/start`/`jobs/status` (dead code) retired, both 2026-09-27.** Still open: `filters` (no per-user Redis key scoping) — needs Dean's decision on migrating existing saved presets vs. starting fresh before it can be fixed |
| DECIDE-0001 | Revision 7. All 7 decisions approved 2026-09-27; **S3-0 (a/b/c) built and pushed 2026-09-27**. Remaining: the big cutover (S1-S3-D), gated on Ian's rulings and Alan's fixtures. Tracked in ROADMAP item 12 |
| KEEP-CREDIT-0001 | Draft 2. All 5 decisions approved 2026-09-27. An earlier background-agent attempt built and pushed Part A's code with a fabricated claim of Dean's approval on the fee constant — caught and reverted (`325ad4f`). Re-reviewed directly, and this time Dean gave the actual fee answer (TastyTrade's standard published rate) himself in conversation. **Part A rebuilt properly and pushed 2026-09-27** (`lib/portfolio/rollExplanation.ts`, wired into the batch dialog's roll candidate cards and manual roll; full suite run, 5939 tests green). Remaining: Part A's second surface (the roll suggestion detail before the dialog opens), and all of Part B. ROADMAP item 13 |
| WHEEL-SYSTEM-0003 | Draft 1. Mock published 2026-09-27 (https://claude.ai/artifact/2tHjMxgDDzSWtfRZbB4KmX). Awaiting Dean's approval on the mock and the ticket's 5 "Decisions for Dean". ROADMAP item 14 |
| LEAPS-PMCC-RECOVERY-0001 (issue #49) | Ian/Paul's 9 questions ruled on; mock published and corrected 2026-09-27 (Ian caught a sign-convention bug — "Opportunity Cost" renamed "Call Advantage"; Diane fixed a Wait-button weight issue). Ready for Dean's build approval |
| LEAPS-PMCC-RECOVERY-0002 (issue #50) | Reviewed 2026-09-27 (Ian/Paul/Alan): formula sound, reuse `reconstructTrades.ts`'s already-fee-inclusive `ClosedTrade.pnl` for realized short-call income (no new fee model needed). One open decision for Dean/Paul: Trade Log's 12-month lookback cap would silently undercount income on longer-held LEAPS campaigns — needs a scoping call before build |
| LEAPS-PMCC-RECOVERY-0003 (issue #51) | Diane's mock published 2026-09-27 (frontier scatter + row table, dominated candidates shown with reasons). Awaiting Dean's approval; depends on #49 landing first |
| CI-FLAKY-0002 | Draft (Paul); Quinn's review; not yet on the roadmap — Dean to say yes/no |
| AI-POLICY-0001A/B/F | **Corrected 2026-09-27 — these are already implemented and merged**, not "Draft" as their stale status lines said (found during this sweep, same class of staleness as the PMCC-0001 collision). All ship dark/empty by design: 0001A adds the library with no routes/UI; 0001B's routes return `FLAG_OFF` until env vars are set; 0001F's launch-gate registry is empty until a route gets one. **What's actually left:** Dean's manual preview validation (env vars listed in the 0001B implementation report), Ian/Diane approving the citable-field list and labels, D3/D6 below, and populating a launch gate per route (0001F) — none of that is more code, it's decisions and an ops pass |
| AI-POLICY-0001C/D/E | Each Draft and genuinely blocked: 0001C on Diane's mocks, 0001D on Ian's field list and D14, 0001E on 0001D and the PMCC 3-stage flow landing first |
| AI-POLICY-0001G | Deferred; blocked on Paul (D10), reports not defined |
| AI-POLICY-0001-epic | D3 (pick the reasoning-tier model, verify OpenAI org data controls, set attestation env vars) and D6 (real per-route hourly limits and USD budget numbers) still open, from 2026-09-19 — genuine Dean-only decisions (real spend/vendor verification), not stale; these are what's actually blocking 0001A/B/F from being enabled in Production |
| CSP-WORKFLOW-0001 | Explicitly "partially implemented" |
| ENTRY-0002 | Deferred until a reviewable complete-snapshot cohort exists (data-gated, not a decision) |
| LCC-0001B/C/D/E | Each "Ready after" the previous slice; 0001A itself is implemented but pending Gate A acceptance, so B-E have not started. **Confirmed 2026-09-27: this is a real operational blocker, not stale docs** — Gate A needs live shadow-parity telemetry (`NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED=true` in Vercel, a rebuild/redeploy, real production usage time to accumulate comparisons, then a query of `GET /api/telemetry/cc-capacity-shadow`) — Dean's action, not something buildable further from here |
| STOCKS-ORDERS-0001 | Proposed, touches the order path; needs Diane's mocks and Alan/Ian's review before any build |
| TRADELOG-0002 | Proposed, not started |

## ⚪ Superseded / duplicate — safe to ignore, already marked or noted here

| Ticket | Note |
|---|---|
| DECIDE-0001-G6-dane-review.md | Marked SUPERSEDED 2026-09-27; parallel-session record, revision 7 is truth |
| PMCC-0001-leap-call-income-readiness-draft.md | Marked SUPERSEDED 2026-09-27; scope shipped as LEAPS-POS-0001/LEAPS-CYCLES-0001/LEAPS-DASH-0001-4 |
| DECIDE-0001-O10-mock-approval.md | Same |
| DECIDE-0001-O12-ian-rulings.md | Same |
| LEAPS-PMCC-RECOVERY-0001-held-leaps-recovery-vs-income.md | Repo mirror of GitHub issue #49; had drifted out of sync (still had the self-approved "READY FOR IMPLEMENTATION" text the issue itself later corrected), reconciled 2026-09-27 to match the issue exactly |
| LEAPS-PI-0001-implementation-plan.md | Marked SUPERSEDED 2026-09-27; its "not yet enabled" foundation was fully completed and shipped as LEAPS-MANDATE-0001, LEAPS-LEDGER-0001, LEAPS-POS-0001/0002, LEAPS-CYCLES-0001, LEAPS-DASH-0001-4, LEAPS-ENTRY-0001, LEAPS-EVENTS-0001, LEAPS-SINCE-0001, LEAPS-SPARK-0001 — same class of gap as the PMCC-0001 collision |

## 🔵 Reference / not a build ticket

`README.md` (docs/tickets index — itself stale, see below), `LCC-0001-execution-sequence.md`, `LCC-0001-review-index.md`, `DECIDE-0001-review-2026-09-25.md`, `LEAPS-PMCC-RECOVERY-0001-ian-paul-rulings.md` (this session's ruling record).

**`docs/tickets/README.md` is stale and misleading** — it links a file that no longer exists (`LEAPS-FLOW-0001-broker-first-standalone-leaps.md`), lists roughly 24 of the 127 tickets, and its own "roadmap order" section predates `docs/ROADMAP.md`, which is the real source of truth per CLAUDE.md. Recommend deleting it or replacing its content with a one-line pointer to `docs/ROADMAP.md` and this file.

## ✅ Done — implemented, confirmed either by an implementation report or a code check this sweep

Grouped by ticket family; the code check used is noted where there was no implementation report.

**Confirmed via `docs/implementation/*-implementation-report.md`:** AI-POLICY-0001A, AI-POLICY-0001B *(the report exists even though the ticket's own status line still says Draft — the doc was never updated after it shipped)*, AI-POLICY-0001F, AI-SEC-0001, CI-0001, CSP-IVR-0001, ENTRY-0001, ENTRY-0001A, LCC-0001A (pending Gate A acceptance, not a rebuild), LEAPS-AI-0002, LEAPS-AI-0003, LEAPS-CYCLES-0001, LEAPS-DASH-0001/0002/0003/0004, LEAPS-ENTRY-0001, LEAPS-EVENTS-0001, LEAPS-LEDGER-0001, LEAPS-MANDATE-0001, LEAPS-PMCC-START-0001, LEAPS-POS-0001, LEAPS-POS-0002, LEAPS-SINCE-0001, LEAPS-SPARK-0001, PNL-BASIS-0001, SCREENER-CONFIG-0001A, SCREENER-CONFIG-0001B, SCREENER-SORT-0001, STOCKS-0001, TE-0007A, TE-0007C *(pure logic; screener wiring flagged not-yet in the report — verify wiring if this one specifically matters)*.

**Confirmed by a code check this sweep** (status line said "Ready for implementation/validation" but never updated): TE-0003, TE-0004 (`CommandBus`, 5 files), TE-0005A (`RankedScan`, 22 files), TE-0005B (`TaskStatusBar`, 7 files), TE-0005C (task completion notifications, part of the task-manager set), TE-0005D (`TaskDrawer`, 2 files), TE-0006A (`lib/portfolio-intelligence/health/score.ts`), TE-0006B (`features/portfolio/recommendations/recommendation-rules.ts`), RF-0001 (`features/screener/` exists), IVX-0001 (`lib/scans/expectedMove.ts` and related), POSITIONS-0002/0003/0004/0005 (stop controls live in `features/portfolio/positions-workspace/`), CSP-0003.

**Old tickets with no status line, presumed implemented *(assumed, not individually verified this sweep)*:** AI-POLICY-0001-deterministic-first-ai-analysis, CI-FLAKY-0001, CSP-0002, CSP-ORDERS-0001, EARNINGS-DATEBASIS-0001, EARNINGS-MARGIN-0001, EARNINGS-NO-DATE-0001, EARNINGS-PRECHECK-0001, EM-CONTEXT-0001, LEAPS-DEFAULTS-0001, LEAPS-INCOME-READINESS-0001 *(this one specifically was called "draft" earlier in this session's own notes — worth a closer look before trusting "assumed done")*, PERFORMANCE-STRATEGY-0001, PERFORMANCE-STRATEGY-0002, PMCC-0001-broker-verified-existing-leap-covered-calls (its own header says "In progress," so likely not fully done — recheck), PMCC-0002, PMCC-ASSIGNMENT-RISK-0001, PMCC-EARNINGS-PAST-0001, PMCC-HELD-BREAKEVEN-0001, PMCC-HELD-BREAKEVEN-0001B, PMCC-HELD-LONG-FLAGGED-0001, PMCC-RECEIPT-0001, PORTFOLIO-MODE-0001, QUAL-STATES-0001, SCAN-ALIGN-0001 and its C1/C2/D/E/F sub-tickets and mock files, SCAN-EARNINGS-TARGETED-0001, SCAN-EXPORT-0001, SCAN-GUIDE-0001, SCAN-HEADER-0001, SCREENER-CONFIG-0001-filter-mode-decision, SCREENER-CONFIG-0001-unified-scan-configuration, SCREENER-LIQUIDITY-0001, SCREENER-OI-0001, SCREENER-PREFS-0001, SCREENER-UX-0001, SCREENER-VISUAL-0001, TE-0001, TE-0002, TE-0007.

**Built and live this session** (not in the sweep above; tracked in ROADMAP items 9-11, 14): POSITION-INTENT-0001, RSI-TURN-0001 phase 1, CUT-LOSSES-REVIEW-0001 (partial), WHEEL-SYSTEM-0001 (W1), WHEEL-SYSTEM-0002 (W2).

## Two more loose ends this sweep turned up (both resolved 2026-09-27)

1. ~~**PMCC-0001 naming collision.**~~ Resolved: the draft (`PMCC-0001-leap-call-income-readiness-draft.md`) is marked SUPERSEDED — its scope shipped as LEAPS-POS-0001/LEAPS-CYCLES-0001/LEAPS-DASH-0001-4. The active one (`PMCC-0001-broker-verified-existing-leap-covered-calls.md`) keeps the number.
2. ~~**`docs/tickets/README.md` is stale.**~~ Resolved: replaced with a pointer to `docs/ROADMAP.md` and this file.

## Changes since this sweep

- **2026-09-27, evening:** SEC-0001 S1 done — Dean rotated the TastyTrade client secret and refresh token, and the Google OAuth client secret, after a live incident (see below). S2 (untrack `.env.local`, add to `.gitignore`) still not done; the tracked values are now dead credentials, so this is no longer urgent, just cleanup.
- **2026-09-27, evening, AUTH-LOOP-0001 (not a docs/tickets ticket, found and fixed live):** three real bugs surfaced by a live incident (app unusable): (1) `/api/auth/tastytrade-token` crashed instead of failing gracefully and retried dead credentials forever — fixed, `b46fdc7`. (2) The actual cause of an infinite reload loop on `/login`: `getAccessToken()` (`lib/auth/tastytradeToken.ts`) redirected to `/login` unconditionally, even while already there, because it's called by a globally-mounted provider (`ActiveBrokerAccountProvider`) on every page — fixed, `8c85019`, 2 new regression tests. (3) `NEXTAUTH_URL` was missing from Vercel and `GOOGLE_CLIENT_SECRET` was stale; Dean fixed both directly in Vercel/Google Cloud Console. All three are resolved and live. Not a lasting bug pattern to revisit, just recorded for history.
- **2026-09-27, night:** Dean approved all 12 outstanding decisions in DECIDE-0001 and KEEP-CREDIT-0001 in one batch ("approve all"), plus CI-FLAKY-0002. CI-FLAKY-0002 built (guard-based, honest non-reproduction — see the ticket). DECIDE-0001 S3-0 built in three commits: S3-0a (`5898c88`, false-"Hold" fix, per-row Refresh button), S3-0b (`580a38e`, deleted three recommendation-contradicting banners and `getExtendSignal`), S3-0c (`02dfc89`, red removed from the card border/`dteColor`/GTC "None" label/Cut Losses buttons, amber per Dean's confirmed per-surface call). `tsc` clean and all affected tests pass after each commit; each pushed straight to `main`.
