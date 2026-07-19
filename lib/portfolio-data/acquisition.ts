// lib/portfolio-data/acquisition.ts
//
// TC-0001 corrective round: relocated verbatim from app/portfolio/page.tsx
// (mechanical move only -- no logic changes; see the Implementation
// Report's relocation audit table for the full symbol-by-symbol mapping).
//
// This module is the live TastyTrade acquisition + deterministic enrichment
// pipeline: loadPositions()/loadAccountBalances() and every helper function
// they call (GTC/complex-order fetching, max-risk/spread-credit calculation,
// stop-loss classification, entry-snapshot attachment, POP math, Net Edge
// evidence, health/objective scoring). It is invoked from exactly ONE place
// at runtime: components/portfolio-data/PortfolioDataProvider.tsx -- there is
// no second acquisition pipeline anywhere in the app. app/portfolio/page.tsx
// no longer owns a private copy of this logic; it consumes the same
// Provider (and therefore the same loadPositions()/loadAccountBalances()
// call) that app/dashboard/page.tsx does.
//
// Order submission (ttPost/ttDelete/ttPostComplex/ttValidateOrder/
// cancelOrder) and every ES-0001/ES-0002 safety-gated call site are NOT part
// of this module and were not touched -- they remain entirely in
// app/portfolio/page.tsx.

import type {
  ActionType, PositionIntent, StopStatus, StopLossInfo, Recommendation,
  PositionLeg, Position, PendingOrderLeg, PendingOrder, PositionSnapshot,
  GtcOrderLeg, GtcOrder, PriceSupportAnalysis, TrendResult, EntrySnapshot,
} from './types';
import { BASE, CLIENT_ID, getAccessToken, ttFetch } from '@/lib/tastytrade/client';
import {
  analyzePositionStructure,
  strategyLabelForStructure,
  buildCanonicalCloseIdentity,
  structureAnalysisToBlockingIssue,
  type RawEconomicLeg,
  type EconomicStructure,
  type CanonicalCloseIdentity,
} from '@/lib/portfolio/closeOrderSafety';
import {
  calculatePositionHealthScore,
  evaluatePositionObjective,
  buildPortfolioFinancialContext,
  calculateRemainingOpportunity,
  normalizePositionObjectivePct,
} from '@/lib/portfolio-intelligence';
import type { PositionHealthScore, PortfolioObjective, PortfolioRecommendation, PortfolioFinancialContext } from '@/lib/portfolio-intelligence';
import { computePositionValuation, type PositionValuation } from '@/lib/positionValuation';
import { classifyPositionLifecycle } from '@/lib/portfolio/positionLifecycle';

export const LS_PROFIT_TARGETS = 'hunter-profit-targets';


export const LS_ENTRY_SNAPSHOTS = 'hunter-entry-snapshots';


export function scorePortfolioPositionHealth(pos: Position): PositionHealthScore {
  return calculatePositionHealthScore({
    ...pos,
    positionId: pos.key,
  });
}


// PI-0006B: Net Edge decline vs. this position's own tracked peak, extracted
// as a shared helper since PI-0008A's Remaining Opportunity Engine reuses the
// exact same evidence (see its module doc: "no new calculations"). Both
// netEdgeLive/netEdgePeak already exist below in this file and are
// synchronous (pos.snapshotHistory is attached before either caller runs --
// see attachSnapshotHistory), so no new fetch/integration is needed.
export function computeNetEdgeEvidence(pos: Position): { netEdgeDeclinePct: number | null; netEdgeNegative: boolean | null } {
  const liveEdge = netEdgeLive(pos);
  const peakEdge = netEdgePeak(pos);
  const netEdgeDeclinePct = liveEdge != null && peakEdge != null && peakEdge > 0
    ? ((liveEdge - peakEdge) / peakEdge) * 100
    : null;
  const netEdgeNegative = liveEdge != null ? liveEdge <= 0 : null;
  return { netEdgeDeclinePct, netEdgeNegative };
}


// PI-0014: marketable/executable pnl% -- same null-safe convention pnlPct
// itself already uses, but reads pos.closeNowPnl (credit - marketable
// buyback) instead of pos.pnl (credit - mid buyback). Null when closeValue
// is unavailable (one-sided market on some leg) -- never fabricated from
// mid. See lib/positionValuation and
// docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.
export function computeMarketablePnlPct(pos: Position): number | null {
  return pos.closeNowPnl != null && pos.creditReceived !== 0
    ? (pos.closeNowPnl / pos.creditReceived) * 100
    : null;
}


// PI-0014: purely observational mid/marketable valuation evidence -- see
// lib/positionValuation's types.ts doc. Whether marketable evidence changed
// a recommendation (liquidityTrapTriggered) is owned by evaluatePositionObjective()
// instead (PI-0014 follow-up, Product Owner review), not by this object.
// Null when currentValue or closeValue is unavailable, same convention
// those two fields already follow.
export function computeRawPositionValuation(pos: Position) {
  if (pos.currentValue == null || pos.closeValue == null) return null;
  return computePositionValuation({
    creditReceived: pos.creditReceived,
    midValue: pos.currentValue,
    marketableValue: pos.closeValue,
    maxRisk: pos.maxRisk,
  });
}


// PI-0002: single canonical evaluation call. Returns both the legacy-shaped
// recommendation (unchanged output, for existing badges/priority list) and
// the new canonical objective (not yet rendered, wired through for later).
// PI-0014: also returns `valuation` -- the purely observational mid/marketable
// evidence object -- and `liquidityTrapTriggered`, owned by
// evaluatePositionObjective() itself (PI-0014 follow-up, Product Owner
// review: this is a decision-engine property, not a valuation property).
export function scorePortfolioPositionObjective(pos: Position): { recommendation: PortfolioRecommendation; objective: PortfolioObjective | null; valuation: PositionValuation | null; liquidityTrapTriggered: boolean } {
  const healthScore = pos.healthScore ?? (
    typeof scorePortfolioPositionHealth === 'function'
      ? scorePortfolioPositionHealth(pos)
      : undefined
  );

  // technicalAlignment is deliberately NOT wired in this slice: trend
  // (getTrend/TrendResult) is fetched asynchronously per-card and isn't
  // available at this synchronous call site -- left as an accepted,
  // documented gap for a future slice.
  const { netEdgeDeclinePct, netEdgeNegative } = computeNetEdgeEvidence(pos);

  // PI-0008B: reuses PI-0008A's Remaining Opportunity calculation (the exact
  // same inputs scorePortfolioRemainingOpportunity below already assembles)
  // so intent selection sees the same number Position Intelligence displays,
  // computed fresh at render time -- nothing new persisted onto Position.
  const { remainingOpportunityPct } = calculateRemainingOpportunity({
    creditReceived: pos.creditReceived,
    pnlPct: normalizePositionObjectivePct(pos.pnlPct),
    dte: pos.dte,
    buffer: normalizePositionObjectivePct(pos.buffer),
    healthScore: healthScore?.score ?? null,
    earningsDate: pos.earningsDate,
    expDate: pos.expDate,
    netEdgeDeclinePct,
    netEdgeNegative,
    lifecycleType: classifyPositionLifecycle(pos).type,
  });

  // PI-0014: computed here (not inside evaluatePositionObjective) because
  // this file already owns pos.closeNowPnl/pos.currentValue/pos.closeValue --
  // the Decision Engine only ever sees the already-normalized percentage,
  // never raw prices, matching how pnlPct itself is passed through today.
  const marketablePnlPct = computeMarketablePnlPct(pos);
  const valuation = computeRawPositionValuation(pos);

  const { objective, legacyRecommendation, liquidityTrapTriggered } = evaluatePositionObjective({
    ...pos,
    positionId: pos.key,
    healthScore,
    netEdgeDeclinePct,
    netEdgeNegative,
    remainingOpportunityPct,
    marketablePnlPct,
    liquidityTier: valuation?.liquidityTier ?? null,
  });

  return { recommendation: legacyRecommendation, objective, valuation, liquidityTrapTriggered };
}


// PI-0008A: Remaining Opportunity Engine -- a parallel, independent
// calculation from scorePortfolioPositionObjective above (not part of the
// Decision Engine; see remainingOpportunity.ts's module doc). Computed fresh
// at render time from the same already-available fields, the same way
// classifyPositionLifecycle(pos) already is at this file's Position
// Intelligence call site -- nothing is persisted onto Position.
export function scorePortfolioRemainingOpportunity(pos: Position) {
  const { netEdgeDeclinePct, netEdgeNegative } = computeNetEdgeEvidence(pos);
  return calculateRemainingOpportunity({
    creditReceived: pos.creditReceived,
    // Same fraction-vs-percent normalization evaluatePositionObjective()
    // already applies to these two fields before using them -- keeps this
    // metric's captured/remaining percentages consistent with the
    // recommendation engine's own reading of the same position.
    pnlPct: normalizePositionObjectivePct(pos.pnlPct),
    dte: pos.dte,
    buffer: normalizePositionObjectivePct(pos.buffer),
    healthScore: pos.healthScore?.score ?? null,
    earningsDate: pos.earningsDate,
    expDate: pos.expDate,
    netEdgeDeclinePct,
    netEdgeNegative,
    lifecycleType: classifyPositionLifecycle(pos).type,
  });
}


// Fetches the full snapshot store and returns it keyed by position.key.
// Non-blocking caller handles failure by leaving history empty.
export async function fetchSnapshotStore(): Promise<Record<string, PositionSnapshot[]>> {
  const res = await fetch('/api/position-snapshots');
  if (!res.ok) throw new Error(`snapshot fetch ${res.status}`);
  const data = await res.json();
  return (data?.snapshots ?? {}) as Record<string, PositionSnapshot[]>;
}


// Attaches each position's snapshot history (sorted by date ascending) onto
// the position object so the card render can compute net-edge peak/trend.
export function attachSnapshotHistory(
  positions: Position[],
  store: Record<string, PositionSnapshot[]>,
): Position[] {
  return positions.map(p => {
    const hist = store[p.key] ?? [];
    const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
    const withHistory = { ...p, snapshotHistory: sorted };
    const healthScore = scorePortfolioPositionHealth(withHistory);
    const withHealth = { ...withHistory, healthScore };
    const { recommendation, objective, valuation, liquidityTrapTriggered } = scorePortfolioPositionObjective(withHealth);
    return { ...withHealth, recommendation, portfolioObjective: objective, valuation, liquidityTrapTriggered };
  });
}


export async function fetchEntrySnapshots(): Promise<Record<string, EntrySnapshot>> {
  try {
    const res = await fetch('/api/position-entry-snapshots');
    if (!res.ok) return {};
    const data = await res.json();
    return data?.snapshots ?? {};
  } catch {
    return {};
  }
}


// Upserts entries server-side. The API route never overwrites an existing
// key, so this is safe to call speculatively (e.g. every page load for
// positions that turn out to already have a snapshot -- those are just
// skipped server-side).
export async function postEntrySnapshots(
  entries: { positionKey: string; snapshot: EntrySnapshot }[]
): Promise<Record<string, EntrySnapshot> | null> {
  if (entries.length === 0) return null;
  try {
    const res = await fetch('/api/position-entry-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.snapshots ?? null;
  } catch {
    return null;
  }
}


// One-time migration: earlier versions of TradeEdge stored entry snapshots
// in this browser's localStorage only, which meant the Trade Evolution
// baseline never followed the trader to a different device. If old
// localStorage data is still present, push it up to Redis (server-side
// upsert skips anything that already exists there, so this can never
// clobber a real baseline), then clear the local copy so this doesn't
// re-run on every load.
export async function migrateLocalEntrySnapshotsIfNeeded(): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LS_ENTRY_SNAPSHOTS);
    if (!raw) return;

    const localSnapshots: Record<string, EntrySnapshot> = JSON.parse(raw);
    const entries = Object.entries(localSnapshots).map(([positionKey, snapshot]) => ({
      positionKey,
      snapshot,
    }));
    if (entries.length === 0) {
      localStorage.removeItem(LS_ENTRY_SNAPSHOTS);
      return;
    }

    const result = await postEntrySnapshots(entries);
    if (result != null) {
      localStorage.removeItem(LS_ENTRY_SNAPSHOTS);
    }
  } catch {}
}


export function positionEntrySnapshotKey(pos: Pick<Position, 'accountNumber' | 'symbol' | 'expDate' | 'entryDate' | 'legs'>): string {
  const legsKey = pos.legs
    .map(l => `${l.direction[0]}${l.optionType}${l.strikePrice}x${Math.abs(l.quantity)}`)
    .sort()
    .join('|');
  return [pos.accountNumber, pos.symbol, pos.expDate, pos.entryDate ?? 'unknown', legsKey].join('::');
}


export async function attachEntrySnapshots(positions: Position[]): Promise<Position[]> {
  await migrateLocalEntrySnapshotsIfNeeded();

  const snapshots = await fetchEntrySnapshots();
  const toCreate: { positionKey: string; snapshot: EntrySnapshot }[] = [];

  const enriched = positions.map(pos => {
    const key = positionEntrySnapshotKey(pos);
    let snap = snapshots[key];

    if (!snap) {
      snap = {
        key,
        createdAt: new Date().toISOString(),
        symbol: pos.symbol,
        strategy: pos.strategy,
        expDate: pos.expDate,
        entryDate: pos.entryDate,
        ivAtEntry: pos.iv ?? null,
        ivrAtEntry: pos.ivr ?? null,
        popAtEntry: getCurrentPop(pos),
        deltaAtEntry: pos.netDelta ?? null,
        thetaAtEntry: pos.theta ?? null,
        gammaAtEntry: pos.gamma ?? null,
        vegaAtEntry: pos.netVega ?? null,
        stockPriceAtEntry: pos.stockPrice ?? null,
        otmAtEntry: pos.buffer ?? null,
        dteAtEntry: pos.entryDte ?? pos.dte ?? null,
      };
      snapshots[key] = snap;
      toCreate.push({ positionKey: key, snapshot: snap });
    }

    return {
      ...pos,
      entrySnapshotKey: key,
      entrySnapshotCreatedAt: snap.createdAt,
      ivAtEntry: snap.ivAtEntry ?? null,
      ivrAtEntry: snap.ivrAtEntry ?? null,
      popAtEntry: snap.popAtEntry ?? null,
      deltaAtEntry: snap.deltaAtEntry ?? null,
      thetaAtEntry: snap.thetaAtEntry ?? null,
      gammaAtEntry: snap.gammaAtEntry ?? null,
      vegaAtEntry: snap.vegaAtEntry ?? null,
      stockPriceAtEntry: snap.stockPriceAtEntry ?? null,
      otmAtEntry: snap.otmAtEntry ?? null,
      dteAtEntry: snap.dteAtEntry ?? pos.entryDte ?? null,
    };
  });

  if (toCreate.length > 0) {
    await postEntrySnapshots(toCreate);
  }

  return enriched;
}


// ── Position Loading ───────────────────────────────────────────────────────
export function parseOptionSymbol(sym: string): { optionType: 'P' | 'C'; strikePrice: number } {
  const match = sym.trim().replace(/\s+/g, '').match(/^([A-Z/]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return { optionType: 'C', strikePrice: 0 };
  return { optionType: match[3] as 'P' | 'C', strikePrice: parseInt(match[4], 10) / 1000 };
}


export function calculateSpreadCredit(legs: Pick<PositionLeg, 'direction' | 'quantity' | 'avgOpenPrice'>[]): number {
  // Returns the actual net opening credit for the whole position in dollars.
  // TT leg prices are per-share option prices; multiply by contracts * 100.
  const net = legs.reduce((sum, leg) => {
    const qty = Math.abs(Number(leg.quantity) || 0);
    const price = Number(leg.avgOpenPrice) || 0;
    return sum + (leg.direction === 'Short' ? price * qty : -price * qty);
  }, 0);
  return Math.max(0, Math.round(net * 100 * 100) / 100);
}


export function sideGrossRisk(
  shorts: PositionLeg[],
  longs: PositionLeg[],
  side: 'P' | 'C'
): number {
  // Gross risk before credit for verticals on one side, in dollars.
  // For puts: short strike should be above long strike. For calls: short strike should be below long strike.
  const availableLongs = longs
    .filter(l => l.optionType === side && l.strikePrice > 0 && l.quantity > 0)
    .map(l => ({ ...l, remainingQty: Math.abs(l.quantity) }))
    .sort((a, b) => side === 'P' ? b.strikePrice - a.strikePrice : a.strikePrice - b.strikePrice);

  let gross = 0;
  const orderedShorts = shorts
    .filter(s => s.optionType === side && s.strikePrice > 0 && s.quantity > 0)
    .sort((a, b) => side === 'P' ? b.strikePrice - a.strikePrice : a.strikePrice - b.strikePrice);

  for (const short of orderedShorts) {
    let remainingShortQty = Math.abs(short.quantity);
    for (const long of availableLongs) {
      if (remainingShortQty <= 0) break;
      if (long.remainingQty <= 0) continue;
      const protects = side === 'P'
        ? long.strikePrice < short.strikePrice
        : long.strikePrice > short.strikePrice;
      if (!protects) continue;

      const matchedQty = Math.min(remainingShortQty, long.remainingQty);
      gross += Math.abs(short.strikePrice - long.strikePrice) * 100 * matchedQty;
      remainingShortQty -= matchedQty;
      long.remainingQty -= matchedQty;
    }

    // If any short contracts are unprotected, treat them as naked risk for margin display.
    // This keeps the number conservative instead of incorrectly showing $0 risk.
    if (remainingShortQty > 0) gross += short.strikePrice * 100 * remainingShortQty;
  }

  return gross;
}


export function calculateMaxRisk(legs: PositionLeg[], creditReceived: number, strategy: string): number {
  const shorts = legs.filter(l => l.direction === 'Short');
  const longs = legs.filter(l => l.direction === 'Long');

  const putGross = sideGrossRisk(shorts, longs, 'P');
  const callGross = sideGrossRisk(shorts, longs, 'C');

  let grossRisk = 0;
  if (strategy === 'IC') {
    // An iron condor can only lose on one side at expiration, so use the larger side, not both.
    grossRisk = Math.max(putGross, callGross);
  } else if (strategy === 'BPS' || strategy === 'PUT') {
    grossRisk = putGross;
  } else if (strategy === 'BCS' || strategy === 'CALL') {
    grossRisk = callGross;
  } else {
    grossRisk = putGross + callGross;
  }

  return Math.max(0, Math.round((grossRisk - Math.abs(creditReceived)) * 100) / 100);
}


export function normalizeOccSymbol(symbol: string): string { return String(symbol ?? '').replace(/\s+/g, '').trim(); }


export function normalizeOrderAction(action: string): string { return String(action ?? '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }


export function isBuyToCloseAction(action: string): boolean { const n = normalizeOrderAction(action); return n === 'buy to close' || n === 'btc'; }


export function isStopOrder(order: GtcOrder): boolean { return Boolean(order.stopPrice) || order.orderType.toLowerCase().includes('stop'); }


export function pickOrderField(o: any, keys: string[]): string | null {
  for (const key of keys) { const v = o?.[key]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v); }
  return null;
}


export function mapGtcOrder(o: any, parentTif?: string, parentComplexId?: string): GtcOrder {
  // Collect legs from direct legs array OR from nested orders' legs (automation/complex orders)
  let legs = (o?.legs ?? []).map((l: any) => ({ symbol: normalizeOccSymbol(String(l?.symbol ?? '')), action: String(l?.action ?? '') }));
  if (legs.length === 0) {
    for (const nested of o?.orders ?? []) {
      const nestedLegs = (nested?.legs ?? []).map((l: any) => ({ symbol: normalizeOccSymbol(String(l?.symbol ?? '')), action: String(l?.action ?? '') }));
      legs = legs.concat(nestedLegs);
    }
  }
  const tif = String(o?.['time-in-force'] ?? o?.timeInForce ?? parentTif ?? '');
  // complex-order-id comes from TT on individual orders; parentComplexId comes from collectRawOrders
  const complexOrderId = o?.['complex-order-id']
    ? String(o['complex-order-id'])
    : parentComplexId
    ? String(parentComplexId)
    : undefined;
  console.log(`MAP_GTC_ORDER id=${o?.id} complex-order-id=${o?.['complex-order-id']} parentComplexId=${parentComplexId} resolved=${complexOrderId}`);
  return {
    id: String(o?.id ?? ''),
    price: String(o?.price ?? o?.['limit-price'] ?? ''),
    stopPrice: pickOrderField(o, ['stop-trigger', 'stop-price', 'stopPrice', 'stop', 'trigger-price']),
    orderType: String(o?.['order-type'] ?? o?.orderType ?? ''),
    timeInForce: tif,
    legs,
    complexOrderId,
  };
}


export function collectRawOrders(raw: any): any[] {
  const out: any[] = [];
  const visit = (order: any, parentTif?: string, parentComplexId?: string) => {
    if (!order || typeof order !== 'object') return;
    const tif = String(order?.['time-in-force'] ?? order?.timeInForce ?? parentTif ?? '');
    // Collect this order if it has direct legs
    if (Array.isArray(order.legs) && order.legs.length > 0) {
      // Inject complex-order-id from parent if not already set on the order
      const complexId = order['complex-order-id'] ?? parentComplexId;
      out.push({ ...order, 'complex-order-id': complexId, _inheritedTif: tif, _parentComplexId: parentComplexId });
    }
    // For complex/automation orders: also collect as a combined order with all nested legs merged
    if (Array.isArray(order.orders) && order.orders.length > 0) {
      const allLegs: any[] = [];
      for (const nested of order.orders) allLegs.push(...(nested?.legs ?? []));
      if (allLegs.length > 0) {
        out.push({ ...order, legs: allLegs, _inheritedTif: tif, _isCombined: true });
      }
      // Pass this order's ID as the parentComplexId to its nested orders
      const thisComplexId = String(order.id ?? parentComplexId ?? '');
      for (const nested of order.orders) visit(nested, tif, thisComplexId);
    }
  };
  for (const item of raw?.data?.items ?? []) visit(item);
  return out;
}


export function findProfitGtcOrder(positionLegs: PositionLeg[], gtcOrders: GtcOrder[]): GtcOrder | null {
  // Find a GTC limit order (not a stop) that has Buy to Close on the short leg.
  // Also matches automation/complex orders where legs are combined from sub-orders.
  const shortLeg = positionLegs.find(l => l.direction === 'Short');
  if (!shortLeg?.symbol) return null;
  const shortSymbol = normalizeOccSymbol(shortLeg.symbol);
  return gtcOrders.find(order =>
    !isStopOrder(order) &&
    (order.orderType.toLowerCase().includes('limit') || order.orderType === '') &&
    order.legs.some(leg =>
      normalizeOccSymbol(leg.symbol) === shortSymbol && isBuyToCloseAction(leg.action)
    )
  ) ?? null;
}


export async function fetchAllComplexOrders(accountNumber: string, token: string): Promise<any> {
  // Paginate through all complex orders — TT defaults to 10/page
  const allItems: any[] = [];
  let page = 0;
  while (true) {
    const data = await ttFetch(`/accounts/${accountNumber}/complex-orders?page-offset=${page}&per-page=50`, token);
    const items = data?.data?.items ?? [];
    allItems.push(...items);
    const pagination = data?.pagination;
    if (!pagination || page >= (pagination['total-pages'] ?? 1) - 1) break;
    page++;
  }
  return { data: { items: allItems } };
}


export async function fetchGtcOrders(accountNumber: string, token: string): Promise<GtcOrder[]> {
  try {
    // Use /orders/live only — it returns working + recent 24h orders.
    // ?status=Open and ?per-page=250 are invalid params that return 400.
    const [liveResult, complexResult] = await Promise.allSettled([
      ttFetch(`/accounts/${accountNumber}/orders/live`, token),
      fetchAllComplexOrders(accountNumber, token),
    ]);

    // Build a map from individual order ID → complex order ID
    // Orders from /orders/live don't have complex-order-id, but we can look them up
    // by matching their ID against nested orders in the complex orders response
    const individualToComplexId: Record<string, string> = {};
    if (complexResult.status === 'fulfilled') {
      for (const complexOrder of complexResult.value?.data?.items ?? []) {
        const complexId = String(complexOrder.id);
        for (const nestedOrder of complexOrder.orders ?? []) {
          if (nestedOrder.id) {
            individualToComplexId[String(nestedOrder.id)] = complexId;
          }
        }
      }
    }

    const requests = [liveResult, complexResult];
    const rawOrders = requests.flatMap(r => r.status === 'fulfilled' ? collectRawOrders(r.value) : []);
    // Inject complexOrderId for orders that came from /orders/live
    rawOrders.forEach(o => {
      if (!o['complex-order-id'] && individualToComplexId[String(o.id)]) {
        o['complex-order-id'] = individualToComplexId[String(o.id)];
      }
    });
    const seen = new Set<string>();
    return rawOrders.map(o => mapGtcOrder(o, o._inheritedTif, o._parentComplexId)).filter(order => {
      const tif = order.timeInForce.toUpperCase();
      const type = order.orderType.toLowerCase();
      // Parent OCO envelope has no tif/type — check nested sub-orders
      // Accept if any nested order has GTC tif, or if tif is empty (parent envelope)
      const isGtcTif = tif === 'GTC' || tif === '' || tif === 'PENDING';
      const isLimitOrStop = type.includes('limit') || type.includes('stop') || type === '';
      if ((!isGtcTif || !isLimitOrStop) && order.legs.length === 0) return false;
      if (order.legs.length === 0) return false;
      const key = `${order.id}|${order.orderType}|${order.price}|${order.stopPrice ?? ''}|${order.legs.map(l => `${l.symbol}:${l.action}`).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  } catch { return []; }
}


export function classifyPositionStopLoss(position: Pick<Position, 'legs' | 'creditReceived' | 'quantity'>, gtcOrders: GtcOrder[]): StopLossInfo {
  const shortLeg = position.legs.find(l => l.direction === 'Short');
  if (!shortLeg?.symbol) return { status: 'unknown', price: null };
  // ES-0001: canonical quantity, not this one arbitrary leg's own quantity.
  const creditPerContract = position.quantity > 0 ? position.creditReceived / (position.quantity * 100) : position.creditReceived / 100;
  const stopThreshold = parseFloat((creditPerContract * 2).toFixed(2));
  const shortSymbol = normalizeOccSymbol(shortLeg.symbol);
  const match = gtcOrders.find(order =>
    isStopOrder(order) && order.legs.some(leg => normalizeOccSymbol(leg.symbol) === shortSymbol && isBuyToCloseAction(leg.action))
  );
  if (!match) return { status: 'none', price: null };
  const orderPrice = parseFloat(match.stopPrice ?? match.price);
  if (isNaN(orderPrice)) return { status: 'unknown', price: null };
  return orderPrice <= stopThreshold + 0.02 ? { status: 'live', price: orderPrice } : { status: 'loose', price: orderPrice };
}


export async function loadPositions(): Promise<{ positions: Position[]; pendingOrders: PendingOrder[] }> {
  const token = await getAccessToken();
  const accountsData = await ttFetch('/customers/me/accounts', token);
  const accounts = accountsData?.data?.items ?? [];
  if (accounts.length === 0) throw new Error('No accounts found');
  const accountNumber = accounts[0]?.account?.['account-number'];
  if (!accountNumber) throw new Error('Could not read account number');

  const positionsData = await ttFetch(`/accounts/${accountNumber}/positions`, token);
  const rawPositions = positionsData?.data?.items ?? [];
  const optionPositions = rawPositions.filter((p: any) =>
    p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option'
  );

  const rawBuckets: Record<string, any[]> = {};
  for (const pos of optionPositions) {
    const key = `${pos['underlying-symbol']}::${pos['expires-at']?.slice(0, 10) ?? 'unknown'}`;
    if (!rawBuckets[key]) rawBuckets[key] = [];
    rawBuckets[key].push(pos);
  }

  // ES-0001 (corrective round): quantity-only grouping was rejected by the
  // Product Owner -- it cannot tell apart two independently-opened spreads
  // that share symbol, expiration, AND quantity. Each symbol+expiration
  // bucket is now run through deterministic economic-structure analysis
  // (lib/portfolio/closeOrderSafety.ts's analyzePositionStructure), which
  // asks whether the raw legs partition into exactly one defensible
  // structure using option type, strike, direction, and quantity together.
  // RESOLVED buckets may yield MULTIPLE structures (e.g. two independent
  // same-symbol spreads at different quantities, or a naked leg alongside a
  // vertical) -- each becomes its own group/Position. AMBIGUOUS/UNSUPPORTED
  // buckets still render as ONE group so the position remains visible, but
  // are flagged so every downstream action is hard-blocked -- see
  // docs/design/ES-0001-Live-Close-Order-Safety.md.
  interface RawGroup {
    rawLegs: any[];
    ambiguous: boolean;
    blockMessage: string | null;
    structure: EconomicStructure | null;
  }
  const groups: Record<string, RawGroup> = {};
  for (const [bucketKey, rawLegs] of Object.entries(rawBuckets)) {
    const sepIdx = bucketKey.indexOf('::');
    const underlying = bucketKey.slice(0, sepIdx);
    const expiration = bucketKey.slice(sepIdx + 2);
    const economicLegs: RawEconomicLeg[] = rawLegs.map((l: any) => {
      const parsed = parseOptionSymbol(l.symbol);
      return {
        symbol: l.symbol,
        optionType: parsed.optionType,
        strikePrice: parsed.strikePrice,
        direction: l['quantity-direction'] as 'Short' | 'Long',
        quantity: parseInt(l['quantity'] ?? '1', 10),
        avgOpenPrice: parseFloat(l['average-open-price'] ?? '0'),
        createdAt: l['created-at'] ?? null,
      };
    });
    const analysis = analyzePositionStructure(economicLegs);
    if (analysis.status !== 'RESOLVED') {
      const issue = structureAnalysisToBlockingIssue(analysis);
      groups[bucketKey] = { rawLegs, ambiguous: true, blockMessage: issue?.message ?? 'Position structure is ambiguous.', structure: null };
      continue;
    }
    for (const structure of analysis.structures) {
      const symbolsInGroup = new Set(structure.legs.map(l => l.symbol));
      const groupKey = analysis.structures.length > 1
        ? `${underlying}::${expiration}::${structure.quantity}::${structure.legs.map(l => l.symbol).sort().join(',')}`
        : bucketKey;
      groups[groupKey] = {
        rawLegs: rawLegs.filter((l: any) => symbolsInGroup.has(l.symbol)),
        ambiguous: false,
        blockMessage: null,
        structure,
      };
    }
  }

  const allOptionSymbols = optionPositions.map((p: any) => p.symbol).filter(Boolean);
  const currentPrices: Record<string, number> = {};
  const currentBids: Record<string, number> = {};
  const currentAsks: Record<string, number> = {};
  const unpriceableSymbols = new Set<string>();
  // Legs with no real two-sided market (missing bid or ask). currentBids/Asks
  // fall back to mark for these so the mid-based P&L (currentValue) still
  // works, but that fallback must NOT feed closeValue — "Close now
  // (marketable)" is only meaningful when it's actually built from a real
  // ask (short leg) / bid (long leg), not a mark masquerading as both.
  const oneSidedSymbols = new Set<string>();
  const thetaMap: Record<string, number> = {};
  const gammaMap: Record<string, number> = {};
  const deltaMap: Record<string, number> = {};
  const vegaMap:  Record<string, number> = {};
  if (allOptionSymbols.length > 0) {
    try {
      for (let i = 0; i < allOptionSymbols.length; i += 50) {
        const chunk = allOptionSymbols.slice(i, i + 50);
        const qs = chunk.map((s: string) => `equity-option=${encodeURIComponent(s)}`).join('&');
        const priceData = await ttFetch(`/market-data/by-type?${qs}`, token);
        for (const item of priceData?.data?.items ?? []) {
          const sym = item.symbol?.replace(/\s+/g, '');
          if (!sym) continue;
          const bid = parseFloat(item.bid ?? '0');
          const ask = parseFloat(item.ask ?? '0');
          const mark = parseFloat(item.mark ?? item['mark-price'] ?? '0');
          const mid = (bid + ask) / 2;
          const twoSided = bid > 0 && ask > 0;
          currentPrices[sym] = twoSided ? mid : mark > 0 ? mark : 0;
          currentBids[sym] = twoSided ? bid : mark > 0 ? mark : 0;
          currentAsks[sym] = twoSided ? ask : mark > 0 ? mark : 0;
          if (!twoSided && mark <= 0) unpriceableSymbols.add(sym);
          if (!twoSided) oneSidedSymbols.add(sym);
          const theta = parseFloat(item.theta ?? 'NaN');
          const gamma = parseFloat(item.gamma ?? 'NaN');
          const delta = parseFloat(item.delta ?? 'NaN');
          const vega  = parseFloat(item.vega  ?? 'NaN');
          if (!isNaN(theta)) thetaMap[sym] = theta;
          if (!isNaN(gamma)) gammaMap[sym] = gamma;
          if (!isNaN(delta)) deltaMap[sym] = delta;
          if (!isNaN(vega))  vegaMap[sym]  = vega;
        }
      }
    } catch {}
  }

  const ivrMap: Record<string, number | null> = {};
  const ivMap:  Record<string, number | null> = {};
  const hv30Map: Record<string, number | null> = {};
  const betaMap: Record<string, number | null> = {};
  const earningsMap: Record<string, string | null> = {};
  try {
    const underlyingSymbols: string[] = (optionPositions as any[]).map((p: any) => String(p['underlying-symbol'])).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
    const metricsData = await ttFetch(`/market-metrics?symbols=${encodeURIComponent(underlyingSymbols.join(','))}`, token);
    for (const item of metricsData?.data?.items ?? []) {
      const sym = item['symbol'];
      // IVR
      const rawIvr = item['implied-volatility-index-rank'] ?? item['iv-rank'] ?? null;
      const parsedIvr = rawIvr != null ? parseFloat(String(rawIvr)) : NaN;
      if (!isNaN(parsedIvr)) ivrMap[sym] = parsedIvr < 1 ? Math.round(parsedIvr * 100) : Math.round(parsedIvr);
      // IV (current implied volatility as %)
      const rawIv = item['implied-volatility'] ?? item['iv'] ?? item['implied-volatility-30-day'] ?? item['iv-30-day'] ?? null;
      const parsedIv = rawIv != null ? parseFloat(String(rawIv)) : NaN;
      if (!isNaN(parsedIv)) ivMap[sym] = parsedIv < 1 ? Math.round(parsedIv * 100) : Math.round(parsedIv);
      // HV30
      const rawHv = item['hv-30'] ?? item['historical-volatility-30'] ?? item['hv30'] ?? item['historical-volatility'] ?? null;
      const parsedHv = rawHv != null ? parseFloat(String(rawHv)) : NaN;
      if (!isNaN(parsedHv)) hv30Map[sym] = parsedHv < 1 ? Math.round(parsedHv * 100) : Math.round(parsedHv);
      // Debug: log raw metrics for indexes so we can see what fields come back
      if (['SPX','NDX','RUT','VIX'].includes(sym)) {
        console.log(`METRICS ${sym}:`, JSON.stringify(item).slice(0, 500));
      }
      // Beta
      const rawBeta = item['beta'] ?? item['beta-60-day'] ?? null;
      const parsedBeta = rawBeta != null ? parseFloat(String(rawBeta)) : NaN;
      if (!isNaN(parsedBeta)) betaMap[sym] = parsedBeta;
      // Earnings — next earnings date within 60 days
      const earningsRaw = item['earnings'] ?? item['next-earnings-date'] ?? null;
      if (earningsRaw) {
        const eDate = String(earningsRaw?.['expected-report-date'] ?? earningsRaw ?? '');
        if (eDate && eDate.match(/\d{4}-\d{2}-\d{2}/)) earningsMap[sym] = eDate;
      }
    }
  } catch {}

  const stockPrices: Record<string, number | null> = {};
  try {
    const underlyingSymbols: string[] = (optionPositions as any[]).map((p: any) => String(p['underlying-symbol'])).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
    const indexSymbols = underlyingSymbols.filter(s => ['SPX','NDX','RUT','VIX','DJX'].includes(s.toUpperCase()));
    const equitySymbols = underlyingSymbols.filter(s => !['SPX','NDX','RUT','VIX','DJX'].includes(s.toUpperCase()));
    const qsParts: string[] = [
      ...equitySymbols.map(s => `equity=${encodeURIComponent(s)}`),
      ...indexSymbols.map(s => `index=${encodeURIComponent(s)}`),
    ];
    if (qsParts.length > 0) {
      const stockData = await ttFetch(`/market-data/by-type?${qsParts.join('&')}`, token);
      for (const item of stockData?.data?.items ?? []) {
        const bid = parseFloat(item.bid ?? '0'); const ask = parseFloat(item.ask ?? '0');
        const mark = parseFloat(item.mark ?? item['mark-price'] ?? '0');
        const mid = (bid + ask) / 2;
        stockPrices[item.symbol] = mid > 0 ? mid : mark > 0 ? mark : 0;
      }
    }
  } catch {}

  const gtcOrders = await fetchGtcOrders(accountNumber, token);
  const gtcSymbols = new Set<string>();
  for (const order of gtcOrders) for (const leg of order.legs) {
    const parsed = parseOptionSymbol(leg.symbol);
    if (parsed.strikePrice > 0) gtcSymbols.add(leg.symbol.split(/\d{6}/)[0].trim());
  }

  try {
    const liveData = await Promise.allSettled([
      ttFetch(`/accounts/${accountNumber}/orders/live`, token),
    ]);
    const allOrders = (liveData[0].status === 'fulfilled' ? liveData[0].value?.data?.items : null) ?? [];
    for (const order of allOrders) {
      const status = (order['status'] ?? '').toLowerCase();
      if (['working', 'live', 'contingent', 'received', 'pending', 'queued'].includes(status)) {
        for (const leg of order.legs ?? []) {
          const sym = leg['underlying-symbol'] ?? leg.symbol ?? '';
          if (sym) gtcSymbols.add(sym.split(' ')[0].trim());
        }
      }
    }
  } catch {}

  const pendingOrders: PendingOrder[] = [];
  try {
    const complexData = await fetchAllComplexOrders(accountNumber, token);
    for (const order of complexData?.data?.items ?? []) {
      // Parent OCO envelope has no status/tif/type — check nested sub-orders instead
      const nestedOrders: any[] = order.orders ?? [];
      const hasActiveNested = nestedOrders.some(no => {
        const s = (no['status'] ?? '').toLowerCase();
        return ['working', 'live', 'contingent', 'received', 'routed', 'pending', 'queued'].includes(s);
      });
      // Also accept if parent has no terminal-at (still open) and has nested orders
      const parentActive = !order['terminal-at'] && nestedOrders.length > 0;
      console.log(`COMPLEX ORDER: id=${order.id} hasActiveNested=${hasActiveNested} parentActive=${parentActive} nestedStatuses=${nestedOrders.map((o:any) => o['status']).join(',')}`);
      if (hasActiveNested || parentActive) {
        for (const nestedOrder of nestedOrders) for (const leg of nestedOrder.legs ?? []) {
          // Prefer underlying-symbol; fall back to parsing the OCC option symbol
          const underlying = leg['underlying-symbol'];
          if (underlying) {
            const sym = underlying.split(' ')[0].trim();
            gtcSymbols.add(sym);
            // Also add SPX↔SPXW variants
            if (sym === 'SPXW') gtcSymbols.add('SPX');
            if (sym === 'SPX') gtcSymbols.add('SPXW');
            console.log(`COMPLEX LEG underlying=${underlying} added=${sym}`);
          } else if (leg.symbol) {
            // OCC format: SPX   260726P07290000 — split on first digit sequence
            const fromOcc = leg.symbol.split(/\d{6}/)[0].trim();
            if (fromOcc) {
              gtcSymbols.add(fromOcc);
              if (fromOcc === 'SPXW') gtcSymbols.add('SPX');
              if (fromOcc === 'SPX') gtcSymbols.add('SPXW');
              console.log(`COMPLEX LEG occ=${leg.symbol} added=${fromOcc}`);
            }
          }
        }

        // Pending entry order detection: the trigger leg of an OTOCO opening
        // order uses Sell to Open / Buy to Open. GTC profit-target and stop
        // legs on an already-open position use Buy to Close / Sell to Close
        // -- those are tracked via Position.hasGtc/gtcOrderId elsewhere, not
        // here. Only treat this complex order as "pending" if it's still
        // active overall AND its trigger order's legs are opening actions.
        if (hasActiveNested || parentActive) {
          const triggerOrder = order['trigger-order'] ?? nestedOrders[0];
          const triggerLegs: any[] = triggerOrder?.legs ?? [];
          const triggerIsOpening = triggerLegs.length > 0 && triggerLegs.every((l: any) => {
            const action = String(l.action ?? '');
            return action === 'Sell to Open' || action === 'Buy to Open';
          });
          // Roll OTOCO: the trigger is a CLOSE (Buy/Sell to Close) and the
          // contingent orders[] carry the opening legs. When the trigger is a
          // close, read the opening legs from the first contingent order whose
          // legs are all opening actions, and surface THAT as the pending entry.
          const triggerIsClosing = triggerLegs.length > 0 && triggerLegs.every((l: any) => {
            const action = String(l.action ?? '');
            return action === 'Buy to Close' || action === 'Sell to Close';
          });
          const contingentOpen = triggerIsClosing
            ? (nestedOrders ?? []).find((o: any) => {
                const ls: any[] = o?.legs ?? [];
                return ls.length > 0 && ls.every((l: any) => {
                  const a = String(l.action ?? '');
                  return a === 'Sell to Open' || a === 'Buy to Open';
                });
              })
            : null;
          // openingSource is whichever order actually holds the opening legs we
          // want to display as the pending entry (trigger for entry OTOCOs,
          // contingent for roll OTOCOs).
          const openingSource = triggerIsOpening ? triggerOrder : contingentOpen;
          const isOpeningOrder = Boolean(openingSource);
          // A filled trigger means the entry already executed -- the position is
          // now live and tracked in the positions list, so it must NOT appear as a
          // pending entry. In an OTOCO the trigger can be Filled while the OCO
          // bracket legs are still Live, which keeps hasActiveNested true; without
          // this check the filled opening order leaks into Pending Orders.
          const openingStatus = String(openingSource?.status ?? '').toLowerCase();
          const openingIsTerminal = ['filled', 'cancelled', 'canceled', 'rejected', 'expired', 'removed'].includes(openingStatus);
          const openingLegs: any[] = openingSource?.legs ?? [];
          if (isOpeningOrder && !openingIsTerminal) {
            const parsedLegs: PendingOrderLeg[] = openingLegs.map((l: any) => {
              const occSymbol = String(l.symbol ?? '');
              const parsed = parseOptionSymbol(occSymbol);
              return {
                symbol: occSymbol,
                action: String(l.action ?? ''),
                optionType: parsed.strikePrice > 0 ? parsed.optionType : null,
                strikePrice: parsed.strikePrice,
                quantity: Number(l.quantity ?? 1),
              };
            });
            const putLegs = parsedLegs.filter(l => l.optionType === 'P');
            const callLegs = parsedLegs.filter(l => l.optionType === 'C');
            let strategy = 'UNKNOWN';
            if (putLegs.length >= 2 && callLegs.length === 0) strategy = 'BPS';
            else if (callLegs.length >= 2 && putLegs.length === 0) strategy = 'BCS';
            else if (putLegs.length >= 2 && callLegs.length >= 2) strategy = 'IC';
            const underlyingSymbol =
              openingSource?.['underlying-symbol'] ??
              (parsedLegs[0]?.symbol ? parsedLegs[0].symbol.split(/\d{6}/)[0].trim() : null);
            const expMatch = parsedLegs[0]?.symbol?.match(/(\d{6})[CP]\d{8}/);
            const expDate = expMatch
              ? `20${expMatch[1].slice(0, 2)}-${expMatch[1].slice(2, 4)}-${expMatch[1].slice(4, 6)}`
              : null;
            pendingOrders.push({
              id: String(order.id ?? ''),
              accountNumber,
              symbol: underlyingSymbol ?? 'UNKNOWN',
              strategy,
              legs: parsedLegs,
              expDate,
              limitPrice: openingSource?.price != null ? parseFloat(openingSource.price) : null,
              priceEffect: openingSource?.['price-effect'] ?? null,
              status: openingSource?.status ?? order['status'] ?? 'unknown',
              createdAt: openingSource?.['received-at'] ?? openingSource?.['updated-at'] ?? null,
              orderType: openingSource?.['order-type'] ?? null,
              timeInForce: openingSource?.['time-in-force'] ?? null,
            });
          }
        }
      }
    }
  } catch {}

  const plBySymbol: Record<string, number> = {};
  try {
    const plData = await ttFetch(`/accounts/${accountNumber}/positions?include-marks=true`, token);
    for (const item of plData?.data?.items ?? []) {
      const sym = item['underlying-symbol']; if (!sym) continue;
      const expDate = item['expires-at']?.slice(0, 10) ?? 'unknown';
      const key = `${sym}::${expDate}`;
      const qty = parseFloat(item['quantity'] ?? '1');
      const multiplier = parseFloat(item['multiplier'] ?? '100');
      const avgOpen = parseFloat(item['average-open-price'] ?? '0');
      const markRaw = parseFloat(item['mark-price'] ?? '0');
      const closeRaw = parseFloat(item['close-price'] ?? '0');
      const mark = markRaw !== 0 ? markRaw : closeRaw;
      const dir = item['quantity-direction'] === 'Short' ? -1 : 1;
      plBySymbol[key] = (plBySymbol[key] ?? 0) + dir * (mark - avgOpen) * qty * multiplier;
    }
  } catch {}

  let profitTargets: Record<string, number> = {};
  try { profitTargets = JSON.parse(localStorage.getItem(LS_PROFIT_TARGETS) ?? '{}'); } catch {}

  // ── POP (probability of profit) ──────────────────────────────────────
  // Breakeven-based estimate under lognormal price assumption, same approach
  // as app/screener/page.tsx's calcSpreadPop. Extended here to cover every
  // strategy type that can appear in an open portfolio (CSP included, plus
  // the two-sided IC case), since screener only ever quotes new BPS/BCS.
  const positionNormalCdf = (x: number): number => {
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
  };

  // POP that price stays above a lower breakeven (short put / put-side breach level).
  const positionPopAbove = (price: number, breakeven: number, dte: number, ivPct: number): number => {
    const sigma = ivPct / 100;
    const t = dte / 365;
    const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
    return positionNormalCdf(d2) * 100;
  };

  // POP that price stays below an upper breakeven (short call / call-side breach level).
  const positionPopBelow = (price: number, breakeven: number, dte: number, ivPct: number): number => {
    const sigma = ivPct / 100;
    const t = dte / 365;
    const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
    return (1 - positionNormalCdf(d2)) * 100;
  };

  const calcPositionPop = (
    strategy: string,
    legs: PositionLeg[],
    price: number | null,
    creditReceived: number,
    dte: number,
    ivPct: number | null
  ): number | null => {
    if (price == null || price <= 0 || ivPct == null || ivPct <= 0 || dte <= 0) return null;

    const creditPerShare = Math.abs(creditReceived) / 100;
    const shortPut = legs.find(l => l.optionType === 'P' && l.direction === 'Short');
    const shortCall = legs.find(l => l.optionType === 'C' && l.direction === 'Short');

    if (strategy === 'PUT' || strategy === 'BPS') {
      if (!shortPut) return null;
      const breakeven = shortPut.strikePrice - creditPerShare;
      if (breakeven <= 0) return null;
      return positionPopAbove(price, breakeven, dte, ivPct);
    }

    if (strategy === 'CALL' || strategy === 'BCS') {
      if (!shortCall) return null;
      const breakeven = shortCall.strikePrice + creditPerShare;
      return positionPopBelow(price, breakeven, dte, ivPct);
    }

    if (strategy === 'IC') {
      if (!shortPut || !shortCall) return null;
      // IC profits only while price stays between both breakevens. Total
      // credit is split across both sides for a conservative breakeven
      // estimate (matches how max profit is realized at expiration).
      const putBreakeven = shortPut.strikePrice - creditPerShare / 2;
      const callBreakeven = shortCall.strikePrice + creditPerShare / 2;
      if (putBreakeven <= 0) return null;
      const popAbovePut = positionPopAbove(price, putBreakeven, dte, ivPct);
      const popBelowCall = positionPopBelow(price, callBreakeven, dte, ivPct);
      // Probability of staying inside the range: sum of both one-sided
      // breach probabilities subtracted from 100, floored at 0.
      return Math.max(0, popAbovePut + popBelowCall - 100);
    }

    return null;
  };

  let intentOverrides: Record<string, PositionIntent> = {};
  try {
    const intentRes = await fetch('/api/position-intent');
    if (intentRes.ok) intentOverrides = (await intentRes.json())?.intents ?? {};
  } catch {}

  const today = new Date();
  let positions: Position[] = Object.entries(groups).map(([key, group]) => {
    const { rawLegs: legs, ambiguous, blockMessage, structure } = group;
    const [symbol, expDate] = key.split('::');
    const dte = Math.round((new Date(expDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const openedAt = legs[0]?.['created-at']?.slice(0, 10) ?? null;
    const entryDte = openedAt ? Math.round((new Date(expDate).getTime() - new Date(openedAt).getTime()) / (1000 * 60 * 60 * 24)) : dte;

    // ES-0001 (corrective round): strategy label now comes from the
    // resolved, unambiguous structure (strategyLabelForStructure), not a
    // leg-count guess. For an ambiguous/unsupported group there is no single
    // structure to label -- fall back to the old leg-count heuristic PURELY
    // for the card's display text; this label is never used for any safety
    // decision (structureAmbiguous gates every action regardless of label).
    let strategy = 'UNKNOWN';
    if (structure) {
      strategy = strategyLabelForStructure(structure);
    } else {
      const putLegs = legs.filter((l: any) => parseOptionSymbol(l.symbol).optionType === 'P');
      const callLegs = legs.filter((l: any) => parseOptionSymbol(l.symbol).optionType === 'C');
      if (putLegs.length >= 2 && callLegs.length === 0) strategy = 'BPS';
      else if (callLegs.length >= 2 && putLegs.length === 0) strategy = 'BCS';
      else if (putLegs.length >= 2 && callLegs.length >= 2) strategy = 'IC';
      else if (putLegs.length === 1) strategy = 'PUT';
      else if (callLegs.length === 1) strategy = 'CALL';
    }

    const positionLegs: PositionLeg[] = legs.map((l: any) => {
      const parsed = parseOptionSymbol(l.symbol);
      return {
        symbol: l.symbol, optionType: parsed.optionType, strikePrice: parsed.strikePrice,
        direction: l['quantity-direction'] as 'Short' | 'Long',
        quantity: parseInt(l['quantity'] ?? '1', 10),
        avgOpenPrice: parseFloat(l['average-open-price'] ?? '0'),
        currentPrice: currentPrices[l.symbol?.replace(/\s+/g, '')] ?? null,
      };
    });

    const creditReceived = calculateSpreadCredit(positionLegs);

    // ES-0001 (corrective round): the canonical close-order identity is
    // built directly from the resolved structure's own legs/economics, NOT
    // from this aggregate `creditReceived` -- `buildCanonicalCloseIdentity`
    // computes signed entry economics itself (fixing the pre-existing
    // Math.max(0,...) debit-flooring defect) and BLOCKS rather than
    // fabricates when they are invalid. `identity` is the ONLY source any
    // close/roll/stop-loss/take-profit/cut-losses/snap-to-breakeven action
    // may read economics or quantity from.
    let identity: CanonicalCloseIdentity | null = null;
    let structureAmbiguous = ambiguous;
    let structureBlockMessage: string | null = blockMessage;
    if (!ambiguous && structure) {
      const idResult = buildCanonicalCloseIdentity(structure, key, symbol, expDate);
      if (idResult.ok) {
        identity = idResult.identity;
      } else {
        structureAmbiguous = true;
        structureBlockMessage = `${idResult.ruleId}: ${idResult.message}`;
      }
    }

    // `Position.quantity` is retained ONLY for backward-compatible display
    // (card leg-count text, etc.) -- mirrors identity.quantity when known,
    // never independently authoritative. See the Position interface's doc
    // comment.
    const canonicalQuantity = identity?.quantity ?? (Math.abs(positionLegs[0]?.quantity ?? 1) || 1);

    // General mark value (mid) — used for ongoing P/L tracking, badges, and
    // rule logic throughout the app. NOT what you'd actually realize by closing.
    let currentValue = 0; let hasCurrentPrices = true;
    for (const leg of legs) {
      const qty = parseInt(leg['quantity'] ?? '1', 10);
      const price = currentPrices[leg.symbol?.replace(/\s+/g, '')];
      if (price == null) { hasCurrentPrices = false; break; }
      currentValue += leg['quantity-direction'] === 'Short' ? price * qty : -(price * qty);
    }
    currentValue = currentValue * 100;

    // Marketable "if I closed now" value — same convention as fetchCloseQuote:
    // Buy to Close (short leg) fills at ask; Sell to Close (long leg) fills at bid.
    // This is the number that should match the close/cut-losses modal exactly.
    // Requires a REAL two-sided market on every leg — currentAsks/currentBids
    // fall back to mark when a leg is one-sided (see population above), and
    // using that fallback here would silently turn "marketable" into "mid,"
    // which can make it equal to or even better than Buyback (mid). Better to
    // show '—' than a close-now number that isn't actually a worse-case fill.
    let closeValue = 0; let hasCloseValue = true;
    for (const leg of legs) {
      const qty = parseInt(leg['quantity'] ?? '1', 10);
      const sym = leg.symbol?.replace(/\s+/g, '');
      if (oneSidedSymbols.has(sym)) { hasCloseValue = false; break; }
      const isShort = leg['quantity-direction'] === 'Short';
      const price = isShort ? currentAsks[sym] : currentBids[sym];
      if (price == null || price <= 0) { hasCloseValue = false; break; }
      closeValue += isShort ? price * qty : -(price * qty);
    }
    closeValue = closeValue * 100;

    const anyLegUnpriceable = legs.some(
      (l: any) => unpriceableSymbols.has(l.symbol?.replace(/\s+/g, ''))
    );
    const pnlReliable = hasCurrentPrices && !anyLegUnpriceable;
    const defaultIntent: PositionIntent = strategy === 'PUT' ? 'acquisition' : 'income';
    const intent: PositionIntent = intentOverrides[key] ?? defaultIntent;
    const pnl = hasCurrentPrices ? Math.abs(creditReceived) - Math.abs(currentValue) : null;
    const pnlPct = creditReceived !== 0 && pnl != null ? (pnl / Math.abs(creditReceived)) * 100 : null;
    const profitTarget = profitTargets[key] ?? 0.5;
    const targetPrice = Math.abs(creditReceived) * profitTarget;
    const hitTarget = hasCurrentPrices && pnl != null && pnl >= Math.abs(creditReceived) * profitTarget;

    const stopLoss = classifyPositionStopLoss({ legs: positionLegs, creditReceived: Math.abs(creditReceived), quantity: canonicalQuantity }, gtcOrders);

    // Only treat earnings as relevant if it occurs on or before this position's expiration.
    // Tastytrade market-metrics can return the next earnings date within ~60 days;
    // that is NOT the same as "earnings within expiry."
    const rawEarningsDate = earningsMap[symbol] ?? null;
    // Use string comparison (YYYY-MM-DD) — avoids UTC midnight timezone shifts
    // that cause new Date() comparisons to misclassify same-day or next-day earnings
    const earningsWithinExpiry =
      rawEarningsDate &&
      rawEarningsDate >= new Date().toISOString().slice(0, 10) &&
      rawEarningsDate <= expDate
        ? rawEarningsDate
        : null;

    return {
      key, symbol, expDate, dte, strategy, legs: positionLegs,
      quantity: canonicalQuantity,
      identity,
      structureAmbiguous,
      structureBlockMessage,
      creditReceived: Math.abs(creditReceived),
      currentValue: hasCurrentPrices ? Math.abs(currentValue) : null,
      closeValue: hasCloseValue ? Math.abs(closeValue) : null,
      closeNowPnl: hasCloseValue ? Math.abs(creditReceived) - Math.abs(closeValue) : null,
      pnl, pnlPct, pnlReliable, intent, targetPrice, profitTarget, hitTarget,
      plOpen: plBySymbol[key] != null ? Math.round(plBySymbol[key] * 100) / 100 : null,
      maxRisk: calculateMaxRisk(positionLegs, creditReceived, strategy),
      entryDte, entryDate: openedAt,
      // needsClose (the hard 21-DTE close-or-roll rule) applies ONLY to
      // defined-risk spreads. A CSP is never "close now" — assignment is a valid
      // outcome (especially under acquire intent), so CSPs get their own banner.
      needsClose: (() => {
        const puts = positionLegs.filter(l => l.optionType === 'P');
        const calls = positionLegs.filter(l => l.optionType === 'C');
        const shortPuts = puts.filter(l => l.direction === 'Short');
        const isCsp = shortPuts.length > 0 && puts.filter(l => l.direction === 'Long').length === 0 && calls.length === 0;
        return !isCsp && entryDte > 21 && dte <= 21;
      })(),
      accountNumber,
      ivr: ivrMap[symbol] ?? null,
      iv: ivMap[symbol] ?? null,
      hv30: hv30Map[symbol] ?? null,
      beta: betaMap[symbol] ?? null,
      pop: calcPositionPop(strategy, positionLegs, stockPrices[symbol] ?? null, creditReceived, dte, ivMap[symbol] ?? null),
      earningsDate: earningsWithinExpiry,
      hasGtc: (() => {
        // Check both the position symbol and its weekly option variant
        // SPX positions may have SPXW option legs; SPXW positions may have SPXW legs
        if (gtcSymbols.has(symbol)) { console.log(`HASGТС ${symbol}: direct match`); return true; }
        // Map underlying to possible OCC prefix variants
        const variants: Record<string, string> = { 'SPX': 'SPXW', 'NDX': 'NDXP', 'RUT': 'RUTW', 'VIX': 'VIXW' };
        const reverseVariants: Record<string, string> = { 'SPXW': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT', 'VIXW': 'VIX' };
        const variant = variants[symbol] ?? reverseVariants[symbol];
        const result = variant ? gtcSymbols.has(variant) : false;
        console.log(`HASGTC ${symbol}: variant=${variant} result=${result} gtcSymbols=[${Array.from(gtcSymbols).join(',')}]`);
        return result;
      })(),
      gtcOrderId: (() => {
        const match = findProfitGtcOrder(positionLegs, gtcOrders);
        return match?.id ?? null;
      })(),
      gtcComplexOrderId: (() => {
        const match = findProfitGtcOrder(positionLegs, gtcOrders);
        return match?.complexOrderId ?? null;
      })(),
      gtcOrderPrice: (() => {
        const match = findProfitGtcOrder(positionLegs, gtcOrders);
        return match ? parseFloat(match.price) || null : null;
      })(),
      stopLossStatus: stopLoss.status, stopLossPrice: stopLoss.price,
      stockPrice: stockPrices[symbol] ?? null,
      buffer: (() => {
        const stock = stockPrices[symbol];
        if (stock == null) return null;
        const shorts = legs.filter((l: any) => l['quantity-direction'] === 'Short');
        if (!shorts[0]) return null;
        const shortStrike = parseOptionSymbol(shorts[0].symbol).strikePrice;
        const optType = parseOptionSymbol(shorts[0].symbol).optionType;
        return optType === 'P' ? ((stock - shortStrike) / stock) * 100 : ((shortStrike - stock) / stock) * 100;
      })(),
      theta: (() => {
        let net = 0; let any = false;
        for (const l of legs) {
          const val = thetaMap[l.symbol?.replace(/\s+/g, '')];
          if (val == null) continue;
          const qty = parseInt(l['quantity'] ?? '1', 10);
          net += l['quantity-direction'] === 'Short' ? Math.abs(val) * qty : -Math.abs(val) * qty;
          any = true;
        }
        return any ? parseFloat(net.toFixed(4)) : null;
      })(),
      gamma: (() => {
        let net = 0; let any = false;
        for (const l of legs) {
          const val = gammaMap[l.symbol?.replace(/\s+/g, '')];
          if (val == null) continue;
          const qty = parseInt(l['quantity'] ?? '1', 10);
          net += l['quantity-direction'] === 'Short' ? -Math.abs(val) * qty : Math.abs(val) * qty;
          any = true;
        }
        return any ? parseFloat(net.toFixed(4)) : null;
      })(),
      netDelta: (() => {
        let net = 0; let any = false;
        for (const l of legs) {
          const val = deltaMap[l.symbol?.replace(/\s+/g, '')];
          if (val == null) continue;
          const qty = parseInt(l['quantity'] ?? '1', 10);
          net += l['quantity-direction'] === 'Short' ? -val * qty : val * qty;
          any = true;
        }
        return any ? parseFloat(net.toFixed(4)) : null;
      })(),
      netVega: (() => {
        let net = 0; let any = false;
        for (const l of legs) {
          const val = vegaMap[l.symbol?.replace(/\s+/g, '')];
          if (val == null) continue;
          const qty = parseInt(l['quantity'] ?? '1', 10);
          net += l['quantity-direction'] === 'Short' ? -Math.abs(val) * qty : Math.abs(val) * qty;
          any = true;
        }
        return any ? parseFloat(net.toFixed(4)) : null;
      })(),
    };
  });

  positions = await attachEntrySnapshots(positions);

  const actionPriority: Record<string, number> = { CLOSE_ROLL: 0, CUT_LOSSES: 1, TAKE_PROFIT: 2, MANAGE: 3, WATCH: 4, HOLD: 5 };
  positions.sort((a, b) => {
    if (a.needsClose && !b.needsClose) return -1;
    if (!a.needsClose && b.needsClose) return 1;
    const aRec = getRecommendation(a, null).action;
    const bRec = getRecommendation(b, null).action;
    const aPri = actionPriority[aRec] ?? 9;
    const bPri = actionPriority[bRec] ?? 9;
    if (aPri !== bPri) return aPri - bPri;
    return a.dte - b.dte;
  });
  return { positions, pendingOrders };
}


// PI-0003.5: reuses the exact same account-lookup pattern as loadPositions()
// above and app/engine/page.tsx's capital calculator -- same endpoint
// (/accounts/{account}/balances) both of those already call independently.
// Parsing is delegated entirely to buildPortfolioFinancialContext() (pure,
// testable, lives in lib/portfolio-intelligence) so this function is just
// "fetch the raw payload, hand it to the parser."
export async function loadAccountBalances(): Promise<PortfolioFinancialContext> {
  const token = await getAccessToken();
  const accountsData = await ttFetch('/customers/me/accounts', token);
  const account = accountsData?.data?.items?.find((a: any) => a.account['account-number'] === '5WI51392')
    ?? accountsData?.data?.items?.[0];
  const accountNumber = account?.account?.['account-number'];
  if (!accountNumber) throw new Error('No account found');

  const balData = await ttFetch(`/accounts/${accountNumber}/balances`, token);
  return buildPortfolioFinancialContext(balData?.data ?? {});
}


// Returns true when this was intentionally entered as a short-dated trade
export function isShortDateEntry(pos: Position): boolean {
  return pos.entryDte <= 21;
}


export function getRecommendation(pos: Position, trend: TrendResult | null): Recommendation {
  const pnlPct = pos.pnl != null && pos.creditReceived !== 0 ? (pos.pnl / pos.creditReceived) * 100 : 0;
  const targetPct = pos.profitTarget * 100;
  const trendAgainst = trend && ((pos.strategy === 'BPS' && trend.trend === 'downtrend') || (pos.strategy === 'BCS' && trend.trend === 'uptrend'));
  const trendAligns = trend && ((pos.strategy === 'BPS' && trend.trend === 'uptrend') || (pos.strategy === 'BCS' && trend.trend === 'downtrend') || (pos.strategy === 'IC' && trend.trend === 'sideways'));
  const shortDate = isShortDateEntry(pos);
  const breached = pos.buffer != null && pos.buffer <= 0;
  const criticalBuffer = pos.buffer != null && pos.buffer < 2;
  // PI-0014: marketable/executable pnl% -- see computeMarketablePnlPct's
  // doc comment above. Null when closeValue is unavailable.
  const marketablePnlPct = computeMarketablePnlPct(pos);
  // Emergency exit: fires on EITHER mid or marketable evidence -- marketable
  // pricing can only make this fire more often, never less, so an
  // already-conservative mid-based verdict is never weakened. See
  // docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.
  const veryLargeLoss = pnlPct <= -200 || (marketablePnlPct != null && marketablePnlPct <= -200);
  const shortQty = pos.quantity; // ES-0001: canonical quantity, not an arbitrary leg
  // stopLossPrice is a per-spread/per-contract option price (e.g. 1.56 = $156 per contract).
  // currentValue is the total buyback value for the whole position, so scale the stop by contracts.
  // PI-0014: stop-loss detection now checks EITHER the mid buyback value or
  // the marketable/executable buyback value -- a stop-loss is an execution
  // order, so it must be evaluated against execution reality, not just the
  // theoretical mark. This can only make the stop fire more often, never
  // less (an already-breached mid stop is never un-breached by marketable
  // pricing).
  const stopLossBreachedMid = pos.stopLossPrice != null && pos.currentValue != null && shortQty > 0
    ? pos.currentValue >= (pos.stopLossPrice * 100 * shortQty)
    : false;
  const stopLossBreachedMarketable = pos.stopLossPrice != null && pos.closeValue != null && shortQty > 0
    ? pos.closeValue >= (pos.stopLossPrice * 100 * shortQty)
    : false;
  const stopLossBreached = stopLossBreachedMid || stopLossBreachedMarketable;

  // needsClose only fires for standard entries (entryDte > 21) — short-dated entries skip this
  if (pos.needsClose && pnlPct >= 0) return { action: 'CLOSE_ROLL', detail: `${pos.dte} DTE — close or roll to next expiry` };
  if (pos.needsClose && pnlPct < 0)  return { action: 'MANAGE', detail: `${pos.dte} DTE with loss — review close/roll, don't auto-cut` };

  // Acquisition-intent CSP: ITM / paper loss is the plan working, not a risk signal.
  // Skip all breach/stop/loss-based hard exits — hold to expiration for assignment.
  const isAcquisitionCsp = pos.strategy === 'PUT' && pos.intent === 'acquisition';
  if (isAcquisitionCsp) {
    if (breached) return { action: 'HOLD', detail: `ITM — on track for assignment, holding to expiration` };
    return { action: 'HOLD', detail: `${pnlPct.toFixed(0)}% paper — acquisition intent, hold for assignment or expiry` };
  }

  // Hard exits: breached strike, explicit stop breach, or very large loss.
  if (breached) return { action: 'CUT_LOSSES', detail: `Short strike breached — exit or roll immediately` };
  if (stopLossBreached) return { action: 'CUT_LOSSES', detail: `Stop threshold reached — follow the risk plan` };
  if (veryLargeLoss && trendAgainst) return { action: 'CUT_LOSSES', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% and trend is adverse — exit or roll` };

  // Short-dated entry: maximize profit, but do not treat ordinary red P/L as a failure.
  if (shortDate) {
    if (pos.hitTarget) return { action: 'TAKE_PROFIT', detail: `${Math.round(targetPct)}% target hit — take it, no time to wait` };
    if (pnlPct >= 30 && pos.dte <= 7)  return { action: 'TAKE_PROFIT', detail: `${pnlPct.toFixed(0)}% profit at ${pos.dte} DTE — take profit now, gamma risk rising` };
    if (pnlPct >= 40)                  return { action: 'TAKE_PROFIT', detail: `${pnlPct.toFixed(0)}% profit — solid capture for short-dated trade` };
    if (!pos.hasGtc)                   return { action: 'PLACE_GTC', detail: 'Short-dated trade — place GTC immediately' };
    if (criticalBuffer && pnlPct < 0)  return { action: 'MANAGE', detail: `${pos.buffer?.toFixed(1)}% buffer with ${pos.dte} DTE — manage closely, not automatic cut` };
    if (pnlPct < -100 && trendAgainst) return { action: 'MANAGE', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% + adverse trend — review exit/roll` };
    if (pos.dte <= 3)                  return { action: 'TAKE_PROFIT', detail: `${pos.dte} DTE — expiry imminent, close to avoid pin/assignment risk` };
    if (trendAgainst)                  return { action: 'MANAGE', detail: `Trend against position with only ${pos.dte} DTE — watch closely` };
    if (pnlPct < 0)                    return { action: 'HOLD', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% — ${pos.dte} DTE, monitor buffer/theta` };
    return { action: 'HOLD', detail: `${pnlPct.toFixed(0)}% profit — ${pos.dte} DTE, short-dated, let theta work` };
  }

  // Standard entry
  if (pos.hitTarget)                  return { action: 'TAKE_PROFIT', detail: `${Math.round(targetPct)}% target — lock in $${pos.pnl?.toFixed(2)}` };
  if (!pos.hasGtc)                    return { action: 'PLACE_GTC', detail: 'No GTC order set — place profit target' };
  if (pnlPct < -150 && trendAgainst) return { action: 'CUT_LOSSES', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% + adverse trend confirms — exit` };
  if (pnlPct < -50 && trendAgainst)  return { action: 'MANAGE', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% with adverse trend — manage actively` };
  if (pnlPct < -50)                  return { action: 'MANAGE', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% — manage actively` };
  if (pnlPct >= targetPct)           return { action: 'TAKE_PROFIT', detail: `${pnlPct.toFixed(0)}% profit` };
  if (pnlPct < 0 && trendAgainst)    return { action: 'MANAGE', detail: `Down ${Math.abs(pnlPct).toFixed(0)}% with adverse trend` };
  if (trendAligns)                   return { action: 'HOLD', detail: `Trend confirms ${pos.strategy} — ${pnlPct.toFixed(0)}% profit` };
  return { action: 'HOLD', detail: `${pnlPct.toFixed(0)}% profit — ${pos.dte} DTE remaining` };
}


export function normalizePercentValue(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  // Some APIs store probability as 0.78, others as 78.
  return Math.abs(value) <= 1 ? value * 100 : value;
}


export function getCurrentPop(pos: Position): number | null {
  const raw =
    (pos as any).pop ??
    (pos as any).probabilityOfProfit ??
    (pos as any).probabilityOfProfitPct ??
    (pos as any).popPct ??
    null;

  return normalizePercentValue(raw);
}


// ── Net Daily Edge (theta vs gamma) ────────────────────────────────────────
// The dollars/day you collect from decay (theta) minus the expected dollars/day
// gamma costs you via price movement. Positive = paid to hold; approaching $0 =
// gamma catching up (get-out signal); negative = gamma winning.
//
// theta and gamma here are already whole-position, per-contract * qty dollar
// figures (see loadPositions), and on the same unit basis, so NO x100 multiplier
// is applied. Treat the absolute value as a directional estimate; the peak/trend
// behavior is robust to any constant scaling.
export const TRADING_DAYS = 252;


export function netEdgeFrom(
  theta: number | null,
  gamma: number | null,
  iv: number | null,
  stockPrice: number | null,
): number | null {
  if (theta == null || gamma == null || iv == null || stockPrice == null) return null;
  // theta and gamma are stored as RAW per-share Greeks (x qty). To get whole-
  // position dollars they must be multiplied by the 100 option multiplier — the
  // same x100 the Theta column applies for display. Without it, net edge
  // collapses to ~$0 for every position.
  const MULT = 100;
  // 1-sigma daily dollar move from IV (iv is a whole-number percent, e.g. 41).
  const dailyMove = stockPrice * (iv / 100) * Math.sqrt(1 / TRADING_DAYS);
  const thetaDollars = theta * MULT;
  const gammaCostDollars = 0.5 * Math.abs(gamma) * dailyMove * dailyMove * MULT;
  return thetaDollars - gammaCostDollars;
}


export function netEdgeLive(pos: Position): number | null {
  return netEdgeFrom(pos.theta, pos.gamma, pos.iv, pos.stockPrice);
}


// Net edge over this position's snapshot history, oldest-first, nulls dropped.
export function netEdgeSeries(pos: Position): { date: string; value: number }[] {
  const hist = pos.snapshotHistory ?? [];
  const out: { date: string; value: number }[] = [];
  for (const s of hist) {
    const v = netEdgeFrom(s.theta, s.gamma, s.iv, s.stockPrice);
    if (v != null) out.push({ date: s.date, value: v });
  }
  return out;
}


// Peak net edge this position has ever reached (history + today's live value).
export function netEdgePeak(pos: Position): number | null {
  const series = netEdgeSeries(pos).map(p => p.value);
  const live = netEdgeLive(pos);
  if (live != null) series.push(live);
  if (series.length === 0) return null;
  return Math.max(...series);
}
