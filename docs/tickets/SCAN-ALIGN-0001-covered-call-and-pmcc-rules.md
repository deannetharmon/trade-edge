# SCAN-ALIGN-0001 — Align covered-call and PMCC short-call rules

## Status

**Team review done 2026-09-24 (Frank facilitating; Ian, Paul, Alan). Recommendations below; no slice is approved to build yet.** Raised by Dean (2026-09-23): covered calls and PMCC "should look identical, one against a stock, the other against a LEAP." Two bugs from the review are logged separately (approved by Dean 2026-09-24): `PMCC-HELD-BREAKEVEN-0001` (slice A) and `PMCC-EARNINGS-PAST-0001` (slice B).

## The layout should be identical; the rules are not

Both scans now share one skeleton: the same modal shell, section order, tags, and receipt. What differs is what the engine does with the **short call**, and several differences look accidental.

| Rule (the short call) | Covered call | PMCC | Source |
|---|---|---|---|
| Delta | Hard limit; outside is never a candidate | Preference; outside is kept, with a warning (`NEW_SHORT_DELTA`) | `isEligibleCcLeg`; `pmccPairing.ts` (Ian's corrected position, PMCC-HEALTH-CHECK-0001) |
| Open interest | Advisory: warned, never excluded | Hard reject below the minimum (`OPEN_INTEREST_BELOW_MINIMUM`) | `buildCcSpreadCandidate`; `pmccPairing.ts` |
| Bid/ask | Absolute dollars per share (default $0.20) | Relative percent (5 acceptable, 10 qualifying) plus quote age and market session | `isEligibleCcLeg`; `pmccQuoteQuality.ts` |
| Strike floor | At or above stock price, and above cost basis when known | Strictly above the stock price, plus the pair check debit < width (`NET_DEBIT_NOT_BELOW_WIDTH`, switchable, new entry only; held-LEAP mode has no floor) | `findBestCoveredCall`; `SHORT_NOT_OTM`; `pmccPairing.ts:244-247` |
| Earnings | Excludes a call when earnings fall on or before its expiration (already-reported dates pass) | Warning (`EARNINGS_BEFORE_SHORT_EXPIRY`); also fires on past dates | `isEarningsSafeForDte`; `pmccDecision.ts:197` |
| IV rank | Not used | Context only | both |
| Near-misses | None retained | Qualified and near-miss pairs retained | `pmccPairing.ts` |
| Quantity | Share capacity (covered contracts) | The held LEAPS position | capacity vs. held-LEAPS discovery |

The last two rows are genuine (a stock position and a LEAP are different assets). The first five are the same short call with different policies.

## Team recommendations (2026-09-24)

| Rule | Recommendation (Ian) | Reason | Scope (Paul) | Math (Alan) |
|---|---|---|---|---|
| Delta | **Align: PMCC → hard filter.** Reverses Ian's PMCC-HEALTH-CHECK-0001 position | The trader set the delta window; a warning on an off-target short overrides their criteria | Last. F1: a visible PMCC short-delta scan control (Diane mock first). F2: flip the rule. Hold F2 until LEAPS-ADVISOR-0001B is built or re-scoped | OK. Makes `pmccStartPrice`'s delta-cap assumption true. Held mode can end up with zero shorts, so the empty-result banner must show |
| Open interest | **Align: PMCC → warning.** Missing OI still rejects | The LEAP covers the short the same way shares do, so OI-LIQUIDITY-CHOICE-0001 applies | Slice C, one liquidity ticket with bid/ask | OK. Side finding: CC shows missing OI as a "NaN" warning instead of rejecting |
| Bid/ask | **Align: CC → PMCC quote policy, with a one-tick floor**: reject if width > max($0.05, 10% of mid), warn if width > max($0.05, 5% of mid) | A fixed $0.20 passes 50% slippage on cheap calls and blocks 3% on expensive ones; pure % rejects one-tick markets under a $0.50 mid | Slice C. New field name; stop using the saved $0.20 and fall back to the new default. Diane if the control's label or unit changes | Hybrid formula verified. Fixtures: 0.28/0.33 → pass (hybrid), 5.75/6.25 → wide warning |
| Strike floor | **Keep different**; make debit < width non-switchable | Both mean "never sell below breakeven": cost basis for CC, LEAP strike + debit for PMCC | Slice E (toggle removal). Held-LEAP gap split out as `PMCC-HELD-BREAKEVEN-0001` | New-entry formula is the correct no-loss-at-assignment test. Held mode had none |
| Earnings | **Align: PMCC → hard per-candidate exclusion**, with the already-reported guard | Holding a short through earnings isn't premium selling, and a gap plus IV crush hurts a LEAP more | Slice D, after `PMCC-EARNINGS-PAST-0001`. The "no date on file" gap is out of scope | Compare ISO dates, `today ≤ earnings ≤ expiry`; don't reuse CC's day count (local vs UTC, off by one after 8pm ET) |

**Follow-up decisions (Ian, 2026-09-24):**

1. Bid/ask: the hybrid above.
2. Canonical PMCC breakeven: the pairing formula, `Ks > Kl + (long ask − short bid)`. Held mode: `Ks + shortBid > Kl + avgOpenPrice`, failing closed. `pmccStartPrice` stays a conservative estimate (no short credit), labelled as such; in held mode it should use `avgOpenPrice`.
3. After-hours CC: show the candidate as "not ready," the same as PMCC. It stays visible for planning, with no order action until the quote is live, fresh and within the spread limits.

## Second review: Alan, Diane, Ian (2026-09-24)

Alan aligned on all five rows (four with changes). Ian approved with changes. Diane found UI changes; mocks are in `SCAN-ALIGN-0001-mocks.md`. Recommendations only; nothing is approved to build.

**Changes to the rows above**

- **Delta:** Remove `role !== 'short'` (`pmccPairing.ts:162`); bounds inclusive. `NEW_SHORT_DELTA` becomes unreachable: remove it or mark it defensive. F1 ships before or with F2, never after.
- **Open interest:** Short leg only. A new LEAP keeps the hard OI reject (fill risk). Held longs skip the OI check entirely, including when chain OI is missing (line 164 currently rejects). Missing short OI still rejects. CC must reject null or non-finite OI (the "NaN" warning is a bug); OI of 0 is data and warns.
- **Bid/ask:** Hybrid reject `width > max($0.05, 10% of mid)`, warn `width > max($0.05, 5% of mid)`, with a **new absolute reject ceiling** (about $0.50–$0.75 per share, a scan control; Ian). No one-tick floor for mids under $0.10 (Ian). Compare in **integer cents** or round to 1e-6 (`0.33 − 0.28 = 0.05000000000000004` would reject the 0.28/0.33 fixture). Strict `>`; equality passes. Keep the `finitePositive` ordering so mid = 0 cannot occur; crossed quotes reject; locked markets pass. `spreadPct` stays display-only. The old $0.20 cap goes away; the ceiling replaces it. Applies to both legs. Penny-pilot names: a $0.10 mid with a $0.05 width passes reject but shows the wide warning.
- **Strike floor:** Removing the `requireDebitBelowWidth` toggle turns debit ≥ width from a near-miss into a hard reject (`pmccPairing.ts:246-248`), so near-miss counts and tests change. Remove the field from `validateCriteria` and saved settings; a saved `false` must not survive. Held mode fails closed when `avgOpenPrice` is null, non-finite or ≤ 0 (a zero basis from assignment or transfer would pass trivially). Multi-lot held LEAPs: quantity-weighted average only when all lots share strike and expiry and each has a valid basis; otherwise fail closed.
- **Earnings:** Exclusion is **removal from results** (like CC), not a DISQUALIFIED gate ("trust the qualified realm"). "Today" is the New York date derived from `asOf`, not UTC or `new Date()`. Normalize earnings to `YYYY-MM-DD`; malformed counts as no date. Earnings on the scan day are excluded even if reported pre-market (conservative). A missing date does not exclude but shows a "no earnings date on file" caution tag (follow-up, `EARNINGS-NO-DATE-0001`).
- **After-hours CC:** Shown as "not ready" with no order action. If the CC chain leg lacks quote timestamp, delayed flag or session inputs, fail closed to "not ready".

**Extra fixtures (Alan)**

- Bid/ask: 0.28/0.33 pass; 5.75/6.25 warn; 0.95/1.05 (exactly 10%) pass; 0.95/1.0501 reject; 0.30/0.30 locked; crossed; bid 0; $0.10 mid with $0.05 width; a $20 mid with a $2.00 width rejects at the ceiling.
- OI: short OI = min passes with no warning; min − 1 warns and stays eligible; null rejects on CC and PMCC; 0 warns; held long with null OI is not rejected.
- Debit: debit = width − 0.01 passes; = width rejects; saved toggle `false` still rejects. Held: equality rejects, +0.01 passes; `avgOpenPrice` null, 0 and NaN reject; a per-contract-scaled value (× 100) is caught by a unit guard.
- Earnings: `asOf 2026-10-02T01:00Z` (2026-10-01 21:00 ET) with earnings 2026-10-01 excluded; earnings = today excluded; = expiry excluded; expiry + 1 passes; today − 1 passes; DST-end date 2026-11-01; timestamp-suffixed value; null.
- Delta: |delta| = min and = max pass; negative delta via `abs`; null rejects.

**UI (Diane)**

Needs a mock before code: (1) PMCC short-delta control (F1). Diane's code check found the control already exists (`shortDeltaMin`/`shortDeltaMax`, "Min Δ"/"Max Δ", 0.10–0.40): F1 is preset chips, hint text, a receipt row, and removing the "Delta guides rank" note when F2 lands; (2) hybrid spread control with the new ceiling field, replacing the $0.20 field, plus a one-time dismissible migration note; (3) held-LEAP zero-shorts banner that names the binding filter (delta, OI, spread, breakeven, earnings, cost basis unavailable), with an "Adjust short delta" action. Copy-only, built from Diane's list after scope approval: PMCC OI "Thin OI" tag; debit toggle removed with an "always on" receipt row; PMCC earnings receipt row and rejected reason; after-hours CC reuses the PMCC "Not ready" chip; "Cost basis unavailable" caption; "Est. start price (excludes short credit)" label. Control names were checked against `PmccScanModal.tsx`, `ccRegistry.ts` and `pmccConfig.ts` (see the mocks file for differences).

**Open items**

1. Confirm `avgOpenPrice` units (per share) and whether it includes fees, against a real TastyTrade payload.
2. Confirm the 21-DTE stop, 50% profit exit and 2x credit stop apply to the short leg and that "not ready" logic does not imply otherwise (Ian).
3. Ceiling default ($0.50 or $0.75), Ian and Dean.
4. Follow-ups split out, not part of this ticket: `PMCC-HELD-LONG-FLAGGED-0001`, `PMCC-ASSIGNMENT-RISK-0001`, `EARNINGS-NO-DATE-0001`.

## Scope and build plan (Paul, 2026-09-24)

Recommendation only. Nothing is approved to build until the gates below clear.

| Slice | Verdict | Depends on | Needs before build |
|---|---|---|---|
| A: `PMCC-HELD-BREAKEVEN-0001` | In, first (P1) | none | Alan fixture sign-off; `avgOpenPrice` units against a real payload; reason-code placement |
| B: `PMCC-EARNINGS-PAST-0001` | In, first (P2) | none | Alan fixture sign-off. No UI |
| C: liquidity (OI warning, hybrid bid/ask, ceiling) | In, one ticket (split C1 engine / C2 control only if the PR is too big) | none | Ceiling default; Alan integer-cents pass; mock 2 approved |
| D: PMCC earnings removal | In, after B | B | Alan date fixtures; copy from Diane |
| E: debit toggle removal | In | A | Alan sign-off; Ian confirms held-mode rules match A; saved `false` must not survive |
| F1: PMCC delta control polish | In, late | none, but before or with F2 | Mock 1 approved |
| F2: delta rule flip | **Deferred** | F1; LEAPS-ADVISOR-0001B built or re-scoped | Mock 3; Dean accepts the reversal |
| `PMCC-HELD-LONG-FLAGGED-0001` | Deferred; approve after F1 (shares mock 3) | mock 3 | none beyond mock |
| `PMCC-ASSIGNMENT-RISK-0001` | Split: expiry-gap check is a read-only investigation, can go now; ex-dividend deferred | ex-dividend data source | Dean: data source |
| `EARNINGS-NO-DATE-0001` | Deferred, out of SCAN-ALIGN; small standalone ticket after D | D | Diane tag copy |

**Build order:** A and B in parallel, then C, D, E, F1. F2 held. If F2 is still held at PMCC registry migration, the registry records delta as a deliberate difference (CC hard, PMCC preference).

**PRs:** PR1 A; PR2 B (may travel with A as two commits); PR3 C; PR4 D (with E if small); PR5 F1; later F2, then the flagged-long ticket. Do not bundle engine flips; each needs its own revertable test flip.

**Can start without mocks:** A engine, B, C engine (after the ceiling default), D and E engine logic. After-hours CC "not ready" rides with C as a display state only.

**Other gaps:** Quinn has not reviewed the test-flip plan for C, D and E. Ian's open item 2 (management rules and "not ready") must be answered before the "not ready" chip ships.

**Out of scope:** roll or exit recommendations, ex-dividend on covered calls, a missing earnings date as hard exclusion, `pmccStartPrice` changes beyond the label and held-mode input, Autopilot extension to PMCC/CC.

**Decisions only Dean can make:** accepting the delta reversal (F2) and its timing; the ex-dividend data source; the ceiling default (Paul recommends $0.50); accepting that saved $0.20 spread values are dropped for the new default.

**Order:** A (`PMCC-HELD-BREAKEVEN-0001`) and B (`PMCC-EARNINGS-PAST-0001`) → C (liquidity) → D (earnings) → E (debit toggle) → F1 (delta control) → F2 (delta rule). A through E land before the PMCC registry migration; F lands before it too, or the registry records delta as a deliberate difference.

**Other findings:** `LONG_NOT_ITM` and `INVALID_EXTRINSIC` (`pmccPairing.ts:167,183`) still apply to held longs, so a held LEAP that has gone OTM drops out of held review with no warning. The comment at `covered-call-finder.ts:405` says the opposite of what the code does (the code excludes a candidate when earnings fall on or before its expiry). Neither open PMCC branch (`feature/pmcc-leaps-ranked-finders`, `wip/pmcc-decision-card`) touches the affected rule files.

## After the decisions

Each accepted change is a small policy ticket with its own test flip, made before the PMCC migration so the PMCC registry starts from a consistent set of rules. Where a difference is deliberate, the registry keeps it and the tags show it.
