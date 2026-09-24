// lib/leaps-analysis/serverTradeReview.ts

import Redis from 'ioredis';
import { decrypt, encrypt } from '@/lib/crypto';
import { evaluateLeapsEntry, type LeapsEntryCriteria, type LeapsEntryQualification } from '@/lib/scans/leapsEntryQualification';
import { pairPmccCandidates } from '@/lib/scans/pmccPairing';
import { heldLongKey, parseHeldQuantity, readHeldBasis, type HeldLongBasisMap } from '@/lib/scans/pmccHeldBreakeven';
import { DEFAULT_PMCC_DTE_RANGES } from '@/lib/scans/pmccDteRanges';
import { DEFAULT_PMCC_LONG_DELTA_RANGE, DEFAULT_PMCC_SHORT_DELTA_RANGE, DEFAULT_PMCC_LONG_OI_MIN, DEFAULT_PMCC_SHORT_OI_MIN, DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '@/lib/scans/pmccConfig';
import { evaluatePmccDecision } from '@/lib/scans/pmccDecision';
import { derivePmccMarketSession } from '@/lib/scans/pmccProduction';
import type { PmccChainLeg, PmccPairingCriteria } from '@/lib/scans/pmccTypes';
import { recordEntryBestEffort, type RecordEntryInput } from '@/lib/leaps-position-intelligence/entryCapture';

/**
 * LEAPS-ENTRY-0001: records the market state at the moment the broker accepted an order. It runs only after the broker's acceptance,
 * is best-effort with a short timeout, and can never throw or change the order's result (recordEntryBestEffort swallows every failure;
 * this wrapper is a second guard).
 */
async function captureEntryAfterOrder(input: RecordEntryInput): Promise<void> {
  try { await recordEntryBestEffort(input); } catch { /* never affects the order */ }
}

const API_BASE = 'https://api.tastytrade.com';
const QUOTE_MAX_AGE_MS = 60_000;
// LEAPS-AI-0002: analysis-only freshness window while the regular session is open. Order paths keep QUOTE_MAX_AGE_MS.
const ANALYSIS_QUOTE_MAX_AGE_MS = 300_000;
// LEAPS-AI-0003: prior-session quotes (market not open) must still be recent: 5 calendar days covers the longest normal closure (a holiday weekend, ~4.8 days).
const PRIOR_SESSION_MAX_AGE_DAYS = 5;
const PRIOR_SESSION_MAX_AGE_MS = PRIOR_SESSION_MAX_AGE_DAYS * 86_400_000;
export const SERVER_LEAPS_POLICY: LeapsEntryCriteria = { deltaMin: 0.70, deltaMax: 0.85, dteMin: 180, oiMin: 100, extrinsicPctMax: 20, spreadPctMax: 10, requireQuoteTimestamp: true, policyVersion: 'leaps-entry-server-v1' };
export type BrokerContext = { accessToken: string; redis: Redis };
export type ServerLeapsReview = { qualification: LeapsEntryQualification; occSymbol: string; symbol: string; strike: number; expiration: string; dte: number; bid: number | null; ask: number | null; spot: number | null; delta: number | null; openInterest: number | null; impliedVolatility: number | null; optionQuoteTimestamp: string | null; underlyingQuoteTimestamp: string | null; instrumentType: 'Equity Option' | 'Index Option'; multiplier: number; provider: 'tastytrade'; fetchedAt: string; marketSession?: string; quoteBasis?: 'live' | 'last_session' };

function redisClient() { const url = process.env.REDIS_URL || process.env.KV_URL; if (!url) throw new Error('Server storage is not configured'); return new Redis(url); }
function iso(value: unknown): string | null { if (typeof value !== 'string' && typeof value !== 'number') return null; const d = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function finite(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function fresh(timestamp: string | null, now = Date.now(), maxAgeMs = QUOTE_MAX_AGE_MS) { return timestamp != null && Math.abs(now - Date.parse(timestamp)) <= maxAgeMs; }

export async function brokerContext(userId: string): Promise<BrokerContext> {
  const redis = redisClient(); const credentials = await redis.hgetall(`user:${userId}:tastytrade`); const clientId = process.env.TASTYTRADE_CLIENT_ID;
  if (!credentials.refresh_token || !credentials.client_secret || !clientId) { redis.disconnect(); throw new Error('Tastytrade is not connected'); }
  const response = await fetch(`${API_BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(credentials.refresh_token), client_id: clientId, client_secret: decrypt(credentials.client_secret) }), cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) { redis.disconnect(); throw new Error('Tastytrade authorization is unavailable'); }
  if (data.refresh_token) await redis.hset(`user:${userId}:tastytrade`, { refresh_token: encrypt(data.refresh_token) });
  return { accessToken: data.access_token, redis };
}
async function brokerGet(path: string, accessToken: string) { const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, cache: 'no-store' }); if (!response.ok) throw new Error('Broker market data is unavailable'); return response.json(); }
async function brokerGetFirst(paths: string[], accessToken: string) { for (const path of paths) { try { const data = await brokerGet(path, accessToken); if ((data?.data?.items ?? []).length > 0) return data; } catch { /* try alternate classification */ } } throw new Error('Broker market data is unavailable'); }
export async function validatedAccount(context: BrokerContext, locator: string | null): Promise<string> { const accounts = await brokerGet('/customers/me/accounts', context.accessToken); const owned = (accounts?.data?.items ?? []).map((item: any) => String(item?.account?.['account-number'] ?? '')).filter(Boolean); const requested = locator?.trim() || null; if (requested && owned.includes(requested)) return requested; if (!requested && owned.length === 1) return owned[0]; throw new Error(requested ? 'Selected broker account is unavailable.' : 'Choose an active broker account before continuing.'); }

async function resolveWithContext(context: BrokerContext, input: { underlyingSymbol: string; occSymbol: string }, criteria: LeapsEntryCriteria, freshness: 'strict' | 'analysis' = 'strict'): Promise<ServerLeapsReview> {
  if (!/^[A-Z.\-]{1,12}$/.test(input.underlyingSymbol) || !/^[A-Z0-9 .]{6,40}$/.test(input.occSymbol)) throw new Error('Invalid contract locator');
  const chain = await brokerGet(`/option-chains/${encodeURIComponent(input.underlyingSymbol)}/nested`, context.accessToken);
  let contract: { strike: number; expiration: string; multiplier: number } | null = null;
  for (const expiration of chain?.data?.items?.[0]?.expirations ?? []) for (const strike of expiration?.strikes ?? []) if (String(strike?.call ?? '') === input.occSymbol) contract = { strike: finite(strike['strike-price']) ?? NaN, expiration: String(expiration['expiration-date'] ?? ''), multiplier: finite(strike['shares-per-contract'] ?? expiration['shares-per-contract']) ?? 100 };
  if (!contract || !Number.isFinite(contract.strike) || !/^\d{4}-\d{2}-\d{2}$/.test(contract.expiration)) throw new Error('Exact call contract was not found for the supplied underlying.');
  const [optionData, underlyingData] = await Promise.all([
    brokerGetFirst([`/market-data/by-type?equity-option=${encodeURIComponent(input.occSymbol)}`, `/market-data/by-type?index-option=${encodeURIComponent(input.occSymbol)}`], context.accessToken),
    brokerGetFirst([`/market-data/by-type?equity=${encodeURIComponent(input.underlyingSymbol)}`, `/market-data/by-type?index=${encodeURIComponent(input.underlyingSymbol)}`], context.accessToken),
  ]);
  const option = optionData?.data?.items?.find((item: any) => String(item?.symbol ?? '') === input.occSymbol) ?? optionData?.data?.items?.[0]; const underlying = underlyingData?.data?.items?.[0];
  const bid = finite(option?.bid), ask = finite(option?.ask), underlyingBid = finite(underlying?.bid), underlyingAsk = finite(underlying?.ask);
  const spot = finite(underlying?.last) ?? (underlyingBid != null && underlyingAsk != null ? (underlyingBid + underlyingAsk) / 2 : null);
  const optionQuoteTimestamp = iso(option?.['updated-at'] ?? option?.['quote-time']); const underlyingQuoteTimestamp = iso(underlying?.['updated-at'] ?? underlying?.['quote-time']); 
  // LEAPS-AI-0002: 'strict' (default; every order/review path) keeps the 60 s rule unchanged. 'analysis' (Analyze with AI only):
  // market open -> both quotes within 300 s; market not open -> the broker's last two-sided quote is accepted as a
  // prior-session snapshot (same principle as pmccDecision's MARKET_CLOSED_QUOTES) and is labelled quoteBasis 'last_session'.
  // evaluateLeapsEntry still applies the marketData / spread gates, so a crossed, one-sided, or wide quote never qualifies.
  const nowMs = Date.now(); const marketSession = derivePmccMarketSession(new Date(nowMs));
  const priorSessionQuotes = freshness === 'analysis' && marketSession !== 'open' && marketSession !== 'unknown';
  const maxAgeMs = freshness === 'analysis' ? ANALYSIS_QUOTE_MAX_AGE_MS : QUOTE_MAX_AGE_MS;
  const quotesFresh = priorSessionQuotes ? fresh(optionQuoteTimestamp, nowMs, PRIOR_SESSION_MAX_AGE_MS) && fresh(underlyingQuoteTimestamp, nowMs, PRIOR_SESSION_MAX_AGE_MS) : fresh(optionQuoteTimestamp, nowMs, maxAgeMs) && fresh(underlyingQuoteTimestamp, nowMs, maxAgeMs);
  const quoteBasis: 'live' | 'last_session' = priorSessionQuotes && quotesFresh ? 'last_session' : 'live';
  const dte = Math.ceil((Date.parse(`${contract.expiration}T00:00:00Z`) - Date.now()) / 86_400_000);
  const qualification = evaluateLeapsEntry({ occSymbol: input.occSymbol, strike: contract.strike, dte, delta: finite(option?.delta), openInterest: finite(option?.['open-interest']), bid, ask, underlyingPrice: spot, quoteTimestamp: quotesFresh ? optionQuoteTimestamp : null }, criteria);
  if (!quotesFresh) { const gate = qualification.gates.find(item => item.id === 'freshness'); if (gate) gate.message = priorSessionQuotes ? (optionQuoteTimestamp == null || underlyingQuoteTimestamp == null ? 'Option and underlying quote timestamps are required' : `Quotes are more than ${PRIOR_SESSION_MAX_AGE_DAYS} days old`) : `Option and underlying quotes must both be no more than ${maxAgeMs / 1000} seconds old${freshness === 'analysis' ? ' while the market is open' : ''}`; }
  return { qualification, occSymbol: input.occSymbol, symbol: input.underlyingSymbol, strike: contract.strike, expiration: contract.expiration, dte, bid, ask, spot, delta: finite(option?.delta), openInterest: finite(option?.['open-interest']), impliedVolatility: finite(option?.volatility ?? option?.['implied-volatility'] ?? option?.iv), optionQuoteTimestamp, underlyingQuoteTimestamp, instrumentType: String(option?.['instrument-type'] ?? '').toLowerCase().includes('index') ? 'Index Option' : 'Equity Option', multiplier: contract.multiplier, provider: 'tastytrade', fetchedAt: new Date().toISOString(), marketSession, quoteBasis };
}

const SERVER_PMCC_CRITERIA: PmccPairingCriteria = {
  dte: DEFAULT_PMCC_DTE_RANGES,
  longDelta: DEFAULT_PMCC_LONG_DELTA_RANGE,
  shortDelta: DEFAULT_PMCC_SHORT_DELTA_RANGE,
  longOiMin: DEFAULT_PMCC_LONG_OI_MIN,
  shortOiMin: DEFAULT_PMCC_SHORT_OI_MIN,
  requireDebitBelowWidth: true,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

function pmccLeg(review: ServerLeapsReview): PmccChainLeg {
  return {
    underlyingSymbol: review.symbol,
    optionType: 'C',
    expiration: review.expiration,
    strike: review.strike,
    delta: review.delta,
    openInterest: review.openInterest,
    bid: review.bid,
    ask: review.ask,
    occSymbol: review.occSymbol,
    quoteTimestamp: review.optionQuoteTimestamp,
    delayed: false,
  };
}

/** Fresh server evidence, account ownership, canonical PMCC eligibility and
 * broker validation are repeated independently for dry-run and submit. */
export async function submitPmccOrder(userId: string, input: {
  accountLocator: string | null;
  underlyingSymbol: string;
  longOccSymbol: string;
  shortOccSymbol: string;
  quantity: number;
  limitPrice: number;
  mode: 'dry-run' | 'submit';
}, shortCriteriaOverride?: { shortDelta?: { min: number; max: number }; shortOiMin?: number; qualifyingSpreadPctMax?: number }) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100 || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error('Invalid order request');
  const context = await brokerContext(userId);
  try {
    const accountNumber = await validatedAccount(context, input.accountLocator);
    const [longReview, shortReview] = await Promise.all([
      resolveWithContext(context, { underlyingSymbol: input.underlyingSymbol, occSymbol: input.longOccSymbol }, SERVER_LEAPS_POLICY),
      resolveWithContext(context, { underlyingSymbol: input.underlyingSymbol, occSymbol: input.shortOccSymbol }, SERVER_LEAPS_POLICY),
    ]);
    const now = new Date();
    const marketSession = derivePmccMarketSession(now);
    const underlyingFresh = fresh(longReview.underlyingQuoteTimestamp, now.getTime()) && fresh(shortReview.underlyingQuoteTimestamp, now.getTime());
    // PMCC-ORDER-GATE-LIVE-FILTERS-0001: the same bug LEAPS had --
    // orders were re-checked against a fixed SERVER_PMCC_CRITERIA
    // constant, invisible and disconnected from the short-call filters
    // the trader actually configured in PmccScanModal. Only the SHORT
    // leg's criteria are overridable -- the long leg is an
    // already-held position (not user-configured per order), matching
    // PmccScanModal's own scope (it only ever exposed short-call
    // filters). Falls back to SERVER_PMCC_CRITERIA's value for anything
    // not supplied -- fail-closed, never fail-open.
    const effectiveCriteria: PmccPairingCriteria = {
      ...SERVER_PMCC_CRITERIA,
      shortDelta: shortCriteriaOverride?.shortDelta ?? SERVER_PMCC_CRITERIA.shortDelta,
      shortOiMin: shortCriteriaOverride?.shortOiMin ?? SERVER_PMCC_CRITERIA.shortOiMin,
      quotePolicy: {
        ...SERVER_PMCC_CRITERIA.quotePolicy,
        qualifyingSpreadPctMax: shortCriteriaOverride?.qualifyingSpreadPctMax ?? SERVER_PMCC_CRITERIA.quotePolicy.qualifyingSpreadPctMax,
      },
    };
    const pairing = pairPmccCandidates({
      symbol: input.underlyingSymbol,
      underlyingPrice: longReview.spot ?? NaN,
      longLegs: [pmccLeg(longReview)],
      shortLegs: [pmccLeg(shortReview)],
      criteria: effectiveCriteria,
      asOf: now,
      marketSession,
    });
    const pair = pairing.qualifiedPairs[0] ?? pairing.nearMissPairs[0] ?? null;
    const decision = evaluatePmccDecision({ pair, criteria: effectiveCriteria, marketSession });
    if (!underlyingFresh && decision.qualification === 'QUALIFIED') {
      decision.readiness = 'WAIT_MONITOR';
      decision.action = 'BLOCKED';
      decision.gates.push({ code: 'UNDERLYING_QUOTE_NOT_FRESH', status: 'unavailable', explanation: 'Underlying quote must be no more than 60 seconds old.', observedValue: longReview.underlyingQuoteTimestamp, threshold: '60 seconds', policySource: 'server-pmcc-v1' });
    }
    if (decision.action !== 'NEW_PMCC_REVIEW_ALLOWED' || !pair) return { decision, order: null };
    const instrumentType = longReview.instrumentType === 'Index Option' || shortReview.instrumentType === 'Index Option' ? 'Index Option' : 'Equity Option';
    const response = await fetch(`${API_BASE}/accounts/${accountNumber}/orders${input.mode === 'dry-run' ? '/dry-run' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
      body: JSON.stringify({ 'time-in-force': 'GTC', 'order-type': 'Limit', price: input.limitPrice.toFixed(2), 'price-effect': 'Debit', legs: [
        { 'instrument-type': instrumentType, symbol: input.longOccSymbol, quantity: input.quantity, action: 'Buy to Open' },
        { 'instrument-type': instrumentType, symbol: input.shortOccSymbol, quantity: input.quantity, action: 'Sell to Open' },
      ] }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? body?.errors?.[0]?.message ?? `Broker ${input.mode} failed`);
    if (input.mode === 'submit') {
      await captureEntryAfterOrder({ kind: 'pmcc-entry', userId, accountNumber, underlyingSymbol: input.underlyingSymbol, longOccSymbol: input.longOccSymbol, shortOccSymbol: input.shortOccSymbol, quantity: input.quantity, limitPrice: input.limitPrice, priceEffect: 'Debit', long: longReview, short: shortReview, order: body?.data ?? body });
    }
    return { decision, order: body?.data ?? body };
  } finally {
    context.redis.disconnect();
  }
}

/** Analysis lookup intentionally has no brokerage-account input or output. */
export async function resolveLeapsContractEvidence(userId: string, input: { underlyingSymbol: string; occSymbol: string }, criteria: LeapsEntryCriteria = SERVER_LEAPS_POLICY) { const context = await brokerContext(userId); try { return await resolveWithContext(context, input, criteria, 'analysis'); } finally { context.redis.disconnect(); } }

/** Account ownership and exact live contract evidence are revalidated on every call. */
export async function reviewLeapsContract(userId: string, input: { accountLocator: string | null; underlyingSymbol: string; occSymbol: string }, criteria: LeapsEntryCriteria = SERVER_LEAPS_POLICY) { const context = await brokerContext(userId); try { const accountNumber = await validatedAccount(context, input.accountLocator); const review = await resolveWithContext(context, input, criteria); return { accountNumber, context, review }; } catch (error) { context.redis.disconnect(); throw error; } }

export async function submitLeapsOrder(userId: string, input: { accountLocator: string | null; underlyingSymbol: string; occSymbol: string; quantity: number; limitPrice: number; mode: 'dry-run' | 'submit' }, criteria: LeapsEntryCriteria = SERVER_LEAPS_POLICY) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100 || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error('Invalid order request');
  const reviewed = await reviewLeapsContract(userId, input, criteria);
  try {
    if (reviewed.review.qualification.status !== 'CONTRACT_QUALIFIED') return { review: reviewed.review, order: null };
    const response = await fetch(`${API_BASE}/accounts/${reviewed.accountNumber}/orders${input.mode === 'dry-run' ? '/dry-run' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${reviewed.context.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, body: JSON.stringify({ 'time-in-force': 'GTC', 'order-type': 'Limit', price: input.limitPrice.toFixed(2), 'price-effect': 'Debit', legs: [{ 'instrument-type': reviewed.review.instrumentType, symbol: reviewed.review.occSymbol, quantity: input.quantity, action: 'Buy to Open' }] }) });
    const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message ?? body?.errors?.[0]?.message ?? `Broker ${input.mode} failed`); if (input.mode === 'submit') {
      await captureEntryAfterOrder({ kind: 'leaps-entry', userId, accountNumber: reviewed.accountNumber, underlyingSymbol: input.underlyingSymbol, longOccSymbol: input.occSymbol, shortOccSymbol: null, quantity: input.quantity, limitPrice: input.limitPrice, priceEffect: 'Debit', long: reviewed.review, short: null, order: body?.data ?? body });
    }
    return { review: reviewed.review, order: body?.data ?? body };
  } finally { reviewed.context.redis.disconnect(); }
}

// PMCC-COMPARE-HELD-0001 — held-LEAPS sell-to-open support. The long leg
// is never re-purchased or re-validated as a new entry here (that's what
// resolveWithContext + SERVER_LEAPS_POLICY are for, and they stay
// untouched above for the two-leg path) -- it's a position the account
// already owns, so the only question is whether it's STILL owned, in
// what quantity, right now, independent of anything the scan or the
// client claims.

interface HeldPmccPositionMatch {
  quantity: number;
  avgOpenPrice: number | null;
  expiration: string | null;
  // PMCC-HELD-BREAKEVEN-0001: the broker's raw strings, for the strict floor readers. The lenient
  // fields above stay as they were for the display snapshot and the sell-quantity check.
  rawQuantity: unknown;
  rawAvgOpenPrice: unknown;
}

async function findHeldPmccLongPosition(context: BrokerContext, accountNumber: string, input: { underlyingSymbol: string; longOccSymbol: string }): Promise<HeldPmccPositionMatch | null> {
  const positionsData = await brokerGet(`/accounts/${accountNumber}/positions`, context.accessToken);
  const items: any[] = positionsData?.data?.items ?? [];
  const match = items.find(item =>
    String(item?.symbol ?? '') === input.longOccSymbol
    && String(item?.['underlying-symbol'] ?? '').trim().toUpperCase() === input.underlyingSymbol
    && item?.['quantity-direction'] === 'Long'
    && (item?.['instrument-type'] === 'Equity Option' || item?.['instrument-type'] === 'Index Option'),
  );
  if (!match) return null;
  return {
    quantity: parseInt(match['quantity'] ?? '0', 10),
    avgOpenPrice: finite(match['average-open-price']),
    rawQuantity: match['quantity'],
    rawAvgOpenPrice: match['average-open-price'],
    expiration: iso(match['expires-at'])?.slice(0, 10) ?? (typeof match['expires-at'] === 'string' ? match['expires-at'].slice(0, 10) : null),
  };
}

export interface HeldPmccPositionSnapshot {
  matched: boolean;
  quantity: number;
  avgOpenPrice: number | null;
  currentPrice: number | null;
  dte: number | null;
}

/** Display-only lookup for the order-review modal -- shows the trader
 * what's actually held right now (quantity, cost basis, live price, DTE)
 * before they pick a quantity. Never authoritative: submitHeldPmccShort-
 * CallOrder below re-checks the same position independently, immediately
 * before allowing an order, and does not trust this snapshot's result. */
export async function fetchHeldPmccPositionSnapshot(userId: string, input: { accountLocator: string | null; underlyingSymbol: string; longOccSymbol: string }): Promise<{ accountNumber: string; snapshot: HeldPmccPositionSnapshot }> {
  const context = await brokerContext(userId);
  try {
    const accountNumber = await validatedAccount(context, input.accountLocator);
    const match = await findHeldPmccLongPosition(context, accountNumber, input);
    if (!match) return { accountNumber, snapshot: { matched: false, quantity: 0, avgOpenPrice: null, currentPrice: null, dte: null } };
    let currentPrice: number | null = null;
    try {
      const review = await resolveWithContext(context, { underlyingSymbol: input.underlyingSymbol, occSymbol: input.longOccSymbol }, SERVER_LEAPS_POLICY);
      currentPrice = review.bid != null && review.ask != null ? (review.bid + review.ask) / 2 : null;
    } catch { /* display-only; a failed live quote does not block showing quantity/cost basis */ }
    const dte = match.expiration ? Math.ceil((Date.parse(`${match.expiration}T00:00:00Z`) - Date.now()) / 86_400_000) : null;
    return { accountNumber, snapshot: { matched: true, quantity: match.quantity, avgOpenPrice: match.avgOpenPrice, currentPrice, dte: dte != null && Number.isFinite(dte) ? dte : null } };
  } finally {
    context.redis.disconnect();
  }
}

/** Fresh server evidence for the short leg, fresh position-ownership
 * evidence for the long leg, canonical PMCC eligibility (held-mode
 * gating, same policy evaluatePmccDecision already applies on the
 * client), and broker validation are all repeated independently for
 * dry-run and submit -- same posture as submitPmccOrder above, adapted
 * for a single-leg Credit order against an already-owned long. */
export async function submitHeldPmccShortCallOrder(userId: string, input: {
  accountLocator: string | null;
  underlyingSymbol: string;
  longOccSymbol: string;
  shortOccSymbol: string;
  quantity: number;
  limitPrice: number;
  mode: 'dry-run' | 'submit';
}, shortCriteriaOverride?: { shortDelta?: { min: number; max: number }; shortOiMin?: number; qualifyingSpreadPctMax?: number }) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100 || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error('Invalid order request');
  const context = await brokerContext(userId);
  try {
    const accountNumber = await validatedAccount(context, input.accountLocator);

    // Position-freshness gate: the held long must still exist in THIS
    // account as a Long option position with quantity at least covering
    // what's being sold. This is the check that closes the gap the scan
    // alone cannot -- the scan matched the held long against the live
    // chain when it ran, but time has passed since then. Re-verified
    // here, immediately before pairing/decision/submission, never
    // trusted from an earlier scan or a client-supplied value.
    const heldPosition = await findHeldPmccLongPosition(context, accountNumber, input);
    if (!heldPosition) {
      throw new Error('The held long call could not be found in this account. It may have been closed since this result was scanned.');
    }
    if (heldPosition.quantity < input.quantity) {
      throw new Error(`Only ${heldPosition.quantity} contract(s) of the held long call remain in this account -- cannot sell ${input.quantity} short call(s) against it.`);
    }

    const [longReview, shortReview] = await Promise.all([
      resolveWithContext(context, { underlyingSymbol: input.underlyingSymbol, occSymbol: input.longOccSymbol }, SERVER_LEAPS_POLICY),
      resolveWithContext(context, { underlyingSymbol: input.underlyingSymbol, occSymbol: input.shortOccSymbol }, SERVER_LEAPS_POLICY),
    ]);
    const now = new Date();
    const marketSession = derivePmccMarketSession(now);
    const underlyingFresh = fresh(longReview.underlyingQuoteTimestamp, now.getTime()) && fresh(shortReview.underlyingQuoteTimestamp, now.getTime());

    const effectiveCriteria: PmccPairingCriteria = {
      ...SERVER_PMCC_CRITERIA,
      // Held contract, not a new-entry candidate -- same OI bypass the
      // scan already applies at production time (lib/scans/pmccProduction.ts).
      longOiMin: 0,
      shortDelta: shortCriteriaOverride?.shortDelta ?? SERVER_PMCC_CRITERIA.shortDelta,
      shortOiMin: shortCriteriaOverride?.shortOiMin ?? SERVER_PMCC_CRITERIA.shortOiMin,
      quotePolicy: {
        ...SERVER_PMCC_CRITERIA.quotePolicy,
        qualifyingSpreadPctMax: shortCriteriaOverride?.qualifyingSpreadPctMax ?? SERVER_PMCC_CRITERIA.quotePolicy.qualifyingSpreadPctMax,
      },
    };
    const heldLongKeyValue = heldLongKey(input.longOccSymbol);
    const heldLongOccSymbols = new Set([heldLongKeyValue]);
    // PMCC-HELD-BREAKEVEN-0001: cost and lot count come from the broker position fetched above,
    // parsed strictly from the raw strings. Never input.quantity (that is the SELL quantity).
    const heldLongBasis: HeldLongBasisMap = new Map([[heldLongKeyValue, {
      avgOpen: readHeldBasis(heldPosition.rawAvgOpenPrice),
      quantity: parseHeldQuantity(heldPosition.rawQuantity),
    }]]);
    const pairing = pairPmccCandidates({
      symbol: input.underlyingSymbol,
      underlyingPrice: longReview.spot ?? shortReview.spot ?? NaN,
      longLegs: [pmccLeg(longReview)],
      shortLegs: [pmccLeg(shortReview)],
      criteria: effectiveCriteria,
      heldLongOccSymbols,
      heldLongBasis,
      asOf: now,
      marketSession,
    });
    let pair = pairing.qualifiedPairs[0] ?? pairing.nearMissPairs[0] ?? null;
    // Same annotation lib/scans/pmccProduction.ts applies at scan time --
    // evaluatePmccDecision reads entryMode to pick the held-mode gating
    // path (preference warnings instead of hard entry-delta/OI fails,
    // and HELD_PMCC_REVIEW_ONLY instead of NEW_PMCC_REVIEW_ALLOWED as
    // its "ready" action). Without this, a held pair would silently be
    // graded as a brand-new entry.
    if (pair) pair = { ...pair, entryMode: 'covered-short-call-against-held-leaps' };
    const decision = evaluatePmccDecision({ pair, criteria: effectiveCriteria, marketSession });
    if (!underlyingFresh && decision.qualification === 'QUALIFIED') {
      decision.readiness = 'WAIT_MONITOR';
      decision.action = 'BLOCKED';
      decision.gates.push({ code: 'UNDERLYING_QUOTE_NOT_FRESH', status: 'unavailable', explanation: 'Underlying quote must be no more than 60 seconds old.', observedValue: longReview.underlyingQuoteTimestamp, threshold: '60 seconds', policySource: 'server-pmcc-held-v1' });
    }
    // Held mode's own "ready to act" action is HELD_PMCC_REVIEW_ONLY, not
    // NEW_PMCC_REVIEW_ALLOWED -- same gate Ian confirmed should still
    // block a sell-to-open exactly like it blocks a new PMCC entry.
    // A floor-failed held pair (COST_BASIS_UNAVAILABLE or SHORT_NOT_ABOVE_HELD_BREAKEVEN) still reaches
    // `pair` via nearMissPairs; it must never become ready or build an order body. The decision gates
    // already block it (a structural fail gate); `pair.qualified` is checked here as a second, direct guard.
    if (decision.action !== 'HELD_PMCC_REVIEW_ONLY' || !pair || !pair.qualified) return { decision, order: null };

    const instrumentType = shortReview.instrumentType;
    const response = await fetch(`${API_BASE}/accounts/${accountNumber}/orders${input.mode === 'dry-run' ? '/dry-run' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
      body: JSON.stringify({
        'time-in-force': 'GTC', 'order-type': 'Limit', price: input.limitPrice.toFixed(2), 'price-effect': 'Credit',
        legs: [{ 'instrument-type': instrumentType, symbol: input.shortOccSymbol, quantity: input.quantity, action: 'Sell to Open' }],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? body?.errors?.[0]?.message ?? `Broker ${input.mode} failed`);
    if (input.mode === 'submit') {
      await captureEntryAfterOrder({ kind: 'short-call-sold', userId, accountNumber, underlyingSymbol: input.underlyingSymbol, longOccSymbol: input.longOccSymbol, shortOccSymbol: input.shortOccSymbol, quantity: input.quantity, limitPrice: input.limitPrice, priceEffect: 'Credit', long: longReview, short: shortReview, order: body?.data ?? body });
    }
    return { decision, order: body?.data ?? body };
  } finally {
    context.redis.disconnect();
  }
}
