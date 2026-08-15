// lib/portfolio/pmccStopGtcPrompt.ts
//
// PMCC short-leg profit-target/stop-loss ticket. Pure prompt-building
// logic, extracted so it can be unit-tested directly -- matching this
// codebase's own established precedent (positionMetrics.ts's header
// comment: "Extracted from lib/portfolio-data/acquisition.ts's
// loadPositions() closure... so each formula can be unit-tested directly").
// app/portfolio/page.tsx's internal functions (buildStopGtcPrompt and now
// this module's PMCC sibling) cannot be unit-tested in isolation --
// Next.js App Router page.tsx files only expose a small fixed export
// surface, and the existing PortfolioPage.test.tsx confirms the
// established pattern here is full-component rendering, never importing
// an internal page.tsx function directly.

// Small, genuinely pure -- duplicated rather than imported from
// app/portfolio/page.tsx's isUpcomingEarningsRisk, since a lib/ module
// cannot import from a Next.js page.tsx file (wrong direction) and this
// logic is simple enough that duplication is safer than adding new
// cross-boundary coupling for six lines of date math.
function isUpcomingEarningsRisk(earningsDate: string | null, expDate: string): boolean {
  if (!earningsDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const earnings = new Date(`${earningsDate}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);
  if (Number.isNaN(earnings.getTime()) || Number.isNaN(expiry.getTime())) return false;
  return earnings >= today && earnings <= expiry;
}

// Position/underlying-level context (buffer, earnings, IVR, profit-capture
// framing) -- identical whether the position is a lone covered call or
// PMCC's short leg, so this is shared rather than duplicated per-strategy.
// `dte` and `profitCaptured` are explicit parameters, never read from a
// whole-position object, specifically so a PMCC caller can pass the SHORT
// LEG's own dte (never the position's or the long leg's).
export function buildStopGtcFlags(input: {
  needsClose: boolean;
  entryDte: number;
  dte: number;
  buffer: number | null;
  earningsDate: string | null | undefined;
  expDate: string;
  ivr: number | null | undefined;
  profitCaptured: number | null;
}): string {
  const { needsClose, entryDte, dte, buffer, earningsDate, expDate, ivr, profitCaptured } = input;
  return [
    needsClose ? 'AT 21 DTE — closing soon anyway (standard entry)' : '',
    entryDte <= 21 ? `SHORT-DATED ENTRY (entered at ${entryDte} DTE, now ${dte} DTE — set tight stop, lower GTC target to 30-40%)` : '',
    buffer != null && buffer < 2 ? 'CRITICAL buffer ' + buffer.toFixed(1) + '% at ' + dte + ' DTE — near breach' : buffer != null && buffer < 3 && dte > 14 ? 'TIGHT buffer ' + buffer.toFixed(1) + '% at ' + dte + ' DTE' : buffer != null && buffer < 5 && dte > 30 ? 'WATCH buffer ' + buffer.toFixed(1) + '% at ' + dte + ' DTE' : '',
    isUpcomingEarningsRisk(earningsDate ?? null, expDate) ? 'EARNINGS ' + earningsDate : '',
    (ivr ?? 0) < 30 ? 'IVR BELOW 30 — edge thin' : '',
    (ivr ?? 0) > 70 ? 'IVR ABOVE 70 — elevated volatility' : '',
    profitCaptured != null && profitCaptured > 70 ? profitCaptured + '% PROFIT CAPTURED — stop must protect gains, anchor to current value' : '',
  ].filter(Boolean).join(' | ') || 'None';
}

import { canonicalShortLegEntryCredit, canonicalShortLegCreditPerContract, type PmccShortLegLike } from './pmccLegEconomics';

export interface PmccShortLegPromptContext {
  symbol: string;
  stockPrice: number | null;
  buffer: number | null;
  ivr: number | null | undefined;
  iv: number | null | undefined;
  hv30: number | null | undefined;
  theta: number | null | undefined;
  gamma: number | null | undefined;
  earningsDate: string | null | undefined;
  expDate: string;
  needsClose: boolean;
  hasGtc: boolean;
  gtcOrderPrice: number | null | undefined;
  stopLossStatus: string;
  stopLossPrice: number | null | undefined;
}

/**
 * A real fork of app/portfolio/page.tsx's buildStopGtcPrompt, not a PMCC
 * branch threaded through it -- same reasoning as PmccTradeModal's fork of
 * TradeModal. The whole-position path's entryCredit/creditPerContract come
 * from hasSupportedCreditEntryEconomics/canonicalEntryCredit, which
 * correctly fail closed for a PMCC's net-DEBIT economics; this function
 * sources credit from ONLY the short leg via pmccLegEconomics.ts's
 * isolated functions, and structurally cannot receive the long leg's data
 * at all -- PmccShortLegLike/PmccShortLegPromptContext have no long-leg
 * field for a caller to even pass.
 *
 * Per Ian's explicit guidance, there is no long-leg equivalent of this
 * function by design -- the LEAPS leg is thesis-driven and never gets a
 * mechanical target or stop.
 */
export function buildPmccShortLegStopGtcPrompt(
  shortLeg: PmccShortLegLike,
  context: PmccShortLegPromptContext,
): string {
  const entryCredit = canonicalShortLegEntryCredit(shortLeg);
  if (entryCredit == null) {
    throw new Error('Short-leg entry economics are unavailable; GTC and stop prices cannot be derived safely.');
  }
  const creditPerContract = canonicalShortLegCreditPerContract(shortLeg)!;
  // No live short-leg quote wired yet -- stays conservative (unknown)
  // rather than guessing at a current spread value this function has no
  // real source for.
  const currentValuePerContract: number | null = null as number | null;
  const dte = shortLeg.dte ?? 0;
  const strike = shortLeg.strikePrice ?? 0;

  const gtcMax  = currentValuePerContract != null ? (currentValuePerContract - 0.01).toFixed(2) : 'N/A';
  const stopMin = currentValuePerContract != null ? (currentValuePerContract + 0.01).toFixed(2) : 'N/A';
  const stopMax = (creditPerContract * 3.0).toFixed(2);

  return `Recommend optimal GTC profit-target and stop-loss prices for the SHORT CALL LEG of a PMCC (poor man's covered call) position. This is a leg-scoped recommendation -- manage ONLY this short call, exactly as you would a standalone covered call's short leg. Do NOT reference or reason about a long LEAPS leg; none of its data is provided to you.

HARD PRICE CONSTRAINTS (broker rejects violations):
Current spread value (live): ${currentValuePerContract?.toFixed(2) ?? 'unknown'}/contract
GTC MUST be below: ${gtcMax} (below current spread value)
Stop MUST be between: ${stopMin} and ${stopMax} (above current value, below 3x original credit)

SHORT CALL LEG: ${context.symbol}
Strike: ${strike}C | DTE: ${dte}

CREDIT:
Original credit: ${creditPerContract.toFixed(2)}/contract (${entryCredit.toFixed(2)} total)
Current spread value: ${currentValuePerContract?.toFixed(2) ?? 'unknown'}/contract

MARKET DATA:
Stock price: ${context.stockPrice?.toFixed(2) ?? 'unknown'}
Buffer to short strike: ${context.buffer?.toFixed(1) ?? 'unknown'}%
IVR: ${context.ivr ?? 'unknown'} | IV: ${context.iv ?? 'unknown'}% | HV30: ${context.hv30 ?? 'unknown'}%
Theta/d: ${context.theta?.toFixed(4) ?? 'unknown'} | Gamma: ${context.gamma?.toFixed(4) ?? 'unknown'}
Earnings within expiry: ${isUpcomingEarningsRisk(context.earningsDate ?? null, context.expDate) ? 'YES — ' + context.earningsDate : 'None'}

CURRENT ORDERS:
GTC profit-target: ${context.hasGtc ? 'Yes — at $' + (context.gtcOrderPrice?.toFixed(2) ?? '?') + '/contract' : 'None set'}
Stop loss: ${context.stopLossStatus}${context.stopLossPrice ? ' @ $' + context.stopLossPrice.toFixed(2) + '/contract' : ''}

FLAGS: ${buildStopGtcFlags({
  needsClose: context.needsClose,
  entryDte: dte,
  dte,
  buffer: context.buffer,
  earningsDate: context.earningsDate,
  expDate: context.expDate,
  ivr: context.ivr,
  profitCaptured: null,
})}

IMPORTANT: this recommendation covers the short call leg only. Respond as JSON only.`;
}

