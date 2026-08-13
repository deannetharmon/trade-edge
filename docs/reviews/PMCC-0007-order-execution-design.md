# PMCC-0007: PMCC Order Execution — Design

**From:** Alan (Architecture), grounded directly in code, not assumption
**Reviewed by:** Paul, Ian, Quinn (fork resolution, see §1)
**Status:** Ready for implementation ticket

---

## 1. Context: a design fork was found and resolved

While scoping this, a prior design package was found in the repo: `docs/design/PMCC-0001-Pre-Dane-Design-Architecture-Package.md` (dated 2026-08-09, four days before this week's `PMCC-0003`–`0006` work started). It scoped PMCC far more rigorously — entering through canonical `AutopilotStrategy`/`DecisionAction`/decision-engine contracts, with broker execution gated behind a staged safety process (execution-time revalidation, a "Shadow Validation" phase) several tickets out.

**This week's shipped work (`PmccLink`, Position-linking, scoped to `app/portfolio/page.tsx`) never touched that architecture.** Two parallel, non-communicating PMCC concepts now exist in the codebase.

**Resolution (team discussion, Paul/Ian/Quinn/Alan):** extend the lightweight, already-shipped path, not the canonical architecture. Reasoning:
- The canonical path solves a different, currently-hypothetical problem (automated PMCC scanning/ranking through Autopilot) — not "let me submit the order I already decided on."
- The safety concern the older plan cared about (execution-time revalidation before a broker write) is **already satisfied** by the existing `TradeModal` flow used for BPS/BCS/IC today: build order → dry-run against TastyTrade's own dry-run endpoint (real broker-side price/margin/buying-power revalidation) → explicit confirm → submit. Extending this pattern to PMCC inherits that safety, doesn't skip it.
- Reviving the canonical architecture would delay real order submission by multiple unrelated tickets to build a foundation Dean didn't ask for.

This doc does not delete or invalidate PMCC-0001 — it documents the fork so the next person doesn't rediscover it blind, and defers the canonical-architecture question to whenever automated PMCC recommendations become a real, concrete need.

**Clarification (Quinn, verified in code before this ticket was finalized):** this is not two competing implementations needing reconciliation. `PMCC-0002A` — the canonical foundation work PMCC-0001 recommended as its actual first step — was never built. `AutopilotStrategy` still has no `'PMCC'` member. The only trace of that plan in real code is a single, deliberate, well-written exclusion guard in `lib/autopilot/decision/screenerCandidateAdapter.ts` that already correctly stops Autopilot from silently mishandling PMCC results. Nothing conflicts or duplicates; there's one shipped system (this ticket extends it) and one unbuilt plan (documented as superseded, not merged or deleted).

## 2. What's missing — confirmed directly in code

`buildOrderLegs` (`app/screener/page.tsx`) has explicit branches for `BPS`, `BCS`, `IC`. **No `PMCC` branch exists.** If the order-UI gate (`hasOccSymbols`) were simply flipped on for PMCC candidates today, the payload would come back with zero legs — this is unbuilt, not disabled.

Three concrete gaps:

1. **Multi-expiration legs.** BPS/BCS/IC all assume every leg shares one expiration. A PMCC's LEAP and short call are on different expirations by construction. TastyTrade's complex-order API supports this (confirmed empirically — Dean successfully built this manually via the option chain earlier this week, submitted as one net-debit combo order); nothing in `buildOrderLegs` currently constructs it.
2. **Credit vs. debit.** `buildOrderPayload`'s shared payload builder hardcodes `'price-effect': 'Credit'`. A PMCC is a net **debit** trade. `TradeModal`'s UI (entry limit framed as "credit," GTC/stop framed as % of *credit received*) is credit-language throughout and doesn't translate to a debit structure.
3. **The OTOCO entry pattern is wrong for PMCC.** `buildOtocoPayload` is the *only* entry pattern in the codebase — it brackets the entire spread with one auto-triggered GTC/stop that closes every leg together. Correct for BPS/BCS/IC. **Actively wrong for PMCC**: it would auto-close the LEAP (the long-term profit engine) every time the short call alone hits a target or stop, defeating the strategy's actual mechanics (LEAP held long-term, short call rolled independently every 30-45 days — see the original Ian/Dean discussion this ticket traces back to).

## 3. Design

### 3.1 Multi-expiration leg builder
Add a `PMCC` branch to `buildOrderLegs`:
```ts
} else if (c.strategy === 'PMCC') {
  legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbolPMCC!, quantity: 1, action: 'Buy to Open' });
  legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbolPMCC!, quantity: 1, action: 'Sell to Open' });
}
```
Uses the PMCC-specific OCC symbol fields already computed by `findBestPMCC` (`longOccSymbolPMCC`/`shortOccSymbolPMCC`) — these already exist on `SpreadCandidate`, confirmed in `lib/scans/types.ts`. No new candidate-side work needed.

Update `hasOccSymbols` to accept the PMCC-specific field pair instead of requiring the generic `shortOccSymbol`/`longOccSymbol` fields PMCC candidates don't carry.

### 3.2 Debit-aware entry order
- `buildOrderPayload`: add a debit branch for `c.strategy === 'PMCC'` — `'price-effect': 'Debit'`, price = net debit (long cost − short credit), not the credit-framed calculation the shared function currently does.
- `TradeModal`: PMCC-specific copy/framing — "net debit paid" instead of "credit received," matching what `TradeModal`'s PMCC structure summary (§ already rendered at line ~4086 for PMCC candidates) already displays correctly for read-only preview. The order-confirmation step needs equivalent framing, not the credit-percentage math used elsewhere in the same modal.

### 3.3 Entry order shape — no OTOCO bracket
- The PMCC entry submits as a **plain multi-leg order** (LEAP + short call, both opening), not wrapped in `buildOtocoPayload`'s OTOCO structure. No auto-attached GTC/stop on the whole structure at entry.
- **Optional**, separately: after the entry fills, the trader can attach a GTC to the **short leg alone**, reusing the existing single-leg GTC mechanism `SetStopLossButton` already provides for any standalone short call in the Portfolio page — not new code, just applies to a PMCC's short leg the same way it already applies to any other short call position.
- This keeps PMCC-0003's linking flow as the natural next step after entry: place the entry order here, then link the two resulting positions in PMCC Manager, exactly as already built.

### 3.4 Safety — reused, not rebuilt
Same `runDryRun` → confirm → `placeOrder` sequence already live for BPS/BCS/IC. No new revalidation layer. The existing dry-run call to TastyTrade's own endpoint already surfaces price/margin/buying-power issues before the trader can confirm.

## 4. Threshold governance note

No new numeric policy thresholds are introduced by this ticket — order construction and pricing are mechanical (broker-quoted prices, computed net debit), not policy judgments. If a future PMCC ticket does introduce a numeric default (entry delta target, DTE window, etc.), it should be flagged as unvalidated per Ian's methodology-governance framework in PMCC-0001, the same retroactive discipline now being applied to `LEAP_DECAY_DTE_THRESHOLD`.

## 5. Explicitly out of scope
- Canonical `AutopilotStrategy`/`DecisionAction` integration (§1).
- Automated PMCC candidate scanning/ranking changes — screener-side candidate-finding is unchanged, already works.
- Any change to `PmccLink`/PMCC-0003–0006's linking, roll-recording, or dry-run fixture logic — this ticket only adds the ability to place the *entry* order; everything after entry (linking, rolls, decay monitoring) is unchanged.
- Automated/unattended order submission of any kind.

## 6. Definition of Done
- `tsc --noEmit` clean, full Vitest suite passing, zero regressions.
- **Real `npm run build`**, not just `tsc` — per the process fix from the earlier Vercel build failure this week, `tsc` alone does not catch every class of error.
- New tests: `buildOrderLegs`'s PMCC branch produces correct legs for a fixture candidate; debit-vs-credit payload branch selection; `hasOccSymbols` correctly gates on PMCC-specific fields.
- **Regression test confirming the existing Autopilot exclusion guard in `lib/autopilot/decision/screenerCandidateAdapter.ts` still fires for PMCC results after this ticket ships.** This ticket does not touch Autopilot — PMCC still has no `AutopilotStrategy` representation, and that guard must keep working exactly as it does today so a future, unrelated PMCC change can't silently remove it (Quinn's finding — verified during PMCC-0007 review that no PMCC-0001-era canonical code was ever actually built; this guard is the only real trace of that plan in the codebase and needs an explicit test, not just informal confidence it still works).
- **Mark `docs/design/PMCC-0001-Pre-Dane-Design-Architecture-Package.md` as superseded** — short header pointing to this ticket as the actual path taken, same pattern already used for the stale `SQ-0001A` checkpoint doc, so nobody finds it later and assumes it's still live guidance.
- Manual check: place a real (or dry-run) PMCC entry order through Screener, confirm it does NOT auto-attach an OTOCO bracket, confirm the resulting two positions can be linked via the existing PMCC Manager exactly as before.
- Implementation report notes the PMCC-0001 fork explicitly, so it's discoverable by anyone who finds that doc later.
