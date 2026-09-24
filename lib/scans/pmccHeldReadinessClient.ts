import { getAccessToken, getQuote } from './tastytrade-client';
import { getPmccChain } from './pmccChainClient';
import { DEFAULT_PMCC_DTE_RANGES } from './pmccDteRanges';
import { DEFAULT_PMCC_LONG_DELTA_RANGE, DEFAULT_PMCC_LONG_OI_MIN, DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY, DEFAULT_PMCC_SHORT_DELTA_RANGE, DEFAULT_PMCC_SHORT_OI_MIN } from './pmccConfig';
import { PMCC_DECISION_POLICY_VERSION } from './pmccDecision';
import { derivePmccMarketSession, runPmccSymbolProduction } from './pmccProduction';
import type { HeldPmccLongCandidate } from './pmccHeldLeaps';
import type { PmccScanSnapshot } from './pmccTypes';

export type HeldPmccLiveReadiness =
  | { status: 'review-income-call'; reason: string; asOf: string; candidate: { delta: number; dte: number; openInterest: number; credit: number; spreadPct: number | null; strike: number; expiration: string; occSymbol: string } }
  | { status: 'market-closed'; reason: string; asOf: string }
  | { status: 'monitor'; monitorReason: 'no-qualifying-short-call' | 'quote-quality'; reason: string; asOf: string }
  | { status: 'not-ready'; reason: string; asOf: string };

/** Runs the same production PMCC evaluator used by the Screener against one
 * exact broker-held LEAPS. It is read-only and intentionally returns a
 * blocked state for missing, stale, or unavailable market evidence. */
export async function evaluateHeldPmccLiveReadiness(held: HeldPmccLongCandidate): Promise<HeldPmccLiveReadiness> {
  const now = new Date();
  const marketSession = derivePmccMarketSession(now);
  if (marketSession !== 'open') return { status: 'market-closed', reason: 'Current short-call quotes are reviewed during regular market hours.', asOf: now.toISOString() };
  try {
    const token = await getAccessToken();
    const [chain, price] = await Promise.all([
      getPmccChain(held.underlyingSymbol, token, DEFAULT_PMCC_DTE_RANGES),
      getQuote(held.underlyingSymbol, token),
    ]);
    const snapshot: PmccScanSnapshot = {
      asOf: now.toISOString(), marketSession,
      criteria: {
        dte: DEFAULT_PMCC_DTE_RANGES, longDelta: DEFAULT_PMCC_LONG_DELTA_RANGE, shortDelta: DEFAULT_PMCC_SHORT_DELTA_RANGE,
        longOiMin: DEFAULT_PMCC_LONG_OI_MIN, shortOiMin: DEFAULT_PMCC_SHORT_OI_MIN, requireDebitBelowWidth: true,
        quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
      },
      decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION,
    };
    const outcome = await runPmccSymbolProduction({
      snapshot,
      fallbackContext: { symbol: held.underlyingSymbol, price: null, ivr: null, underlyingType: chain.classification },
      acquire: async () => ({ chain, context: { symbol: held.underlyingSymbol, price: Number(price), ivr: null, underlyingType: chain.classification } }),
      heldLongCandidates: [held],
    });
    if (outcome.status === 'failed') return { status: 'not-ready', reason: outcome.audit.failReasons[1] ?? outcome.audit.failReasons[0] ?? 'Market data is unavailable.', asOf: snapshot.asOf };
    const result = outcome.results.find(item => item.pmccPair?.heldLongLeg?.occSymbol === held.occSymbol) ?? outcome.results[0];
    const pair = result?.pmccPair;
    if (pair && result?.pmccDecision?.action === 'HELD_PMCC_REVIEW_ONLY') {
      return { status: 'review-income-call', reason: 'A current short-call candidate meets the PMCC review policy.', asOf: snapshot.asOf, candidate: { delta: pair.shortLeg.delta, dte: pair.shortLeg.dte, openInterest: pair.shortLeg.openInterest as number /* short OI is always finite (SCAN-ALIGN-0001C1) */, credit: pair.shortLeg.executablePrice, spreadPct: pair.shortLeg.quote.spreadPct, strike: pair.shortLeg.strike, expiration: pair.shortLeg.expiration, occSymbol: pair.shortLeg.occSymbol } };
    }
    const gates = result?.pmccDecision?.gates ?? [];
    const quoteIssue = gates.some(gate => /QUOTE|BID_ASK|MARKET/i.test(gate.code));
    return { status: 'monitor', monitorReason: quoteIssue ? 'quote-quality' : 'no-qualifying-short-call', reason: result?.failReasons?.[0] ?? (quoteIssue ? 'Current quote quality is outside the review policy.' : 'No qualifying short-call candidate is currently available.'), asOf: snapshot.asOf };
  } catch (error) {
    return { status: 'not-ready', reason: error instanceof Error ? error.message : 'Market data is unavailable.', asOf: now.toISOString() };
  }
}
