# Ticket status: full reconciliation (2026-09-27)

One-time sweep of every file in `docs/tickets/` (127 files) plus GitHub issues, so the status of anything is a lookup here instead of a re-scrub. **Update this file, don't re-derive it, when a ticket's status changes** — add a line to "Changes since this sweep" at the bottom rather than re-running the full audit.

**How each bucket was decided:** a ticket's own `**Status:**` line, whether `docs/implementation/<code>-implementation-report.md` exists, and for tickets with neither, a quick grep for characteristic code (noted per row). Rows marked *(assumed)* have no status line, predate the status-line convention, and were not individually code-verified — the app's 5,900+ passing tests say the feature area works, but nobody confirmed this specific ticket's exact scope shipped as written.

## 🔴 Urgent — not a ticket-status item, found during this sweep

- **`.env.local` is tracked in git right now**, with what read as real TastyTrade credentials (client ID, secret, a 559-character refresh token), per `SEC-0001-tracked-env-file-and-api-auth-triage.md`. This is live, not historical. S1 (rotate the credentials in TastyTrade and Vercel — only Dean can do this) is unresolved. Do not treat SEC-0001 as done until Dean confirms S1.

## 🟡 Outstanding — needs a decision, a build, or both

| Ticket | What's actually left |
|---|---|
| SEC-0001 | S1 (Dean: rotate credentials) unresolved; S2 (untrack the file) and S3 (route triage) not started |
| DECIDE-0001 | Revision 7. Dean's 7 decisions, O17/O19/O20, decision 7 before S3-0a. Tracked in ROADMAP item 12 |
| KEEP-CREDIT-0001 | Draft 2. Dean's approval of the mock + 5 decisions, Dane's pre-build review. ROADMAP item 13 |
| WHEEL-SYSTEM-0003 | Draft 1. Diane's mock, then Dean's approval. ROADMAP item 14 |
| LEAPS-PMCC-RECOVERY-0001 (issue #49) | Ian/Paul's 9 questions ruled on; mock published; still needs Diane/Alan's confirmation and Dean's build approval |
| LEAPS-PMCC-RECOVERY-0002 (issue #50) | Draft, split out of #49; not reviewed |
| LEAPS-PMCC-RECOVERY-0003 (issue #51) | Draft, split out of #49; needs Diane's mock before build |
| CI-FLAKY-0002 | Draft (Paul); Quinn's review; not yet on the roadmap — Dean to say yes/no |
| AI-POLICY-0001B/C/D/E | Each Draft and explicitly blocked (0001A dependency, Diane's mocks, Ian's field list, the PMCC 3-stage flow landing first) |
| AI-POLICY-0001G | Deferred; blocked on Paul (D10), reports not defined |
| AI-POLICY-0001-epic | Decisions D3 and D6 still open, from 2026-09-19 — very old; worth a quick "still relevant?" check before treating as live |
| CSP-WORKFLOW-0001 | Explicitly "partially implemented" |
| ENTRY-0002 | Deferred until a reviewable complete-snapshot cohort exists (data-gated, not a decision) |
| LCC-0001B/C/D/E | Each "Ready after" the previous slice; 0001A itself is implemented but pending Gate A acceptance, so B-E have not started |
| PMCC-0001-leap-call-income-readiness-draft.md | Draft, never built. **Naming collision:** a second, unrelated ticket is also numbered PMCC-0001 (`PMCC-0001-broker-verified-existing-leap-covered-calls.md`, in progress). Worth renaming one so "PMCC-0001" stops being ambiguous |
| STOCKS-ORDERS-0001 | Proposed, touches the order path; needs Diane's mocks and Alan/Ian's review before any build |
| TRADELOG-0002 | Proposed, not started |
| LEAPS-PI-0001 | A Dane-facing implementation plan; says implementation is not authorized by the doc alone — confirm whether its plan was ever actually greenlit and run |

## ⚪ Superseded / duplicate — safe to ignore, already marked or noted here

| Ticket | Note |
|---|---|
| DECIDE-0001-G6-dane-review.md | Marked SUPERSEDED 2026-09-27; parallel-session record, revision 7 is truth |
| DECIDE-0001-O10-mock-approval.md | Same |
| DECIDE-0001-O12-ian-rulings.md | Same |
| LEAPS-PMCC-RECOVERY-0001-held-leaps-recovery-vs-income.md | Repo mirror of GitHub issue #49; had drifted out of sync (still had the self-approved "READY FOR IMPLEMENTATION" text the issue itself later corrected), reconciled 2026-09-27 to match the issue exactly |

## 🔵 Reference / not a build ticket

`README.md` (docs/tickets index — itself stale, see below), `LCC-0001-execution-sequence.md`, `LCC-0001-review-index.md`, `DECIDE-0001-review-2026-09-25.md`, `LEAPS-PMCC-RECOVERY-0001-ian-paul-rulings.md` (this session's ruling record).

**`docs/tickets/README.md` is stale and misleading** — it links a file that no longer exists (`LEAPS-FLOW-0001-broker-first-standalone-leaps.md`), lists roughly 24 of the 127 tickets, and its own "roadmap order" section predates `docs/ROADMAP.md`, which is the real source of truth per CLAUDE.md. Recommend deleting it or replacing its content with a one-line pointer to `docs/ROADMAP.md` and this file.

## ✅ Done — implemented, confirmed either by an implementation report or a code check this sweep

Grouped by ticket family; the code check used is noted where there was no implementation report.

**Confirmed via `docs/implementation/*-implementation-report.md`:** AI-POLICY-0001A, AI-POLICY-0001B *(the report exists even though the ticket's own status line still says Draft — the doc was never updated after it shipped)*, AI-POLICY-0001F, AI-SEC-0001, CI-0001, CSP-IVR-0001, ENTRY-0001, ENTRY-0001A, LCC-0001A (pending Gate A acceptance, not a rebuild), LEAPS-AI-0002, LEAPS-AI-0003, LEAPS-CYCLES-0001, LEAPS-DASH-0001/0002/0003/0004, LEAPS-ENTRY-0001, LEAPS-EVENTS-0001, LEAPS-LEDGER-0001, LEAPS-MANDATE-0001, LEAPS-PMCC-START-0001, LEAPS-POS-0001, LEAPS-POS-0002, LEAPS-SINCE-0001, LEAPS-SPARK-0001, PNL-BASIS-0001, SCREENER-CONFIG-0001A, SCREENER-CONFIG-0001B, SCREENER-SORT-0001, STOCKS-0001, TE-0007A, TE-0007C *(pure logic; screener wiring flagged not-yet in the report — verify wiring if this one specifically matters)*.

**Confirmed by a code check this sweep** (status line said "Ready for implementation/validation" but never updated): TE-0003, TE-0004 (`CommandBus`, 5 files), TE-0005A (`RankedScan`, 22 files), TE-0005B (`TaskStatusBar`, 7 files), TE-0005C (task completion notifications, part of the task-manager set), TE-0005D (`TaskDrawer`, 2 files), TE-0006A (`lib/portfolio-intelligence/health/score.ts`), TE-0006B (`features/portfolio/recommendations/recommendation-rules.ts`), RF-0001 (`features/screener/` exists), IVX-0001 (`lib/scans/expectedMove.ts` and related), POSITIONS-0002/0003/0004/0005 (stop controls live in `features/portfolio/positions-workspace/`), CSP-0003.

**Old tickets with no status line, presumed implemented *(assumed, not individually verified this sweep)*:** AI-POLICY-0001-deterministic-first-ai-analysis, CI-FLAKY-0001, CSP-0002, CSP-ORDERS-0001, EARNINGS-DATEBASIS-0001, EARNINGS-MARGIN-0001, EARNINGS-NO-DATE-0001, EARNINGS-PRECHECK-0001, EM-CONTEXT-0001, LEAPS-DEFAULTS-0001, LEAPS-INCOME-READINESS-0001 *(this one specifically was called "draft" earlier in this session's own notes — worth a closer look before trusting "assumed done")*, PERFORMANCE-STRATEGY-0001, PERFORMANCE-STRATEGY-0002, PMCC-0001-broker-verified-existing-leap-covered-calls (its own header says "In progress," so likely not fully done — recheck), PMCC-0002, PMCC-ASSIGNMENT-RISK-0001, PMCC-EARNINGS-PAST-0001, PMCC-HELD-BREAKEVEN-0001, PMCC-HELD-BREAKEVEN-0001B, PMCC-HELD-LONG-FLAGGED-0001, PMCC-RECEIPT-0001, PORTFOLIO-MODE-0001, QUAL-STATES-0001, SCAN-ALIGN-0001 and its C1/C2/D/E/F sub-tickets and mock files, SCAN-EARNINGS-TARGETED-0001, SCAN-EXPORT-0001, SCAN-GUIDE-0001, SCAN-HEADER-0001, SCREENER-CONFIG-0001-filter-mode-decision, SCREENER-CONFIG-0001-unified-scan-configuration, SCREENER-LIQUIDITY-0001, SCREENER-OI-0001, SCREENER-PREFS-0001, SCREENER-UX-0001, SCREENER-VISUAL-0001, TE-0001, TE-0002, TE-0007.

**Built and live this session** (not in the sweep above; tracked in ROADMAP items 9-11, 14): POSITION-INTENT-0001, RSI-TURN-0001 phase 1, CUT-LOSSES-REVIEW-0001 (partial), WHEEL-SYSTEM-0001 (W1), WHEEL-SYSTEM-0002 (W2).

## Two more loose ends this sweep turned up

1. **PMCC-0001 naming collision** (see the Outstanding table). Rename one before it causes a real mix-up.
2. **`docs/tickets/README.md` is stale** (see Reference section). Low priority, purely a documentation-hygiene item.

## Changes since this sweep

*(Nothing yet — add a dated line here each time a ticket in this file changes status, instead of re-running the sweep.)*
