// lib/portfolio/positionMetrics.ts
//
// PM-0001: Portfolio Position Metrics correctness ticket. Pure,
// framework-free calculation helpers for position-card metrics -- no fetch,
// no localStorage, no React. Extracted from lib/portfolio-data/
// acquisition.ts's loadPositions() closure (where calcPositionPop and its
// helpers previously lived as unexported inline functions, untestable
// without exercising the entire live TastyTrade acquisition pipeline) so
// each formula can be unit-tested directly. Mirrors lib/portfolio/
// stopLossPolicy.ts's module contract.
//
// This ticket is calculation repair, not a UI redesign: every function here
// either fixes a unit-mismatch defect (POP's per-share-vs-per-contract
// credit, IC breakevens' credit-halving) or replaces a "fabricate 0 for a
// missing quote" pattern with an honest `null`. TE-0002's stop-loss policy
// module and ES-0001's close-order safety module are untouched and are not
// imported here.

// ── Contract economics ─────────────────────────────────────────────────────

// Shares per standard equity/index option contract. Isolated as an explicit
// constant rather than a magic `100` scattered across call sites -- if a
// future instrument type uses a different multiplier, callers pass it
// explicitly instead of this default.
export const CONTRACT_MULTIPLIER = 100;

export interface EntryEconomicsLike {
  entryEconomicsComplete?: boolean;
  entryCredit?: number | null;
  creditReceived: number;
}

export function hasCompleteEntryEconomics(position: EntryEconomicsLike): boolean {
  return position.entryEconomicsComplete !== false
    && Number.isFinite(position.entryCredit ?? position.creditReceived)
    && (position.entryCredit ?? position.creditReceived) >= 0;
}

export function canonicalEntryCredit(position: EntryEconomicsLike): number | null {
  if (!hasCompleteEntryEconomics(position)) return null;
  const credit = position.entryCredit ?? position.creditReceived;
  return Number.isFinite(credit) ? credit : null;
}

export function entryPnlPct(position: EntryEconomicsLike & { pnl?: number | null }): number | null {
  const credit = canonicalEntryCredit(position);
  return credit != null && credit > 0 && position.pnl != null && Number.isFinite(position.pnl)
    ? (position.pnl / credit) * 100
    : null;
}

export function parseBrokerEntryPremium(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') return null;
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function toWholePositionThetaDollars(rawTheta: number | null): number | null {
  return rawTheta == null || !Number.isFinite(rawTheta) ? null : rawTheta * CONTRACT_MULTIPLIER;
}

export function toWholePositionDeltaShares(rawDelta: number | null): number | null {
  return rawDelta == null || !Number.isFinite(rawDelta) ? null : rawDelta * CONTRACT_MULTIPLIER;
}

export function toWholePositionGammaShareEquivalent(rawGamma: number | null): number | null {
  return rawGamma == null || !Number.isFinite(rawGamma) ? null : rawGamma * CONTRACT_MULTIPLIER;
}

export function toWholePositionVegaDollars(rawVega: number | null): number | null {
  return rawVega == null || !Number.isFinite(rawVega) ? null : rawVega * CONTRACT_MULTIPLIER;
}

export interface BrokerGreekLeg {
  symbol?: string | null;
  quantity?: string | number | null;
  'quantity-direction'?: string | null;
}

export function aggregateBrokerPositionGreeks(
  legs: BrokerGreekLeg[],
  maps: { theta: Readonly<Record<string, number>>; gamma: Readonly<Record<string, number>>; delta: Readonly<Record<string, number>>; vega: Readonly<Record<string, number>> },
) {
  const normalizedLegs = legs.map((leg) => ({
    symbol: leg.symbol?.replace(/\s+/g, '') ?? '',
    quantity: Number(leg.quantity),
    direction: leg['quantity-direction'],
  }));
  if (normalizedLegs.length === 0 || normalizedLegs.some(leg =>
    !leg.symbol || !Number.isInteger(leg.quantity) || leg.quantity <= 0
    || (leg.direction !== 'Short' && leg.direction !== 'Long')
  )) return { theta: null, gamma: null, delta: null, vega: null };

  const sum = (map: Readonly<Record<string, number>>, shortSign: number, longSign: number, absolute: boolean): number | null => {
    let total = 0;
    for (const leg of normalizedLegs) {
      const value = map[leg.symbol];
      if (!Number.isFinite(value)) return null;
      total += (leg.direction === 'Short' ? shortSign : longSign) * (absolute ? Math.abs(value) : value) * leg.quantity;
    }
    return Number(total.toFixed(4));
  };
  return {
    theta: sum(maps.theta, 1, -1, true),
    gamma: sum(maps.gamma, -1, 1, true),
    delta: sum(maps.delta, -1, 1, false),
    vega: sum(maps.vega, -1, 1, true),
  };
}

export function computeCspEffectiveBuyPrice(strike: number | null, perShareEntryPremium: number | null): number | null {
  if (
    strike == null || perShareEntryPremium == null ||
    !Number.isFinite(strike) || !Number.isFinite(perShareEntryPremium) ||
    strike <= 0 || perShareEntryPremium < 0
  ) return null;
  return strike - perShareEntryPremium;
}

// Per-contract (or per-spread, for verticals/condors) credit in option
// "points" -- e.g. $0.45 for a CSP sold at $0.45/share, or $2.52 for a
// 5-lot BPS with $1,260 total credit. `totalCreditReceived` is the whole-
// position dollar total (Position.creditReceived's convention);
// `canonicalQuantity` MUST be the position's canonical contract/spread
// count (ES-0001's identity.quantity or equivalent) -- never inferred from
// an arbitrary leg's own quantity, since a leg's quantity is not
// necessarily the position's canonical quantity for every structure.
export function computeCreditPerContract(
  totalCreditReceived: number,
  canonicalQuantity: number,
  contractMultiplier: number = CONTRACT_MULTIPLIER
): number | null {
  if (
    !Number.isFinite(totalCreditReceived) ||
    !Number.isFinite(canonicalQuantity) ||
    canonicalQuantity <= 0 ||
    !Number.isFinite(contractMultiplier) ||
    contractMultiplier <= 0
  ) {
    return null;
  }
  return Math.abs(totalCreditReceived) / (canonicalQuantity * contractMultiplier);
}

// Raw signed net premium (credit positive, debit negative) for a leg set,
// per contract-count already embedded in each leg's own quantity (i.e. the
// whole-position total, same convention as calculateSpreadCredit in
// acquisition.ts) -- but WITHOUT flooring a debit to 0. Used only by the
// debit-trade guard (see isNetDebitStructure) to detect the case a floored
// $0.00 display credit would otherwise silently mask.
export function computeSignedNetPremium(
  legs: readonly { direction: 'Short' | 'Long'; quantity: number; avgOpenPrice: number }[]
): number;
export function computeSignedNetPremium(
  legs: readonly { direction: 'Short' | 'Long'; quantity: number; avgOpenPrice: number | null }[]
): number | null;
export function computeSignedNetPremium(
  legs: readonly { direction: 'Short' | 'Long'; quantity: number; avgOpenPrice: number | null }[]
): number | null {
  if (legs.length === 0 || legs.some(leg => leg.avgOpenPrice == null || !Number.isFinite(leg.avgOpenPrice))) return null;
  const net = legs.reduce((sum, leg) => {
    const qty = Math.abs(Number(leg.quantity) || 0);
    const price = leg.avgOpenPrice as number;
    return sum + (leg.direction === 'Short' ? price * qty : -price * qty);
  }, 0);
  return Math.round(net * 100 * 100) / 100;
}

// True when the raw (unfloored) net premium is actually a debit -- i.e. the
// structure was opened for a net cost, not a net credit. Small epsilon
// avoids float noise flagging a genuine ~$0.00 credit trade as a debit.
export function isNetDebitStructure(signedNetPremium: number | null): boolean {
  return signedNetPremium != null && signedNetPremium < -0.005;
}

export interface ComputePositionPnlInput {
  isNetDebit: boolean;
  hasCurrentPrices: boolean;
  anyLegCrossed: boolean;
  creditReceived: number;
  currentValue: number;
}

// The EXACT pnl formula acquisition.ts's loadPositions() uses -- extracted
// so the debit-guard/crossed-quote-guard interaction is unit-tested against
// the real production calculation, not a reimplementation or a
// mapping-only test.
//
// PM-0001 corrective round 2: this MUST gate on `isNetDebit`. Without it, a
// net-debit structure's `creditReceived` (floored to $0.00 by
// calculateSpreadCredit) silently produced `pnl = 0 - Math.abs(currentValue)`
// -- a fabricated loss equal to the full buyback cost, exactly the defect
// PM-0001 was meant to eliminate. The debit guard had already been applied
// to `pop`/`targetPrice`/`hitTarget` but was missed here in round 1.
export function computePositionPnl(input: ComputePositionPnlInput): number | null {
  const { isNetDebit, hasCurrentPrices, anyLegCrossed, creditReceived, currentValue } = input;
  if (isNetDebit || !hasCurrentPrices || anyLegCrossed) return null;
  return Math.abs(creditReceived) - Math.abs(currentValue);
}

// ── Breakevens ──────────────────────────────────────────────────────────────

// Single-short-leg breakeven (CSP, lone short put/call, or one side of a
// vertical) -- the full per-contract credit applies, since there's only one
// short leg's worth of credit involved.
export function computeSingleLegBreakeven(
  shortStrike: number,
  creditPerContract: number,
  optionType: 'P' | 'C'
): number | null {
  if (!Number.isFinite(shortStrike) || !Number.isFinite(creditPerContract)) return null;
  return optionType === 'P' ? shortStrike - creditPerContract : shortStrike + creditPerContract;
}

// Iron condor: the FULL per-condor credit applies to EACH breakeven
// independently -- the position doesn't stop paying out on one side just
// because price also moved away from the other side. Do not split/halve
// the credit across the two sides (the pre-fix defect).
export function computeIcBreakevens(
  shortPutStrike: number | null,
  shortCallStrike: number | null,
  creditPerCondor: number | null
): { lowerBreakeven: number | null; upperBreakeven: number | null } {
  if (
    shortPutStrike == null || shortCallStrike == null || creditPerCondor == null ||
    !Number.isFinite(shortPutStrike) || !Number.isFinite(shortCallStrike) || !Number.isFinite(creditPerCondor) ||
    shortPutStrike <= 0 || shortCallStrike <= 0
  ) {
    return { lowerBreakeven: null, upperBreakeven: null };
  }
  return {
    lowerBreakeven: shortPutStrike - creditPerCondor,
    upperBreakeven: shortCallStrike + creditPerCondor,
  };
}

// ── POP (probability of profit) model ───────────────────────────────────────
// Breakeven-based estimate under a lognormal price assumption. Unchanged
// math from the pre-existing inline implementation -- only the credit-unit
// defect (item 1) and the IC breakeven-halving defect (item 2) are fixed;
// the normal-CDF approximation and the underlying d2 formula are identical.

// Abramowitz-Stegun normal CDF approximation.
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erfApprox =
    sign *
    (1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absX * absX)));
  return 0.5 * (1 + erfApprox);
}

// Probability price stays ABOVE a lower breakeven (put-side survival)
// through `dte` calendar days at implied vol `ivPct`.
export function popAboveBreakeven(price: number, breakeven: number, dte: number, ivPct: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(breakeven) || price <= 0 || breakeven <= 0) return null;
  if (!Number.isFinite(dte) || dte <= 0 || !Number.isFinite(ivPct) || ivPct <= 0) return null;
  const sigma = ivPct / 100;
  const t = dte / 365;
  const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  return normalCdf(d2) * 100;
}

// Probability price stays BELOW an upper breakeven (call-side survival).
export function popBelowBreakeven(price: number, breakeven: number, dte: number, ivPct: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(breakeven) || price <= 0 || breakeven <= 0) return null;
  if (!Number.isFinite(dte) || dte <= 0 || !Number.isFinite(ivPct) || ivPct <= 0) return null;
  const sigma = ivPct / 100;
  const t = dte / 365;
  const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  return (1 - normalCdf(d2)) * 100;
}

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export interface PopLeg {
  optionType: 'P' | 'C';
  strikePrice: number;
  direction: 'Short' | 'Long';
}

// Full POP model for every supported strategy (PUT/CSP, BPS, CALL/BCS, IC).
// `canonicalQuantity` must be the position's canonical contract/spread
// count -- never inferred from an arbitrary leg (item 1's fix). Returns
// null whenever any required input is missing/invalid; the caller is
// responsible for not invoking this at all for a net-debit structure (see
// isNetDebitStructure) -- credit-based POP is not defined for a debit.
export function calcPositionPop(
  strategy: string,
  legs: readonly PopLeg[],
  price: number | null,
  totalCreditReceived: number,
  canonicalQuantity: number,
  dte: number,
  ivPct: number | null,
  contractMultiplier: number = CONTRACT_MULTIPLIER
): number | null {
  if (price == null || price <= 0 || ivPct == null || ivPct <= 0 || !Number.isFinite(dte) || dte <= 0) return null;

  const creditPerContract = computeCreditPerContract(totalCreditReceived, canonicalQuantity, contractMultiplier);
  if (creditPerContract == null) return null;

  const shortPut = legs.find(l => l.optionType === 'P' && l.direction === 'Short');
  const shortCall = legs.find(l => l.optionType === 'C' && l.direction === 'Short');

  if (strategy === 'PUT' || strategy === 'BPS') {
    if (!shortPut) return null;
    const breakeven = computeSingleLegBreakeven(shortPut.strikePrice, creditPerContract, 'P');
    if (breakeven == null || breakeven <= 0) return null;
    return popAboveBreakeven(price, breakeven, dte, ivPct);
  }

  if (strategy === 'CALL' || strategy === 'BCS') {
    if (!shortCall) return null;
    const breakeven = computeSingleLegBreakeven(shortCall.strikePrice, creditPerContract, 'C');
    if (breakeven == null) return null;
    return popBelowBreakeven(price, breakeven, dte, ivPct);
  }

  if (strategy === 'IC') {
    if (!shortPut || !shortCall) return null;
    const { lowerBreakeven, upperBreakeven } = computeIcBreakevens(shortPut.strikePrice, shortCall.strikePrice, creditPerContract);
    if (lowerBreakeven == null || upperBreakeven == null) return null;
    const popAbovePut = popAboveBreakeven(price, lowerBreakeven, dte, ivPct);
    const popBelowCall = popBelowBreakeven(price, upperBreakeven, dte, ivPct);
    if (popAbovePut == null || popBelowCall == null) return null;
    // Probability of finishing INSIDE the range = sum of both one-sided
    // survival probabilities minus 100 (inclusion-exclusion on the two
    // complement/breach events), clamped to a valid [0,100] probability --
    // extreme low-IV/short-DTE inputs can otherwise push the raw sum
    // slightly outside that range.
    return clampPct(popAbovePut + popBelowCall - 100);
  }

  return null;
}

// ── Side-specific buffer / breach evidence ──────────────────────────────────

export interface ShortLegStrikes {
  shortPutStrike: number | null;
  shortCallStrike: number | null;
}

// Resolves the short put/call strikes used for side-specific buffer
// evidence via `.find()` on optionType+direction -- NEVER `legs[0]`/
// `shorts[0]` -- so the result is identical regardless of broker
// leg-array ordering. This is the SAME function acquisition.ts's
// loadPositions() calls (not a reimplementation), so a leg-order-
// invariance test that calls this directly exercises the real
// production resolution path.
export function findShortLegStrikes(
  legs: readonly { optionType: 'P' | 'C'; direction: 'Short' | 'Long'; strikePrice: number }[]
): ShortLegStrikes {
  const shortPut = legs.find(l => l.optionType === 'P' && l.direction === 'Short');
  const shortCall = legs.find(l => l.optionType === 'C' && l.direction === 'Short');
  return {
    shortPutStrike: shortPut?.strikePrice ?? null,
    shortCallStrike: shortCall?.strikePrice ?? null,
  };
}

export interface SideBuffers {
  putBufferPct: number | null;
  callBufferPct: number | null;
}

// Side-specific OTM cushion, independent of broker leg-array ordering --
// callers pass the resolved short put/call strikes directly (found via
// `.find(optionType/direction)`, not `legs[0]`), so reversing the raw leg
// array never changes the result.
export function computeSideBuffers(
  stockPrice: number | null,
  shortPutStrike: number | null,
  shortCallStrike: number | null
): SideBuffers {
  if (stockPrice == null || !Number.isFinite(stockPrice) || stockPrice <= 0) {
    return { putBufferPct: null, callBufferPct: null };
  }
  const putBufferPct =
    shortPutStrike != null && Number.isFinite(shortPutStrike) && shortPutStrike > 0
      ? ((stockPrice - shortPutStrike) / stockPrice) * 100
      : null;
  const callBufferPct =
    shortCallStrike != null && Number.isFinite(shortCallStrike) && shortCallStrike > 0
      ? ((shortCallStrike - stockPrice) / stockPrice) * 100
      : null;
  return { putBufferPct, callBufferPct };
}

// Canonical single buffer value for the collapsed card/breach logic:
// - Put-only strategy: put buffer.
// - Call-only strategy: call buffer.
// - Iron condor: MINIMUM of put and call buffers, but ONLY when BOTH sides
//   are valid finite numbers -- PM-0001 corrective round: an IC with only
//   one side's evidence is NOT "safe" or "breached" from that one side
//   alone; declaring it so from incomplete two-sided evidence would be a
//   fabrication in the opposite direction from the original "shorts[0]"
//   defect this ticket already fixed. If either side is missing, the
//   canonical IC buffer is `null` -- callers (e.g. getRecommendation's
//   `buffer <= 0` breach check) must treat `null` as "cannot classify,"
//   never as "safe by default."
// - No valid short strike or stock price on the applicable side(s): null.
export function computeCanonicalBuffer(
  strategy: string,
  putBufferPct: number | null,
  callBufferPct: number | null
): number | null {
  if (strategy === 'IC') {
    if (
      putBufferPct == null || callBufferPct == null ||
      !Number.isFinite(putBufferPct) || !Number.isFinite(callBufferPct)
    ) {
      return null;
    }
    return Math.min(putBufferPct, callBufferPct);
  }
  // Call-only strategies must use the call buffer, even if a put buffer
  // value happens to be present (e.g. stale/irrelevant evidence) -- a
  // strategy-blind "first non-null wins" fallback would silently use the
  // wrong side's cushion.
  if (strategy === 'CALL' || strategy === 'BCS') {
    return callBufferPct;
  }
  // PUT/BPS and any other/unrecognized strategy label: prefer the put
  // buffer, falling back to the call buffer only if no put evidence exists
  // at all (never hide valid evidence behind an unfamiliar label).
  if (putBufferPct != null) return putBufferPct;
  return callBufferPct;
}

// ── Trade Evolution coloring ─────────────────────────────────────────────
// Pure directional-favorability judgment, extracted from
// app/portfolio/page.tsx's entryChangeColor() so it's unit-testable without
// exercising the React component (page.tsx itself can only re-export a
// small fixed set of things per Next.js App Router's route-type contract --
// see TC-0001's implementation report -- so the CSS-class mapping stays in
// page.tsx as a thin wrapper around this).

export type ChangeTone = 'good' | 'bad' | 'neutral';

// `goodWhenDown` selects which direction of change is favorable for a given
// metric (e.g. net edge declining is unfavorable -> goodWhenDown=false;
// shrinking |delta| exposure is favorable -> goodWhenDown=true). A change
// smaller than 0.01 is treated as negligible/neutral noise, matching the
// pre-existing threshold.
export function computeEntryChangeTone(
  entry: number | null | undefined,
  current: number | null | undefined,
  goodWhenDown: boolean
): ChangeTone {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return 'neutral';
  const diff = current - entry;
  if (Math.abs(diff) < 0.01) return 'neutral';
  const good = goodWhenDown ? diff < 0 : diff > 0;
  return good ? 'good' : 'bad';
}

// ── Quote-price resolution (never fabricate a 0) ────────────────────────────

// Resolves a single option leg's current (observational, mid-based) price.
// A 0 is never returned as a stand-in for "unavailable" -- callers must
// treat `null` as "no reliable price," which correctly propagates into
// currentValue/pnl/pnlPct/hitTarget being unavailable rather than computed
// off a fabricated $0.00.
//
// PM-0001 corrective round: requires `ask >= bid` (a real, non-crossed
// two-sided market), matching resolveUnderlyingPrice's rule -- a crossed
// option quote (ask < bid, a stale/bad tick) must not produce a midpoint.
// For a crossed market this falls back to a valid positive broker mark for
// an OBSERVATIONAL midpoint value, same as any other one-sided case; a
// crossed market is never treated as a genuine two-sided market for
// marketable-close purposes (see closeValue's oneSidedSymbols gate in
// acquisition.ts, which now also marks a crossed leg one-sided).
export function resolveOptionLegPrice(bid: number, ask: number, mark: number): number | null {
  const twoSidedNonCrossed = bid > 0 && ask > 0 && ask >= bid;
  if (twoSidedNonCrossed) return (bid + ask) / 2;
  return mark > 0 ? mark : null;
}

// Resolves the underlying's current price. Only uses the bid/ask midpoint
// when BOTH sides are positive AND the market isn't crossed (ask >= bid) --
// this specifically prevents `ask / 2` from being used as if it were a real
// midpoint when bid is 0 (twoSided already requires bid > 0, so that case is
// excluded), and prevents a crossed/stale quote from producing a midpoint at
// all. Falls back to a valid positive broker mark, then null -- never $0.00.
export function resolveUnderlyingPrice(bid: number, ask: number, mark: number): number | null {
  const twoSidedNonCrossed = bid > 0 && ask > 0 && ask >= bid;
  if (twoSidedNonCrossed) return (bid + ask) / 2;
  return mark > 0 ? mark : null;
}
