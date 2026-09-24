# Mock 3b: extended held-LEAP mock (Diane, 2026-09-24)

**Approved 2026-09-24 by Ian, Paul and Dean** (Ian and Paul "approve with changes", all changes applied below; Dean accepted Paul's recommendations on the build path, PR1 timing and the two scope drops). Dane's pre-build checks (tile names, pre-modal surface, engine funnel order, per-card versus shared refresh) still apply before code. Extends Mock 3 in `SCAN-ALIGN-0001-mocks.md` for `PMCC-HELD-BREAKEVEN-0001B`. Uses the real scan theme: `ScanModalShell` with the amber accent, `amber-500/10` banner fill and border, amber caption tags. Tile names are still Mock 3's proposal; Dane verifies them against the real results component first. Diane read only Mock 3 and the 0001B ticket.

## Ruling recap (Dean, 2026-09-24)

- **Fixable read failure of cost basis** (null, zero, unparseable, unit-suspect): blocks before the modal with an error and a `Refresh Portfolio` action.
- **Multi-lot and floor-not-met** open the modal with an in-modal banner and caption.
- **Results are per LEAP.** One LEAP's failure never stops another LEAP's results.
- **Pre-modal block** only when every selected LEAP has a fixable read failure.

## Simpler build: Diane's note (Dean decides, open question 10)

**Simplicity note:** building the in-modal caption card for all causes first is the simpler build (the ticket's fallback); **Paul recommends the all-fail pre-modal wrapper ships in the same PR, and Dean decides (Q10).** One render path: a pure selector maps reason code and detail to caption, banner, action and funnel visibility; every LEAP renders a card; per-LEAP independence comes free. The "block only if every selected LEAP has a fixable failure" gate needs a second, run-time-derived pre-modal gate and is strictly additive (a thin wrapper: `every(isFixableReadFailure)` over the selector output).

Dean's ruling makes the pre-modal block the required behavior for the all-fail case, and CLAUDE.md says technical failures block before a modal, so the fallback is a stepping stone, not the end state. **If the wrapper does not land in the first PR, Dean must explicitly accept in-modal-only as a temporary deviation.** With one selected LEAP, "every LEAP fails" is true, so a fixable failure blocks pre-modal; this is Dean's real usage today (UBER and NFLX, one contract each).

## (a) The three states

Common: the LEAP tiles stay (Strike, Delta, DTE, Avg open, Mark, Since open, Extrinsic). Hidden: Net debit, Combined breakeven, Short credit, Max profit. In the two not-checked states no funnel renders and the copy never says "no short calls found".

### State 1: cost basis unavailable (includes unit-suspect)

Reason `COST_BASIS_UNAVAILABLE`. In-modal unless every selected LEAP has a fixable failure; when it is the only or every selected LEAP it blocks before the modal (see f).

```
 UBER 2027-01 $60 Call (held)                 [ Cost basis unavailable ]
+----------------------------------------------------------------+
| ! Short calls were not checked. Cost basis for UBER could not  |
|   be read from your broker.                                    |
|   [Refresh Portfolio]      [Show details v]                    |
+----------------------------------------------------------------+
 LEAP     Strike   Delta   DTE   Avg open   Mark    Since open   Extrinsic
 tiles    $60      0.82    132   —          $19.85  —            $0.90
 [Show details v]  (collapsed)
   Reason: COST_BASIS_UNAVAILABLE. Detail: cost basis unavailable.
   Avg open price missing or unusable.
```

- Caption: `Cost basis unavailable`.
- Banner: `Short calls were not checked. Cost basis for {symbol} could not be read from your broker.`
- Action: `Refresh Portfolio`. Re-reads positions and re-runs the check for that LEAP; does not close the modal.
- Detail: `Reason: COST_BASIS_UNAVAILABLE. Detail: cost basis unavailable. Avg open price missing or unusable.`
- Since open tile also `—`, because it depends on cost basis (Diane's addition; Dane and Paul confirm).
- **Unit-suspect variant:** detail `cost basis unit suspect`. Same caption; banner (Ian): `Short calls were not checked. Cost basis for {symbol} looks wrong or could not be read from your broker.` Detail line: `Reason: COST_BASIS_UNAVAILABLE. Detail: cost basis unit suspect. Avg open price looks mis-scaled.` The "looks mis-scaled" sentence appears only here.
- **Held quantity invalid:** detail `held quantity invalid` (missing, zero, non-integer or non-numeric quantity). Same card and action, treated as fixable. Detail line: `Reason: COST_BASIS_UNAVAILABLE. Detail: held quantity invalid. Contract count missing or unusable.` The last sentence is new copy. **Ian and Dane confirm the routing.**

### State 2: multi-lot (quantity != 1)

Reason `COST_BASIS_UNAVAILABLE`, detail `multi-lot LEAP: cost averaging unverified`. A verified result, so it opens the modal.

```
 NFLX 2027-01 $900 Call (held)             [ Multi-lot LEAP: cost unverified ]
+----------------------------------------------------------------+
| ! Short calls were not checked. This LEAP has 3 contracts, and |
|   cost averaging across lots is unverified.                    |
|   [Show details v]                                             |
+----------------------------------------------------------------+
 LEAP     Strike   Delta   DTE   Avg open   Mark     Since open  Extrinsic
 tiles    $900     0.79    140   —          $212.00  —           $14.20
 [Show details v]  (collapsed)
   Reason: COST_BASIS_UNAVAILABLE.
   Detail: multi-lot LEAP: cost averaging unverified.
```

- Caption: `Multi-lot LEAP: cost unverified`. Banner: `Short calls were not checked. This LEAP has {qty} contracts, and cost averaging across lots is unverified.`
- Action: none (fixed rule; refreshing does not change the outcome). `{qty}` comes from the engine result.

### State 3: floor not met (every short fails)

Reason `SHORT_NOT_ABOVE_HELD_BREAKEVEN`. A verified empty result, so the funnel renders.

```
 UBER 2027-01 $60 Call (held)         [ Floor $78.40 (LEAP strike + cost) ]
+----------------------------------------------------------------+
| ! No short calls cleared the floor. A short must satisfy       |
|   strike + bid > LEAP strike + your cost:                      |
|   $60.00 + $18.40 = $78.40.                                    |
|   [Show full breakdown v]                                      |
+----------------------------------------------------------------+
 LEAP     Strike   Delta   DTE   Avg open   Mark    Since open   Extrinsic
 tiles    $60      0.82    132   $18.40     $19.85  ▲ +$1.45     $0.90
 [Show full breakdown v]  (collapsed)
   Considered 96 short calls in 21–45 DTE
   96 -> 88  spread    (8 over 10% of mid / $0.60)
   88 -> 71  open interest (17 under 100)
   71 ->  0  floor     (strike + bid at or below LEAP strike + cost, $78.40)   <- binding
   Reason: SHORT_NOT_ABOVE_HELD_BREAKEVEN
```

- Caption (shorthand, stays): `Floor {floor} (LEAP strike + cost basis)`. **Banner (Ian, 2026-09-24):** `No short calls cleared the floor. A short must satisfy strike + bid > LEAP strike + your cost: {Kl} + {avgOpen} = ${floor}.` The engine compares Ks + short bid, not the strike alone (a $78 strike with a $0.35 bid is rejected; a $78.50 strike with a $0.05 bid passes), so the banner states what is compared. No action (fixed rule). Wording is consistent: the rule says "must be above", the rejection says "at or below".
- Funnel row (Ian): `N -> 0 floor (strike + bid at or below LEAP strike + cost, ${floor})`, then the reason code. Kl, avgOpen and floor come from the engine result, not recomputed in the UI.
- Funnel order: floor after spread and open interest, before delta, as in Mock 3's breakeven row. Alan or Dane confirms the engine order (Mock 3 open question 2).
- If delta is the binding filter, Mock 3's delta banner wins.

## (b) Avg open tile

`—` for cost-basis unavailable (all variants) and multi-lot; never `$0.00`. The Since open tile also shows `—` (Ian and Paul: never show a value derived from a basis we do not trust). Floor-not-met keeps the real value. **No tooltips** (Paul: out of scope; the banner and collapsed detail already explain the state).

## (c) Three LEAPs held: ok, cost-unavailable, multi-lot

```
PMCC RESULTS · 3 held LEAPs · 1 with results · 2 not checked        [x]
+----------------------------------------------------------------+
| UBER 2027-01 $60 Call (held)                        [ OK ]      |
|  LEAP tiles: $60  0.82  132  $18.40  $19.85  ▲ +$1.45  $0.90    |
|  Floor $78.40 (LEAP strike + cost basis)                        |
|  RESULTS: 14 ranked short calls  (rank 1 ...)                   |
+----------------------------------------------------------------+
+----------------------------------------------------------------+
| NFLX 2027-01 $900 Call (held)   [ Cost basis unavailable ]      |
| ! Short calls were not checked. Cost basis for NFLX could not   |
|   be read from your broker.                                     |
|   [Refresh Portfolio]      [Show details v]                     |
|  LEAP tiles: $900  0.79  140  —  $212.00  —  $14.20             |
+----------------------------------------------------------------+
+----------------------------------------------------------------+
| AAPL 2027-01 $150 Call (held)  [ Multi-lot LEAP: cost unverified ]|
| ! Short calls were not checked. This LEAP has 3 contracts, and  |
|   cost averaging across lots is unverified.                     |
|  LEAP tiles: $150  0.84  140  —  $98.00  —  $6.40               |
+----------------------------------------------------------------+
```

- Each LEAP is its own card; the ok LEAP's results render fully and are never hidden or shifted by the others.
- **Card order (Paul):** results first, then floor-not-met (verified empty), then not-checked; selection order within each group (stable sort); no re-sort on Refresh Portfolio, so a card never jumps under the cursor (re-sort only on the next open).
- **Header line (Paul):** `{n} held LEAPs · {a} with results · {b} not checked` (ambient; "LEAPs", not "LEAPS"). Omit a segment when its count is 0, so an all-ok set shows just `3 held LEAPs`. A floor-not-met LEAP is verified and checked, so it is in neither segment; include `· {c} no shorts cleared` so the counts sum to n (selector spec states this).
- `Refresh Portfolio` must call the same portfolio refresh path as the existing action, not a new one, and must not reorder or lose ok cards' results. Per-card re-run is a nice-to-have; if not cheap, use one shared refresh that re-runs the whole set (a Dane build decision).
- All three fixable: block pre-modal (f). Two fixable and one multi-lot: the modal opens (the multi-lot LEAP is a verified result) with two error cards and the multi-lot card. Floor-not-met on one LEAP never affects another.

## (d) Rejected, not near-miss (Ian's condition)

Floor-failed, unit-suspect and multi-lot pairs exist in `nearMissPairs` as data. The held UI must not treat them as near-misses.

```
 REJECTED (not eligible to trade)
 +--------------------------------------------------------------+
 | UBER $60 / short Jan 2027 $78 Call        [ Rejected ]        |
 |   SHORT_NOT_ABOVE_HELD_BREAKEVEN                              |
 |   Ks $78.00 + bid $0.35 = $78.35 is not above floor $78.40    |
 +--------------------------------------------------------------+
```

- **Scope (Paul):** IN only as the minimal collapsed, inert list inside `Show full breakdown`, built from data already in `nearMissPairs`, no new engine output. If Dane finds it needs new engine data or a new component, it is OUT and becomes a separate ticket. The non-negotiable part is "not styled as a near-miss, with no order affordance".
- Neutral grey `Rejected` tag (`border-neutral-700`) with the reason code beside it; not amber. Not shown: "near miss" or "so close" wording, gradients, rank number, score bar, green. No order affordance (no Place order, Promote, Use this pair, hover-to-select). Rows are inert: no checkbox, no click-through.
- Collapsed by default and **capped (first 20 plus a count)** so 96 rejected rows do not dominate (Ian). Heading `Rejected pairs`. **Never sorted by margin below the floor** (that is a ranking); no other sort rule is specified.
- **Only floor-failed pairs render here.** In the two not-checked states (cost unavailable, multi-lot) no per-short rows render at all: there is nothing verified to reject, and those cards show one detail line (Ian).
- Per row: short strike, short bid, reason code. Floor-failed rows show the Ks + bid vs Kl + cost line (e).
- Tests (Quinn): no near-miss class, rank or order button within rejected rows. **The real risk is not the mock (Ian):** floor-failed pairs land in `nearMissPairs` and `serverTradeReview.ts:333` uses `qualified[0] ?? nearMiss[0]`, so tests must prove a floor-failed held pair can never become the best pair or reach an order path (the A ticket's W2 floor-failed case).

## (e) Rename: Mock 3 `Breakeven` to `Floor`

- Funnel row (Ian): `71 -> 14  floor (57 with strike + bid at or below LEAP strike + your cost)` (Mock 3's delta-bound example; in the floor-not-met state it is `71 -> 0`).
- Banner table row `Breakeven` becomes `Floor`: `Floor removed the last {n}. Each short's strike + bid is at or below your floor of ${floor} (LEAP strike + cost basis).` Info only, no action.
- Per-share statement, shown once on the floor detail: `Floor: Ks + short bid  vs  Kl + cost basis  (per share)`; example `$78.00 + $0.35 = $78.35   vs   $60.00 + $18.40 = $78.40`, `78.35 is not above 78.40`. **Ian (2026-09-24): approved; strict is correct, equality rejects; "at or below" for the rejection and "must be above" for the rule, used consistently.** Diane followed the `SHORT_NOT_ABOVE_HELD_BREAKEVEN` semantics (a short passes only if above the floor).
- The word "Breakeven" does not appear in the held-LEAP UI. The engine's `Combined breakeven` tile is a separate metric on new-entry results and is not renamed.

## (f) Pre-modal error state (fixable read failures)

Shown before the modal opens, when every selected LEAP has a fixable read failure, in the app's existing pre-modal error surface (Dane confirms which, presumably a toast or inline error near the Run button).

```
+----------------------------------------------------------------+
| x  Could not read cost basis                                   |
|    Cost basis for UBER could not be read from your broker.     |
|    Refresh Portfolio and try again.                            |
|                                       [Refresh Portfolio]      |
+----------------------------------------------------------------+
```

- Single LEAP: title `Could not read cost basis`; body `Cost basis for {symbol} could not be read from your broker. Refresh Portfolio and try again.` (Mock 3's sentence, unchanged).
- Several LEAPs, all fixable: `Cost basis for {n} held LEAPs could not be read from your broker: {SYM1}, {SYM2}. Refresh Portfolio and try again.` Cap the symbol list at 3, then `+{k} more` (Paul; Dane implements it in the selector). The title stays `Could not read cost basis` for one or several.
- Action `Refresh Portfolio` refreshes, then re-attempts opening the results modal once; if it fails again the error stays; no auto-retry loop.
- Red error styling (a real technical failure), not a banner or modal, and it does not open scan results. No "no short calls" wording and no funnel.
- Unit-suspect uses the same pre-modal error, with the body `Cost basis for {symbol} looks wrong or could not be read from your broker. Refresh Portfolio and try again.` (matches the in-modal banner; Ian); detail shown collapsed: `Details: COST_BASIS_UNAVAILABLE, cost basis unit suspect`.
- Multi-lot and floor-not-met never take this path.

## (g) Three-tier visual weight

| State | Decision (heaviest) | Risk-context | Ambient (lightest) |
|---|---|---|---|
| Cost basis unavailable (in-modal card) | Banner headline and `Refresh Portfolio` | Amber caption tag; em dash tiles | Collapsed detail |
| Cost basis unavailable (pre-modal) | Error title and `Refresh Portfolio` | Body sentence | Collapsed `Details:` line |
| Multi-lot | Banner headline (no action) | Amber caption tag; em dash Avg open | Collapsed detail; `Rejected pairs` |
| Floor not met | Banner headline with Kl + avgOpen = floor | Amber caption `Floor $x`; LEAP tiles | Collapsed funnel; `Rejected pairs`; Ks + bid line |
| Ok LEAP (in a multi set) | Ranked short-call results | Caption `Floor $x` | Card header count line |

An action button appears only where there is something to do; states with no action get no fake button. Multi-lot has no decision for the trader, so it stays a plain amber banner and must not out-weigh an ok LEAP's results in a mixed view. Rejected rows are ambient: grey, collapsed, no affordance.

## (h) Unchanged from Mock 3, and what remains open

**Unchanged:** the delta-bound zero-shorts banner and its `Adjust short delta` action; the binding-filter rows for delta, open interest, spread and earnings; the binding rule; which LEAP tiles stay or hide; the flagged OTM LEAP card (separate item per the 0001B non-goals); tier assignment for the delta banner.

**Changed:** `Breakeven` becomes `Floor`; Mock 3's "Cost basis unavailable is a technical failure and blocks before the modal" is refined to "a fixable read failure blocks before the modal only when every selected LEAP has one"; multi-lot is always in-modal.

**Mock 3 open questions still open:** 1 (flagged LEAP selectable? recommendation no); 2 (funnel counts need a per-filter drop list from the engine, now covering the floor row; Alan or Dane check); 3 (show `LEAP now OTM` always? recommendation always). Question 4 (breakeven row depends on slice A landing) is resolved in name (`Floor`) but still depends on slice A.

**New open questions from Mock 3b**

5. Should rejected pairs appear when nothing qualified? **Resolved (Ian, Paul): yes, minimal collapsed inert list, capped at 20, floor-failed pairs only; OUT if it needs new engine data.**
6. Order of LEAP cards in a multi set. **Resolved (Paul):** results, then floor-not-met, then not-checked; stable within groups.
7. Does `held quantity invalid` route as a fixable read failure (pre-modal) or in-modal? **Resolved (Ian, Paul): fixable, pre-modal when every selected LEAP has one; one-retry rule so a refresh cannot loop; precedence per A32 (basis validity, then quantity; qty > 1 is multi-lot, in-modal).**
8. Does the Since open tile show `—` when cost basis is unavailable? **Resolved (Ian, Paul): yes.**
9. Where exactly the pre-modal error renders (existing pre-modal surface): Dane checks.
10. Build path. **DECIDED (Dean, 2026-09-24): the all-fail pre-modal wrapper ships in the same PR as the cards** (Paul's recommendation accepted; no deviation). Paul recommended the all-fail pre-modal wrapper ships in the same PR as the cards** (it is small: `every(isFixableReadFailure)` over the selector output, the pre-modal error, and refresh-then-reopen-once). **Dean decides.** A split (in-modal-only first) needs Dean's explicit written acceptance on the ticket of: (i) fixable failures on a single-LEAP scan open the modal with an error card instead of blocking before it, a departure from his 2026-09-24 ruling and the CLAUDE.md principle; (ii) the wrapper is a named follow-on ticket with an owner and a merge-by date; (iii) the deviation applies only to the all-fail case; (iv) it ships to production, since main is production.

## Review outcomes (2026-09-24)

- **Ian: approve with changes, applied.** Approved the floor arithmetic wording, strict semantics, "Short calls were not checked" for every multi-lot path (condition: the quantity guard runs before any floor evaluation at all three held entry points, and the banner `{qty}` is an integer from the engine result, never a parsed string), `held quantity invalid` as fixable, the multi-lot caption, and his rejected-not-near-miss condition. Changes: banner and funnel state "strike + bid"; unit-suspect banner wording; rejected list capped and absent in not-checked states.
- **Paul: approve with changes, applied.** Tooltips dropped; rejected pairs minimal; card order and header counts; `+{k} more` cap; open questions 6 and 10 resolved as above. His sign-off is not yet given: the merge-hold condition on PR1 is not met until the edits are made and he re-confirms, then Ian, Paul and Dean approve.
- **Ian's final look (2026-09-24): approved** after two edits (State 3 mock box and the unit-suspect pre-modal body), applied.
- **Paul's re-confirmation (2026-09-24):** scope and Ian's floor rule confirmed; his six Mock 3b and four 0001B stale-text edits are applied, and he confirms the PR1 merge-hold is not met until Ian, Paul and Dean approve.
- **Dean (2026-09-24): accepted all** (same-PR wrapper; PR1 merges only once Dane has a committed start on 0001B, interim exposure acknowledged; tooltips out; rejected list minimal; Mock 3b approved).
- **Remaining before code:** Dean's final approval and his build-path decision (open question 10); Dane's checks (tile names, pre-modal surface, engine funnel order, per-card versus shared refresh).

## Copy that needs sign-off

- **Ian:** signed off on the copy (2026-09-24) except as listed in "Review outcomes"; the banner is the approved wording above.
- **Paul:** the multi-LEAP pre-modal copy and the header line.
- **Dean:** final approver.
