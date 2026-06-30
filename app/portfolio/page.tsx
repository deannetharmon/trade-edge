// app/portfolio/page.tsx

'use client';
import { THEMES, ACCENTS, Theme, Accent, LS_THEME, LS_ACCENT, getSavedTheme, getSavedAccent, applyAccent, injectAccentStyle } from '@/lib/theme';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  classifyPositionLifecycle,
} from '@/lib/portfolio/positionLifecycle';


// Inject accent CSS variable style
if (typeof document !== 'undefined') {
  if (!document.getElementById('hunter-accent-style')) {
    const style = document.createElement('style');
    style.id = 'hunter-accent-style';
    style.textContent = `
      :root { --accent: #3b82f6; --accent-r: 59; --accent-g: 130; --accent-b: 246; }
      .accent-border { border-color: var(--accent) !important; }
      .accent-text { color: var(--accent) !important; }
      .accent-bg { background-color: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.1) !important; }
      .accent-ring { box-shadow: 0 0 0 1px var(--accent) !important; }
      nav a.active-nav, nav span.active-nav { background: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.2); color: var(--accent); }
    `;
    document.head.appendChild(style);
  }
}

// Inject DM Sans font
if (typeof document !== 'undefined') {
  if (!document.getElementById('hunter-font')) {
    const link = document.createElement('link');
    link.id = 'hunter-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }
}

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
const LS_PROFIT_TARGETS = 'hunter-profit-targets';
const LS_AUDIT_LOG = 'hunter-audit-log';
const LS_MEMORY = 'hunter-trading-memory';
const LS_DRY_RUN = 'hunter-dry-run';
const LS_ENTRY_SNAPSHOTS = 'hunter-entry-snapshots';
const LS_SECTION_ORDER = 'hunter-portfolio-section-order';
const DEFAULT_SECTION_ORDER = ['pending', 'needsClose', 'review', 'hitTarget', 'noGtc', 'normal'];
const MEMORY_RAW_TRADES_PER_SYMBOL = 5;   // keep this many raw; summarize older
const MEMORY_RAW_ACTIONS = 20;            // ring buffer size for action history
const MEMORY_SUMMARIZE_INTERVAL_DAYS = 7; // re-summarize behavior weekly
const STALE_PRICE_THRESHOLD = 0.15; // 15% move triggers warning
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 30;
const MARKET_CLOSE_HOUR = 16;

function isDryRun(): boolean {
  try { return localStorage.getItem(LS_DRY_RUN) === 'true'; } catch { return false; }
}
function setDryRun(val: boolean) {
  try { val ? localStorage.setItem(LS_DRY_RUN, 'true') : localStorage.removeItem(LS_DRY_RUN); } catch {}
}

// ── Types ──────────────────────────────────────────────────────────────────
type ActionType = 'HOLD' | 'WATCH' | 'MANAGE' | 'TAKE_PROFIT' | 'CUT_LOSSES' | 'CLOSE_ROLL' | 'PLACE_GTC';

interface PositionLeg {
  symbol: string;
  optionType: 'P' | 'C';
  strikePrice: number;
  direction: 'Short' | 'Long';
  quantity: number;
  avgOpenPrice: number;
  currentPrice: number | null;
}

// Trader's reference point for AI analysis. Auto-defaulted from strategy
// (lone short put -> acquisition, everything else -> income) and overridable
// per position; persisted in Redis via /api/position-intent.
type PositionIntent = 'income' | 'acquisition' | 'neutral';

interface Position {
  key: string;
  symbol: string;
  expDate: string;
  dte: number;
  strategy: string;
  legs: PositionLeg[];
  creditReceived: number;
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  pnlReliable: boolean;
  intent: PositionIntent;
  plOpen: number | null;
  targetPrice: number;
  profitTarget: number;
  maxRisk: number;
  hitTarget: boolean;
  needsClose: boolean;
  entryDte: number;
  entryDate: string | null;  // date position was opened (YYYY-MM-DD)
  // Entry snapshot fields are captured the first time TradeEdge sees the open position.
  // For positions opened before this feature existed, the first snapshot will be 'first tracked', not true trade entry.
  entrySnapshotKey?: string | null;
  entrySnapshotCreatedAt?: string | null;
  snapshotHistory?: PositionSnapshot[]; // daily snapshots for this position (for net-edge peak/trend)
  ivAtEntry?: number | null;
  deltaAtEntry?: number | null;
  thetaAtEntry?: number | null;
  otmAtEntry?: number | null;
  dteAtEntry?: number | null;
  accountNumber: string;
  // Greeks
  ivr: number | null;
  iv: number | null;          // current implied volatility %
  hv30: number | null;        // 30-day historical volatility %
  beta: number | null;        // beta to SPY
  netDelta: number | null;    // net position delta
  netVega: number | null;     // net position vega
  hasGtc: boolean;
  gtcOrderId: string | null;       // ID of the working profit-target GTC order
  gtcOrderPrice: number | null;    // current limit price on that GTC order
  stopLossStatus: StopStatus;
  stopLossPrice: number | null;
  stockPrice: number | null;
  buffer: number | null;
  theta: number | null;
  gamma: number | null;
  earningsDate: string | null; // next earnings only if on/before option expiration
}

// ── Pending Orders ───────────────────────────────────────────────────────
// An unfilled OTOCO entry/opening order -- the trigger leg of a complex
// order that hasn't filled yet, so it has no corresponding Position. These
// come from the same /complex-orders fetch loadPositions already does for
// gtcSymbols, filtered down to legs with Sell to Open / Buy to Open actions
// (as opposed to Buy to Close / Sell to Close, which mark GTC/stop orders
// protecting an already-open position -- those are tracked separately via
// Position.hasGtc / gtcOrderId / stopLossStatus, not here).
interface PendingOrderLeg {
  symbol: string;       // OCC option symbol, space-padded as TastyTrade returns it
  action: string;       // 'Sell to Open' | 'Buy to Open' | etc.
  optionType: 'P' | 'C' | null;
  strikePrice: number;
}
interface PendingOrder {
  id: string;                 // complex-order id -- pending orders are always complex-order-sourced
  accountNumber: string;
  symbol: string;              // underlying symbol
  strategy: string;             // inferred from legs: BPS / BCS / IC / UNKNOWN
  legs: PendingOrderLeg[];
  expDate: string | null;       // expiration date of the option legs, if parseable
  limitPrice: number | null;    // trigger order's limit price
  priceEffect: string | null;   // 'Credit' | 'Debit'
  status: string;               // raw status string from the trigger/nested order
  createdAt: string | null;
}

// ── Position Snapshots ───────────────────────────────────────────────────
// Daily snapshot of a position's live state, captured client-side whenever
// the Portfolio page loads (TastyTrade can't be called server-side, so this
// can only run while the browser is open — see project notes). Kept
// permanently once captured; only the "Clear Snapshot History" button
// removes them. This is what lets a future 21-vs-30-DTE exit comparison use
// real recorded values instead of a modeled estimate.
interface PositionSnapshot {
  date: string;          // YYYY-MM-DD, the day this snapshot was taken
  dte: number;
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  iv: number | null;
  theta: number | null;
  gamma: number | null;
  netDelta: number | null;
  stockPrice: number | null;
}

function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Builds today's snapshot payload for each position and POSTs any that
// aren't already recorded for today. Fire-and-forget from the caller's
// perspective — failures are logged, not surfaced, since this is background
// data collection and shouldn't interrupt the Portfolio page if it fails.
async function captureSnapshotsIfNeeded(positions: Position[]): Promise<void> {
  if (positions.length === 0) return;
  const today = todayLocalDateString();
  const entries = positions.map(p => ({
    positionKey: p.key,
    snapshot: {
      date: today,
      dte: p.dte,
      currentValue: p.currentValue,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
      iv: p.iv,
      theta: p.theta,
      gamma: p.gamma,
      netDelta: p.netDelta,
      stockPrice: p.stockPrice,
    } as PositionSnapshot,
  }));
  try {
    await fetch('/api/position-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
  } catch (e) {
    console.error('Snapshot capture failed (non-blocking):', e);
  }
}

// Fetches the full snapshot store and returns it keyed by position.key.
// Non-blocking caller handles failure by leaving history empty.
async function fetchSnapshotStore(): Promise<Record<string, PositionSnapshot[]>> {
  const res = await fetch('/api/position-snapshots');
  if (!res.ok) throw new Error(`snapshot fetch ${res.status}`);
  const data = await res.json();
  return (data?.snapshots ?? {}) as Record<string, PositionSnapshot[]>;
}

// Attaches each position's snapshot history (sorted by date ascending) onto
// the position object so the card render can compute net-edge peak/trend.
function attachSnapshotHistory(
  positions: Position[],
  store: Record<string, PositionSnapshot[]>,
): Position[] {
  return positions.map(p => {
    const hist = store[p.key] ?? [];
    const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
    return { ...p, snapshotHistory: sorted };
  });
}

async function clearSnapshotHistory(): Promise<void> {
  await fetch('/api/position-snapshots', { method: 'DELETE' });
}

interface PositionAnalysis {
  positionKey: string;
  symbol: string;
  loading: boolean;
  error: string | null;
  recommendation: 'HOLD' | 'CLOSE' | 'ROLL' | 'TAKE_PROFIT' | 'CUT_LOSSES' | 'WATCH' | 'MANAGE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;       // 1-2 sentence TL;DR
  reasoning: string;     // full reasoning paragraph
  risks: string[];       // 2-4 bullet risks
  catalysts: string[];   // 1-3 positive factors
  deviatesFromRules: boolean;
  deviationNote: string | null; // when AI recommends outside standard rules, explain why
  generatedAt: string;
}

interface PortfolioAnalysis {
  loading: boolean;
  error: string | null;
  netDelta: number | null;
  dominantRisk: string;
  sectorConcentration: string[];
  thetaYield: string;
  topRisks: string[];
  priorityActions: string[];
  marketContext: string;
  summary: string;
  generatedAt: string;
}

interface ActionVerdict {
  verdict: 'GO' | 'CAUTION' | 'STOP';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  headline: string;     // single punchy sentence — the gut-punch
  reasoning: string;    // 2-3 sentences of specific reasoning with numbers
  override?: boolean;   // trader consciously overriding a STOP
}

type EvaluatedAction = 'EXTEND_PROFIT' | 'CLOSE_ROLL' | 'TAKE_PROFIT' | 'CUT_LOSSES' | 'PLACE_GTC';

type StopStatus = 'live' | 'loose' | 'none' | 'unknown';

interface GtcOrderLeg { symbol: string; action: string; }
interface GtcOrder {
  id: string; price: string; stopPrice: string | null;
  orderType: string; timeInForce: string; legs: GtcOrderLeg[];
  complexOrderId?: string; // set when this order is part of a complex/OCO order
}
interface StopLossInfo { status: StopStatus; price: number | null; }

interface PriceSupportAnalysis {
  verdict: 'GOOD' | 'CAUTION' | 'BAD' | 'UNKNOWN';
  score: number;
  lookbackDays: number;
  price: number | null;
  shortStrike: number | null;
  nearestSupport: number | null;
  supportZoneLow: number | null;
  supportZoneHigh: number | null;
  low20: number | null;
  low50: number | null;
  swingLow: number | null;
  ma20: number | null;
  ma50: number | null;
  strikeVsSupportPct: number | null;
  priceVsMa20Pct: number | null;
  priceVsMa50Pct: number | null;
  reason: string;
}

interface TrendResult {
  trend: 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
  strategy: 'BPS' | 'BCS' | 'IC' | 'NO_TRADE';
  confidence: number;
  reason: string;
  supportAnalysis?: PriceSupportAnalysis;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  symbol: string;
  strategy: string;
  action: ActionType;
  orderType: string;
  limitPrice: number;
  quantity: number;
  orderId: string;
  status: 'submitted' | 'error' | 'dry-run';
  error?: string;
  estPnl?: number;
  closeProfitPct?: number;  // % profit captured on TAKE_PROFIT closes (e.g. 65 for 65%)
  creditAtClose?: number;   // credit per contract at time of close — used to back-calc pct
}

interface OrderLeg {
  symbol: string;
  quantity: number;
  action: 'Buy to Close' | 'Sell to Open' | 'Buy to Open' | 'Sell to Close';
  'instrument-type': 'Equity Option' | 'Index Option';
}
interface OrderBody {
  'order-type': 'Limit' | 'Market' | 'Stop' | 'Stop Limit';
  'time-in-force': 'GTC' | 'Day';
  price?: string;
  'price-effect'?: 'Debit' | 'Credit';
  legs: OrderLeg[];
}

interface BatchOrderItem {
  pos: Position;
  action: ActionType;
  orderBody: OrderBody;
  limitPrice: number;
  estPnl: number | null;
  stalePriceWarning: boolean;
  freshPrice: number | null;        // total value across all contracts × 100
  freshPerContract: number | null;  // per-contract spread value
  duplicateGtcWarning: boolean;
  priceError: string | null;        // null = ok, string = blocking error message
  closeQuote?: CloseQuote | null;   // live net bid/mid/ask per contract for the scale
  // roll-specific
  rollExpiry?: string;
  rollShortStrike?: number;
  rollLongStrike?: number;
  rollCredit?: number;
  openOrderBody?: OrderBody;
}

interface OrderResult {
  symbol: string;
  action: ActionType;
  orderId: string;
  status: 'filled' | 'working' | 'rejected' | 'submitted' | 'error';
  error?: string;
  limitPrice: number;
  estPnl: number | null;
}

interface RollSuggestion {
  expiry: string;
  dte: number;
  shortStrike: number;
  longStrike: number;
  spreadWidth: number;
  credit: number;           // conservative estimate (mid * 0.7)
  creditMid: number;        // true mid (bid+ask)/2
  creditRatio: number;      // credit / spreadWidth — must be >= 1/3
  delta: number;
  shortSymbol: string;      // native OCC symbol from TastyTrade chain
  longSymbol: string;       // native OCC symbol from TastyTrade chain
  shortOi: number | null;
  longOi: number | null;
  shortBidAsk: number | null;   // ask - bid on short leg
  longBidAsk: number | null;    // ask - bid on long leg
  // Rule checks
  ruleViolations: string[];     // empty = all clear, strings = specific violations
  meetsMinCredit: boolean;      // credit >= 1/3 spread width
  meetsDte: boolean;            // 30-45 DTE
  meetsDelta: boolean;          // delta within strategy range
  meetsOi: boolean;             // OI >= 500 on both legs
  meetsBidAsk: boolean;         // bid-ask <= $0.10 on each leg
}

// ── Roll Candidate (multi-expiration, multi-strike search) ─────────────────
interface RollCandidate extends RollSuggestion {
  closeCost: number;       // pos.currentValue -- what it costs to close the old spread now
  openCredit: number;      // new spread's credit * qty * 100 -- what opening the new spread brings in
  netRollPnl: number;      // openCredit - closeCost -- net cash effect of this specific roll
}

async function findRollCandidates(pos: Position, token: string): Promise<RollCandidate[]> {
  const candidates: RollCandidate[] = [];
  try {
    const optType = pos.strategy === 'BCS' ? 'C' : 'P';
    const targetDelta = pos.strategy === 'BCS' ? 0.25 : -0.25;
    const deltaMin = pos.strategy === 'BCS' ?  0.15 : -0.35;
    const deltaMax = pos.strategy === 'BCS' ?  0.35 : -0.15;

    const origShort = pos.legs.find(l => l.direction === 'Short');
    const origLong  = pos.legs.find(l => l.direction === 'Long');
    if (!origShort || !origLong) return [];
    const width = Math.abs(origShort.strikePrice - origLong.strikePrice);
    const qty = pos.legs[0]?.quantity ?? 1;

    const chainData = await ttFetch(`/option-chains/${encodeURIComponent(pos.symbol)}/expirations`, token);
    const expirations: any[] = chainData?.data?.items ?? [];
    const today = new Date();
    console.log(`ROLL_SEARCH_DEBUG ${pos.symbol}: raw expirations count=`, expirations.length);
    console.log(`ROLL_SEARCH_DEBUG ${pos.symbol}: raw expirations`, expirations.map((e: any) => e['expiration-date']));
    const validExpiries = expirations
      .map((e: any) => ({
        expiry: e['expiration-date'],
        dte: Math.round((new Date(e['expiration-date']).getTime() - today.getTime()) / 86400000),
      }))
      .filter(e => e.dte >= 28 && e.dte <= 50);

    console.log(`ROLL_SEARCH_DEBUG ${pos.symbol}: validExpiries (28-50 DTE)=`, validExpiries);

    if (validExpiries.length === 0) return [];

    for (const { expiry, dte } of validExpiries) {
      let strikeData: any;
      try {
        strikeData = await ttFetch(
          `/option-chains/${encodeURIComponent(pos.symbol)}/nested?expiration-date=${expiry}`,
          token
        );
      } catch {
        continue;
      }
      const strikes: any[] = strikeData?.data?.items?.[0]?.strikes ?? [];

      for (const s of strikes) {
        const leg = s[optType === 'P' ? 'put' : 'call'];
        if (!leg) continue;
        const delta = parseFloat(leg?.delta ?? '0');
        if (delta === 0) continue;
        const withinBand = delta >= Math.min(deltaMin, deltaMax) && delta <= Math.max(deltaMin, deltaMax);
        if (!withinBand) continue;

        const shortStrike = s['strike-price'];
        const longStrike = pos.strategy === 'BCS' ? shortStrike + width : shortStrike - width;
        const longStrikeData = strikes.find((s2: any) => s2['strike-price'] === longStrike);
        const longLeg = longStrikeData ? longStrikeData[optType === 'P' ? 'put' : 'call'] : null;
        if (!longLeg) continue;

        const shortBid = parseFloat(leg?.bid ?? '0');
        const shortAsk = parseFloat(leg?.ask ?? '0');
        const longBid  = parseFloat(longLeg?.bid ?? '0');
        const longAsk  = parseFloat(longLeg?.ask ?? '0');
        const shortOi  = parseInt(leg?.['open-interest'] ?? leg?.['oi'] ?? '0', 10);
        const longOi   = parseInt(longLeg?.['open-interest'] ?? longLeg?.['oi'] ?? '0', 10);

        const shortMid = (shortBid + shortAsk) / 2;
        const longMid  = (longBid + longAsk) / 2;
        const creditMid = parseFloat((shortMid - longMid).toFixed(2));
        if (creditMid <= 0) continue;
        const credit = parseFloat((creditMid * 0.85).toFixed(2));
        const creditRatio = width > 0 ? creditMid / width : 0;

        const shortSymbol = leg?.symbol ?? buildOccSymbol(pos.symbol, expiry, optType, shortStrike);
        const longSymbol  = longLeg?.symbol ?? buildOccSymbol(pos.symbol, expiry, optType, longStrike);
        const shortBidAsk = parseFloat((shortAsk - shortBid).toFixed(2));
        const longBidAsk  = parseFloat((longAsk - longBid).toFixed(2));

        const ruleViolations: string[] = [];
        const meetsMinCredit = creditRatio >= (1/3);
        const meetsDte       = dte >= 30 && dte <= 45;
        const meetsDelta     = delta >= Math.min(pos.strategy === 'BCS' ? 0.20 : -0.30, pos.strategy === 'BCS' ? 0.30 : -0.20)
                              && delta <= Math.max(pos.strategy === 'BCS' ? 0.20 : -0.30, pos.strategy === 'BCS' ? 0.30 : -0.20);
        const meetsOi        = shortOi >= 500 && longOi >= 500;
        const meetsBidAsk    = shortBidAsk <= 0.10 && longBidAsk <= 0.10;

        if (!meetsMinCredit) ruleViolations.push(`Credit $${creditMid.toFixed(2)} < 1/3 of $${width} spread ($${(width/3).toFixed(2)} min) — not worth rolling`);
        if (!meetsDte)       ruleViolations.push(`DTE ${dte} outside 30-45 window`);
        if (!meetsDelta)     ruleViolations.push(`Delta ${delta.toFixed(2)} outside ${pos.strategy === 'BCS' ? '0.20-0.30' : '-0.20 to -0.30'} range`);
        if (!meetsOi)        ruleViolations.push(`OI too low — short: ${shortOi}, long: ${longOi} (need ≥500)`);
        if (!meetsBidAsk)    ruleViolations.push(`Bid-ask too wide — short: $${shortBidAsk.toFixed(2)}, long: $${longBidAsk.toFixed(2)} (need ≤$0.10)`);

        const closeCost = pos.currentValue ?? 0;
        const openCredit = credit * qty * 100;
        const netRollPnl = parseFloat((openCredit - closeCost).toFixed(2));

        candidates.push({
          expiry, dte, shortStrike, longStrike, spreadWidth: width,
          credit, creditMid, creditRatio, delta,
          shortSymbol, longSymbol,
          shortOi: shortOi || null, longOi: longOi || null,
          shortBidAsk, longBidAsk,
          ruleViolations, meetsMinCredit, meetsDte, meetsDelta, meetsOi, meetsBidAsk,
          closeCost, openCredit, netRollPnl,
        });
      }
    }

    console.log(`ROLL CANDIDATE SEARCH ${pos.symbol}: ${candidates.length} candidates across ${validExpiries.length} expirations`);
    return candidates;
  } catch (e) {
    console.error('findRollCandidates failed:', e);
    return candidates;
  }
}

// ── Roll Candidate Categorization ───────────────────────────────────────────
type RollCategory = 'bestCredit' | 'safest' | 'closestDelta';

const ROLL_CATEGORY_LABELS: Record<RollCategory, string> = {
  bestCredit: 'Best Credit',
  safest: 'Safest / Most Liquid',
  closestDelta: 'Closest to Target Delta',
};

interface CategorizedRollPick {
  candidate: RollCandidate;
  categories: RollCategory[];
}

function liquidityScore(c: RollCandidate): number {
  const combinedOi = (c.shortOi ?? 0) + (c.longOi ?? 0);
  const oiScore = Math.min(70, (combinedOi / 2000) * 70);
  const combinedBidAsk = (c.shortBidAsk ?? 0.10) + (c.longBidAsk ?? 0.10);
  const bidAskScore = Math.max(0, 30 - (combinedBidAsk / 0.20) * 30);
  return oiScore + bidAskScore;
}

function pickForCategory(
  candidates: RollCandidate[],
  scoreFn: (c: RollCandidate) => number,
  higherIsBetter: boolean
): RollCandidate | null {
  if (candidates.length === 0) return null;
  const compliant = candidates.filter(c => c.ruleViolations.length === 0);
  const pool = compliant.length > 0 ? compliant : candidates;
  return pool.reduce((best, c) => {
    if (!best) return c;
    const cScore = scoreFn(c);
    const bestScore = scoreFn(best);
    return higherIsBetter
      ? (cScore > bestScore ? c : best)
      : (cScore < bestScore ? c : best);
  }, null as RollCandidate | null);
}

function categorizeRollCandidates(candidates: RollCandidate[], strategy: string): CategorizedRollPick[] {
  if (candidates.length === 0) return [];

  const targetDelta = strategy === 'BCS' ? 0.25 : -0.25;

  const bestCreditPick = pickForCategory(candidates, c => c.creditRatio, true);
  const safestPick = pickForCategory(candidates, c => liquidityScore(c), true);
  const closestDeltaPick = pickForCategory(candidates, c => Math.abs(c.delta - targetDelta), false);

  const keyOf = (c: RollCandidate) => `${c.expiry}-${c.shortStrike}-${c.longStrike}`;
  const picks = new Map<string, CategorizedRollPick>();

  const register = (candidate: RollCandidate | null, category: RollCategory) => {
    if (!candidate) return;
    const key = keyOf(candidate);
    const existing = picks.get(key);
    if (existing) {
      existing.categories.push(category);
    } else {
      picks.set(key, { candidate, categories: [category] });
    }
  };

  register(bestCreditPick, 'bestCredit');
  register(safestPick, 'safest');
  register(closestDeltaPick, 'closestDelta');

  return Array.from(picks.values()).sort((a, b) => b.categories.length - a.categories.length);
}

// ── Theme ──────────────────────────────────────────────────────────────────


// ── Market Hours ───────────────────────────────────────────────────────────
function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const etOffset = -5 * 60; // EST (ignores DST — good enough for a guard)
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMin = utcMin + etOffset;
  const openMin = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN;
  const closeMin = MARKET_CLOSE_HOUR * 60;
  return etMin >= openMin && etMin < closeMin;
}

function getMarketStatus(): { open: boolean; label: string } {
  const open = isMarketOpen();
  return { open, label: open ? '● Market Open' : '○ Market Closed' };
}

// ── Audit Log ──────────────────────────────────────────────────────────────
function readAuditLog(): AuditEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_AUDIT_LOG) ?? '[]'); } catch { return []; }
}

function writeAuditEntry(entry: AuditEntry) {
  try {
    const log = readAuditLog();
    log.unshift(entry);
    if (log.length > 500) log.length = 500; // cap at 500 entries
    localStorage.setItem(LS_AUDIT_LOG, JSON.stringify(log));
  } catch {}
}

function exportAuditCsv() {
  const log = readAuditLog();
  if (log.length === 0) return;
  const headers = ['Timestamp', 'Symbol', 'Strategy', 'Action', 'Order Type', 'Limit Price', 'Quantity', 'Order ID', 'Status', 'Est P&L', 'Close Profit %', 'Error'];
  const rows = log.map(e => [
    e.timestamp, e.symbol, e.strategy, e.action, e.orderType,
    e.limitPrice.toFixed(2), e.quantity, e.orderId, e.status,
    e.estPnl?.toFixed(2) ?? '', e.closeProfitPct?.toFixed(0) ?? '', e.error ?? ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `hunter-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Smart GTC Default ─────────────────────────────────────────────────────
// Look up last 2-3 profitable TAKE_PROFIT closes for a symbol and average
// the closeProfitPct to suggest an informed default GTC percentage.
function getSmartGtcDefault(symbol: string): number {
  try {
    const log = readAuditLog();
    const relevant = log.filter(e =>
      e.symbol === symbol &&
      e.action === 'TAKE_PROFIT' &&
      e.status !== 'error' &&
      e.closeProfitPct != null &&
      e.closeProfitPct > 0
    );
    if (relevant.length === 0) return 0.50; // no history — default 50%
    const recent = relevant.slice(0, 3); // most recent 2-3
    const avg = recent.reduce((sum, e) => sum + (e.closeProfitPct ?? 50), 0) / recent.length;
    // Round to nearest 5% and clamp between 40-85%
    return Math.min(0.85, Math.max(0.40, Math.round(avg / 5) * 5)) / 100;
  } catch {
    return 0.50;
  }
}

// ── Trading Memory ─────────────────────────────────────────────────────────

interface TradeRecord {
  id: string;
  timestamp: string;        // ISO
  symbol: string;
  strategy: string;
  action: string;
  entryCredit: number;      // per-contract $ at entry (creditReceived / 100)
  exitPrice: number;        // limit price at close
  pnlPct: number;           // % of credit captured (positive = profit)
  dte: number;              // DTE when action taken
  ivr: number | null;
  buffer: number | null;
  aiVerdict: 'GO' | 'CAUTION' | 'STOP' | null;
  aiOverridden: boolean;    // trader overrode a STOP verdict
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL'; // pnlPct >= 40 = WIN, <= -50 = LOSS
}

interface SymbolProfile {
  symbol: string;
  tradeCount: number;
  winRate: number;           // 0-1
  avgPnlPct: number;
  bestStrategy: string | null;
  ivrWinRange: [number, number] | null; // IVR range on winning trades
  earningsNote: string | null;          // free text from summarization
  recentTrades: TradeRecord[];          // last N raw trades
  historySummary: string | null;        // AI summary of older trades
  lastUpdated: string;
}

interface BehaviorProfile {
  totalTrades: number;
  overrideCount: number;
  overrideWins: number;       // overrides that turned out profitable
  ruleDeviationPatterns: string[];   // e.g. "holds past 21 DTE on IC"
  strengths: string[];
  weaknesses: string[];
  summary: string | null;    // AI-generated behavioral summary
  lastSummarized: string | null;
}

interface TradingMemory {
  symbolProfiles: Record<string, SymbolProfile>;
  behaviorProfile: BehaviorProfile;
  recentActions: TradeRecord[];   // ring buffer, last MEMORY_RAW_ACTIONS
  lastSummarized: string | null;
  version: number;
}

function emptyMemory(): TradingMemory {
  return {
    symbolProfiles: {},
    behaviorProfile: {
      totalTrades: 0, overrideCount: 0, overrideWins: 0,
      ruleDeviationPatterns: [], strengths: [], weaknesses: [],
      summary: null, lastSummarized: null,
    },
    recentActions: [],
    lastSummarized: null,
    version: 1,
  };
}

function readMemory(): TradingMemory {
  try {
    const raw = localStorage.getItem(LS_MEMORY);
    if (!raw) return emptyMemory();
    return { ...emptyMemory(), ...JSON.parse(raw) };
  } catch { return emptyMemory(); }
}

function writeMemory(mem: TradingMemory) {
  try { localStorage.setItem(LS_MEMORY, JSON.stringify(mem)); } catch {}
}

function recordTradeInMemory(
  pos: Position,
  action: string,
  limitPrice: number,
  verdict: ActionVerdict | null,
  overridden: boolean
) {
  const mem = readMemory();
  const pnlPct = pos.pnl != null && pos.creditReceived > 0
    ? (pos.pnl / pos.creditReceived) * 100 : 0;
  const outcome: TradeRecord['outcome'] = pnlPct >= 40 ? 'WIN' : pnlPct <= -50 ? 'LOSS' : 'NEUTRAL';

  const record: TradeRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    symbol: pos.symbol,
    strategy: pos.strategy,
    action,
    entryCredit: pos.creditReceived / 100,
    exitPrice: limitPrice,
    pnlPct,
    dte: pos.dte,
    ivr: pos.ivr,
    buffer: pos.buffer,
    aiVerdict: verdict?.verdict ?? null,
    aiOverridden: overridden,
    outcome,
  };

  // Update symbol profile
  if (!mem.symbolProfiles[pos.symbol]) {
    mem.symbolProfiles[pos.symbol] = {
      symbol: pos.symbol, tradeCount: 0, winRate: 0, avgPnlPct: 0,
      bestStrategy: null, ivrWinRange: null, earningsNote: null,
      recentTrades: [], historySummary: null, lastUpdated: new Date().toISOString(),
    };
  }
  const profile = mem.symbolProfiles[pos.symbol];
  profile.recentTrades = [record, ...profile.recentTrades].slice(0, MEMORY_RAW_TRADES_PER_SYMBOL * 2);
  profile.tradeCount++;
  const allTrades = profile.recentTrades;
  const wins = allTrades.filter(t => t.outcome === 'WIN').length;
  profile.winRate = allTrades.length > 0 ? wins / allTrades.length : 0;
  profile.avgPnlPct = allTrades.length > 0
    ? allTrades.reduce((s, t) => s + t.pnlPct, 0) / allTrades.length : 0;
  profile.lastUpdated = new Date().toISOString();

  // Update behavior profile
  mem.behaviorProfile.totalTrades++;
  if (overridden) {
    mem.behaviorProfile.overrideCount++;
    if (outcome === 'WIN') mem.behaviorProfile.overrideWins++;
  }

  // Ring buffer for recent actions
  mem.recentActions = [record, ...mem.recentActions].slice(0, MEMORY_RAW_ACTIONS);

  writeMemory(mem);
  return mem;
}

function buildMemoryContext(symbol: string, action: string): string {
  const mem = readMemory();
  const lines: string[] = [];

  // Symbol-specific history
  const profile = mem.symbolProfiles[symbol];
  if (profile && profile.tradeCount > 0) {
    lines.push(`SYMBOL HISTORY — ${symbol}:`);
    lines.push(`  ${profile.tradeCount} trades | Win rate: ${Math.round(profile.winRate * 100)}% | Avg P&L: ${profile.avgPnlPct.toFixed(1)}%`);
    if (profile.bestStrategy) lines.push(`  Best strategy: ${profile.bestStrategy}`);
    if (profile.earningsNote) lines.push(`  Earnings pattern: ${profile.earningsNote}`);
    if (profile.historySummary) lines.push(`  History: ${profile.historySummary}`);
    if (profile.recentTrades.length > 0) {
      lines.push(`  Recent trades (newest first):`);
      profile.recentTrades.slice(0, MEMORY_RAW_TRADES_PER_SYMBOL).forEach(t => {
        const ago = Math.round((Date.now() - new Date(t.timestamp).getTime()) / 86400000);
        lines.push(`    ${ago}d ago: ${t.strategy} ${t.action} — ${t.pnlPct.toFixed(1)}% P&L at ${t.dte} DTE, IVR ${t.ivr ?? '?'}, buffer ${t.buffer?.toFixed(1) ?? '?'}% → ${t.outcome}${t.aiVerdict ? ` (AI said ${t.aiVerdict}${t.aiOverridden ? ', overridden' : ''})` : ''}`);
      });
    }
  }

  // Behavioral profile
  const bp = mem.behaviorProfile;
  if (bp.totalTrades > 0) {
    lines.push(`\nTRADER BEHAVIORAL PROFILE (${bp.totalTrades} total trades):`);
    if (bp.overrideCount > 0) {
      const overrideWinRate = bp.overrideCount > 0
        ? Math.round((bp.overrideWins / bp.overrideCount) * 100) : 0;
      lines.push(`  Overrode AI STOP verdicts ${bp.overrideCount} times — was right ${overrideWinRate}% of the time`);
    }
    if (bp.strengths.length > 0) lines.push(`  Strengths: ${bp.strengths.join(', ')}`);
    if (bp.weaknesses.length > 0) lines.push(`  Weaknesses: ${bp.weaknesses.join(', ')}`);
    if (bp.summary) lines.push(`  Pattern summary: ${bp.summary}`);
  }

  // Recent portfolio-wide actions for context
  const recentOther = mem.recentActions
    .filter(r => r.symbol !== symbol)
    .slice(0, 5);
  if (recentOther.length > 0) {
    lines.push(`\nRECENT OTHER TRADES (for portfolio context):`);
    recentOther.forEach(t => {
      const ago = Math.round((Date.now() - new Date(t.timestamp).getTime()) / 86400000);
      lines.push(`  ${ago}d ago: ${t.symbol} ${t.strategy} ${t.action} → ${t.outcome} (${t.pnlPct.toFixed(1)}%)`);
    });
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

async function summarizeSymbolHistory(symbol: string): Promise<void> {
  const mem = readMemory();
  const profile = mem.symbolProfiles[symbol];
  if (!profile || profile.recentTrades.length <= MEMORY_RAW_TRADES_PER_SYMBOL) return;

  const toSummarize = profile.recentTrades.slice(MEMORY_RAW_TRADES_PER_SYMBOL);
  const prompt = `Summarize these trading history records for ${symbol} into 2-3 sentences. 
Focus on: patterns (what worked, what didn't), typical P&L range, IVR conditions, DTE behavior, any notable mistakes.
Be specific with numbers. Write in second person ("You typically...").

Records:
${toSummarize.map(t => `${t.strategy} ${t.action}: P&L ${t.pnlPct.toFixed(1)}%, DTE ${t.dte}, IVR ${t.ivr ?? '?'}, buffer ${t.buffer?.toFixed(1) ?? '?'}%, outcome ${t.outcome}`).join('\n')}

Existing summary to merge with (if any): ${profile.historySummary ?? 'none'}

Reply with ONLY the summary text, no JSON, no labels.`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'summary',
        max_tokens: 200,
        system: 'You are a concise trading journal summarizer. Respond with plain text only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const summary = data?.content?.find((b: any) => b.type === 'text')?.text?.trim() ?? null;
    if (summary) {
      profile.historySummary = summary;
      profile.recentTrades = profile.recentTrades.slice(0, MEMORY_RAW_TRADES_PER_SYMBOL);
      writeMemory(mem);
    }
  } catch {}
}

async function summarizeBehaviorProfile(): Promise<void> {
  const mem = readMemory();
  const bp = mem.behaviorProfile;
  if (mem.recentActions.length < 5) return;

  const daysSince = mem.lastSummarized
    ? (Date.now() - new Date(mem.lastSummarized).getTime()) / 86400000
    : Infinity;
  if (daysSince < MEMORY_SUMMARIZE_INTERVAL_DAYS) return;

  const prompt = `Analyze these trading actions and behavioral data to identify patterns for this options trader.

STATS:
Total trades: ${bp.totalTrades}
AI override rate: ${bp.overrideCount} overrides out of ${bp.totalTrades} STOP verdicts
Override success rate: ${bp.overrideCount > 0 ? Math.round((bp.overrideWins / bp.overrideCount) * 100) : 0}%

RECENT ACTIONS (${mem.recentActions.length} records):
${mem.recentActions.map(t => `${t.symbol} ${t.strategy} ${t.action}: P&L ${t.pnlPct.toFixed(1)}%, DTE ${t.dte}, outcome ${t.outcome}${t.aiOverridden ? ' [overrode AI]' : ''}`).join('\n')}

Existing summary: ${bp.summary ?? 'none'}

Identify:
1. 1-2 clear strengths (what they do well consistently)
2. 1-2 clear weaknesses or recurring mistakes
3. One 3-sentence overall behavioral summary in second person

Reply as JSON: {"strengths": [...], "weaknesses": [...], "summary": "..."}`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'summary',
        max_tokens: 300,
        system: 'You are a trading coach analyzing a trader\'s patterns. Return JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const text = (data?.content?.find((b: any) => b.type === 'text')?.text ?? '')
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(text);
    bp.strengths = parsed.strengths ?? bp.strengths;
    bp.weaknesses = parsed.weaknesses ?? bp.weaknesses;
    bp.summary = parsed.summary ?? bp.summary;
    bp.lastSummarized = new Date().toISOString();
    mem.lastSummarized = new Date().toISOString();
    writeMemory(mem);
  } catch {}
}

function clearMemory() {
  try { localStorage.removeItem(LS_MEMORY); } catch {}
}


// ── Entry Snapshot Tracking ────────────────────────────────────────────────
interface EntrySnapshot {
  key: string;
  createdAt: string;
  symbol: string;
  strategy: string;
  expDate: string;
  entryDate: string | null;
  ivAtEntry: number | null;
  deltaAtEntry: number | null;
  thetaAtEntry: number | null;
  otmAtEntry: number | null;
  dteAtEntry: number | null;
}

function readEntrySnapshots(): Record<string, EntrySnapshot> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(LS_ENTRY_SNAPSHOTS) ?? '{}');
  } catch {
    return {};
  }
}

function writeEntrySnapshots(snapshots: Record<string, EntrySnapshot>) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_ENTRY_SNAPSHOTS, JSON.stringify(snapshots));
  } catch {}
}

function positionEntrySnapshotKey(pos: Pick<Position, 'accountNumber' | 'symbol' | 'expDate' | 'entryDate' | 'legs'>): string {
  const legsKey = pos.legs
    .map(l => `${l.direction[0]}${l.optionType}${l.strikePrice}x${Math.abs(l.quantity)}`)
    .sort()
    .join('|');
  return [pos.accountNumber, pos.symbol, pos.expDate, pos.entryDate ?? 'unknown', legsKey].join('::');
}

function attachEntrySnapshots(positions: Position[]): Position[] {
  const snapshots = readEntrySnapshots();
  let changed = false;

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
        deltaAtEntry: pos.netDelta ?? null,
        thetaAtEntry: pos.theta ?? null,
        otmAtEntry: pos.buffer ?? null,
        dteAtEntry: pos.entryDte ?? pos.dte ?? null,
      };
      snapshots[key] = snap;
      changed = true;
    }

    return {
      ...pos,
      entrySnapshotKey: key,
      entrySnapshotCreatedAt: snap.createdAt,
      ivAtEntry: snap.ivAtEntry ?? null,
      deltaAtEntry: snap.deltaAtEntry ?? null,
      thetaAtEntry: snap.thetaAtEntry ?? null,
      otmAtEntry: snap.otmAtEntry ?? null,
      dteAtEntry: snap.dteAtEntry ?? pos.entryDte ?? null,
    };
  });

  if (changed) writeEntrySnapshots(snapshots);
  return enriched;
}

// ── Auth & API ─────────────────────────────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;
  const refreshToken = localStorage.getItem('tt_refresh_token');
  const clientSecret = localStorage.getItem('tt_client_secret') ?? '';
  if (!refreshToken || !clientSecret) { window.location.href = '/login'; throw new Error('Not authenticated'); }
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: clientSecret }),
  });
  if (!res.ok) {
    sessionStorage.removeItem('tt_access_token');
    localStorage.removeItem('tt_refresh_token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const data = await res.json();
  const token = data.access_token;
  if (!token) { window.location.href = '/login'; throw new Error('No token'); }
  sessionStorage.setItem('tt_access_token', token);
  if (data.refresh_token && data.refresh_token !== refreshToken) localStorage.setItem('tt_refresh_token', data.refresh_token);
  return token;
}

async function ttFetch(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  if (!res.ok) { const text = await res.text(); throw new Error(`${path} failed (${res.status}): ${text.slice(0, 120)}`); }
  return res.json();
}

async function ttPost(path: string, token: string, body: unknown) {
  console.log('TT ORDER BODY:', JSON.stringify(body, null, 2));
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  const data = await res.json();
  console.log('TT ORDER RESPONSE:', JSON.stringify(data, null, 2));
  if (!res.ok) {
    const details = formatTastyTradeRejection(data);
    throw new Error(`Order rejected (${res.status}):\n${details}`);
  }
  return data;
}

async function cancelOrder(accountNumber: string, orderId: string, token: string, complexOrderId?: string) {
  // If part of a complex order, cancel the whole complex order
  const path = complexOrderId
    ? `${BASE}/accounts/${accountNumber}/complex-orders/${complexOrderId}`
    : `${BASE}/accounts/${accountNumber}/orders/${orderId}`;
  const res = await fetch(path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    sessionStorage.removeItem('tt_access_token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`CANCEL RAW RESPONSE (${res.status}):`, text.slice(0, 500));
    throw new Error(`Cancel failed: ${text.slice(0, 200)}`);
  }
  const result = await res.json().catch(() => ({}));
  console.log('CANCEL RAW SUCCESS:', JSON.stringify(result).slice(0, 200));
  return result;
}

// TastyTrade supports a native dry-run: POST to same endpoint with ?dry-run=true
// Returns buying power effects and any errors without placing the order.
async function ttValidateOrder(path: string, token: string, body: unknown): Promise<{ valid: boolean; warnings: string[]; errors: string[] }> {
  try {
    const res = await fetch(`${BASE}${path}?dry-run=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log('TT VALIDATE RESPONSE:', JSON.stringify(data, null, 2));
    const warnings = (data?.warnings ?? []).map((w: any) => w.message ?? String(w));
    const errors = (data?.errors ?? []).map((e: any) => e.message ?? String(e));
    if (!res.ok) {
      const errMsg =
        data?.error?.message ??
        data?.['error-message'] ??
        (Array.isArray(data?.error?.errors)
          ? data.error.errors.map((e: any) => `${e.domain ?? ''} ${e.reason ?? e.message ?? e}`).join('; ')
          : null) ??
        JSON.stringify(data?.error ?? data).slice(0, 200);
      return { valid: false, warnings, errors: [errMsg] };
    }
    return { valid: errors.length === 0, warnings, errors };
  } catch {
    return { valid: true, warnings: [], errors: [] };
  }
}

// ── Fresh Price Fetch ──────────────────────────────────────────────────────
async function fetchFreshPositionPrice(pos: Position, token: string): Promise<number | null> {
  try {
    const symbols = pos.legs.map(l => l.symbol);
    const qs = symbols.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    const data = await ttFetch(`/market-data/by-type?${qs}`, token);
    const items: any[] = data?.data?.items ?? [];
    let total = 0;
    for (const leg of pos.legs) {
      const item = items.find((i: any) => i.symbol?.replace(/\s+/g, '') === leg.symbol?.replace(/\s+/g, ''));
      if (!item) return null;
      const bid = parseFloat(item.bid ?? '0');
      const ask = parseFloat(item.ask ?? '0');
      const mid = (bid + ask) / 2;
      total += leg.direction === 'Short' ? mid * leg.quantity : -(mid * leg.quantity);
    }
    return Math.abs(total * 100);
  } catch { return null; }
}

// Fill-optimized close price. Reuses the per-leg quote fetch but prices the
// close toward the marketable (natural) side instead of pure mid, so
// CUT_LOSSES / CLOSE_ROLL closes actually fill. `aggression` in [0,1]:
//   0   = mid on every leg (patient, best price, may not fill)
//   0.5 = halfway from mid to natural (balanced default)
//   1   = full natural / marketable (fills fast, worst price)
// Returns the SIGNED per-contract limit (positive = net debit to close).
// buildCloseOrder reads the sign to set price-effect.
async function fetchCloseLimit(
  pos: Position,
  token: string,
  aggression: number = 0.5,
): Promise<number | null> {
  try {
    const a = Math.min(1, Math.max(0, aggression));
    const symbols = pos.legs.map(l => l.symbol);
    const qs = symbols.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    const data = await ttFetch(`/market-data/by-type?${qs}`, token);
    const items: any[] = data?.data?.items ?? [];
    let perShare = 0; // net debit to close, per share (positive = we pay)
    for (const leg of pos.legs) {
      const item = items.find((i: any) => i.symbol?.replace(/\s+/g, '') === leg.symbol?.replace(/\s+/g, ''));
      if (!item) return null;
      const bid = parseFloat(item.bid ?? '0');
      const ask = parseFloat(item.ask ?? '0');
      if (!(bid > 0) && !(ask > 0)) continue; // no quote — treat leg as worthless
      const mid = (bid + ask) / 2;
      // Natural side per leg for a close:
      //   short -> Buy to Close -> pay ASK (cost, +)
      //   long  -> Sell to Close -> receive BID (credit, -)
      if (leg.direction === 'Short') {
        const legPrice = mid + (ask - mid) * a;   // mid -> ask
        perShare += legPrice * leg.quantity;
      } else {
        const legPrice = mid - (mid - bid) * a;   // mid -> bid
        perShare -= legPrice * leg.quantity;
      }
    }
    const qty = pos.legs.find(l => l.direction === 'Short')?.quantity ?? pos.legs[0]?.quantity ?? 1;
    // perShare is already weighted by each leg's quantity; convert to a
    // per-CONTRACT figure (divide by short qty) to match buildCloseOrder's
    // per-contract limit convention.
    const perContract = qty > 0 ? perShare / qty : perShare;
    return parseFloat(perContract.toFixed(2));
  } catch { return null; }
}

// Live close quote for the profit-capture scale. Same fetch as fetchCloseLimit
// but returns the per-CONTRACT net bid / mid / ask for the spread's close:
//   netAsk = marketable now  (short legs @ ask, long legs @ bid)  -> fills fast
//   netMid = mid on every leg                                     -> reference
//   netBid = patient side    (short legs @ bid, long legs @ ask)  -> best price
// All are signed as a debit-to-close (positive = you pay). Returns null if any
// leg has no quote.
interface CloseQuote { netBid: number; netMid: number; netAsk: number; }
async function fetchCloseQuote(pos: Position, token: string): Promise<CloseQuote | null> {
  try {
    const symbols = pos.legs.map(l => l.symbol);
    const qs = symbols.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    const data = await ttFetch(`/market-data/by-type?${qs}`, token);
    const items: any[] = data?.data?.items ?? [];
    let shareBid = 0, shareMid = 0, shareAsk = 0;
    for (const leg of pos.legs) {
      const item = items.find((i: any) => i.symbol?.replace(/\s+/g, '') === leg.symbol?.replace(/\s+/g, ''));
      if (!item) return null;
      const bid = parseFloat(item.bid ?? '0');
      const ask = parseFloat(item.ask ?? '0');
      if (!(bid > 0) && !(ask > 0)) continue;
      const mid = (bid + ask) / 2;
      if (leg.direction === 'Short') {
        // Buy to Close: cost. Marketable = ask, patient = bid.
        shareAsk += ask * leg.quantity;
        shareBid += bid * leg.quantity;
        shareMid += mid * leg.quantity;
      } else {
        // Sell to Close: credit. Marketable = bid, patient = ask.
        shareAsk -= bid * leg.quantity;
        shareBid -= ask * leg.quantity;
        shareMid -= mid * leg.quantity;
      }
    }
    const qty = pos.legs.find(l => l.direction === 'Short')?.quantity ?? pos.legs[0]?.quantity ?? 1;
    const div = qty > 0 ? qty : 1;
    return {
      netBid: parseFloat((shareBid / div).toFixed(2)),
      netMid: parseFloat((shareMid / div).toFixed(2)),
      netAsk: parseFloat((shareAsk / div).toFixed(2)),
    };
  } catch { return null; }
}

// ── Roll Chain Suggestion ──────────────────────────────────────────────────
async function fetchRollSuggestion(pos: Position, token: string): Promise<RollSuggestion | null> {
  try {
    const optType = pos.strategy === 'BCS' ? 'C' : 'P';
    // Delta targets: BPS short put -0.20 to -0.30, BCS short call +0.20 to +0.30
    const targetDelta = pos.strategy === 'BCS' ? 0.25 : -0.25;
    const deltaMin = pos.strategy === 'BCS' ?  0.20 : -0.30;
    const deltaMax = pos.strategy === 'BCS' ?  0.30 : -0.20;

    // Step 1: get expirations, find one in 30-45 DTE window
    const chainData = await ttFetch(`/option-chains/${encodeURIComponent(pos.symbol)}/expirations`, token);
    const expirations: any[] = chainData?.data?.items ?? [];

    const today = new Date();
    // Sort by DTE ascending, find first in 30-45 window (prefer closest to 38 DTE)
    const candidates = expirations
      .map((e: any) => ({
        expiry: e['expiration-date'],
        dte: Math.round((new Date(e['expiration-date']).getTime() - today.getTime()) / 86400000),
      }))
      .filter(e => e.dte >= 28 && e.dte <= 50)
      .sort((a, b) => Math.abs(a.dte - 38) - Math.abs(b.dte - 38)); // prefer 38 DTE

    if (candidates.length === 0) return null;
    const { expiry, dte } = candidates[0];

    // Step 2: fetch full chain for that expiry — use nested format which includes greeks + OI
    const strikeData = await ttFetch(
      `/option-chains/${encodeURIComponent(pos.symbol)}/nested?expiration-date=${expiry}`,
      token
    );
    const strikes: any[] = strikeData?.data?.items?.[0]?.strikes ?? [];

    // Step 3: find best short strike — closest to target delta, within range
    const origShort = pos.legs.find(l => l.direction === 'Short');
    const origLong  = pos.legs.find(l => l.direction === 'Long');
    if (!origShort || !origLong) return null;
    const width = Math.abs(origShort.strikePrice - origLong.strikePrice);

    let best: any = null;
    let bestDiff = Infinity;
    for (const s of strikes) {
      const leg = s[optType === 'P' ? 'put' : 'call'];
      if (!leg) continue;
      const delta = parseFloat(leg?.delta ?? '0');
      const diff = Math.abs(delta - targetDelta);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = {
          strike: s['strike-price'],
          delta,
          bid:  parseFloat(leg?.bid  ?? '0'),
          ask:  parseFloat(leg?.ask  ?? '0'),
          oi:   parseInt(leg?.['open-interest'] ?? leg?.['oi'] ?? '0', 10),
          symbol: leg?.symbol ?? null,   // native OCC symbol from TastyTrade
        };
      }
    }
    if (!best) return null;

    const shortStrike = best.strike;
    const longStrike = pos.strategy === 'BCS' ? shortStrike + width : shortStrike - width;

    // Step 4: find long leg data from chain for OI + bid-ask + native symbol
    let longLegData: any = null;
    for (const s of strikes) {
      if (s['strike-price'] === longStrike) {
        const leg = s[optType === 'P' ? 'put' : 'call'];
        if (leg) {
          longLegData = {
            bid:  parseFloat(leg?.bid  ?? '0'),
            ask:  parseFloat(leg?.ask  ?? '0'),
            oi:   parseInt(leg?.['open-interest'] ?? leg?.['oi'] ?? '0', 10),
            symbol: leg?.symbol ?? null,
          };
        }
        break;
      }
    }

    // Step 5: compute credit values
    const shortMid = (best.bid + best.ask) / 2;
    const longMid  = longLegData ? (longLegData.bid + longLegData.ask) / 2 : 0;
    const creditMid = parseFloat((shortMid - longMid).toFixed(2));
    const credit    = parseFloat((creditMid * 0.85).toFixed(2)); // 85% of mid — realistic limit
    const creditRatio = width > 0 ? creditMid / width : 0;

    // Step 6: build native OCC symbols — prefer chain symbols, fall back to builder
    const shortSymbol = best.symbol ?? buildOccSymbol(pos.symbol, expiry, optType, shortStrike);
    const longSymbol  = longLegData?.symbol ?? buildOccSymbol(pos.symbol, expiry, optType, longStrike);

    // Step 7: bid-ask spreads per leg
    const shortBidAsk = parseFloat((best.ask - best.bid).toFixed(2));
    const longBidAsk  = longLegData ? parseFloat((longLegData.ask - longLegData.bid).toFixed(2)) : null;

    // Step 8: Rule validation
    const ruleViolations: string[] = [];
    const meetsMinCredit = creditRatio >= (1/3);
    const meetsDte       = dte >= 30 && dte <= 45;
    const meetsDelta     = best.delta >= Math.min(deltaMin, deltaMax) && best.delta <= Math.max(deltaMin, deltaMax);
    const meetsOi        = (best.oi >= 500) && (longLegData == null || longLegData.oi >= 500);
    const meetsBidAsk    = shortBidAsk <= 0.10 && (longBidAsk == null || longBidAsk <= 0.10);

    if (!meetsMinCredit) ruleViolations.push(`Credit $${creditMid.toFixed(2)} < 1/3 of $${width} spread ($${(width/3).toFixed(2)} min) — not worth rolling`);
    if (!meetsDte)       ruleViolations.push(`DTE ${dte} outside 30-45 window`);
    if (!meetsDelta)     ruleViolations.push(`Delta ${best.delta.toFixed(2)} outside ${pos.strategy === 'BCS' ? '0.20-0.30' : '-0.20 to -0.30'} range`);
    if (!meetsOi)        ruleViolations.push(`OI too low — short: ${best.oi}, long: ${longLegData?.oi ?? '?'} (need ≥500)`);
    if (!meetsBidAsk)    ruleViolations.push(`Bid-ask too wide — short: $${shortBidAsk.toFixed(2)}, long: $${longBidAsk?.toFixed(2) ?? '?'} (need ≤$0.10)`);

    console.log(`ROLL SUGGESTION ${pos.symbol}: expiry=${expiry} DTE=${dte} short=${shortStrike} long=${longStrike} credit=$${credit} creditMid=$${creditMid} ratio=${creditRatio.toFixed(2)} violations=${ruleViolations.length}`);

    return {
      expiry, dte, shortStrike, longStrike, spreadWidth: width,
      credit, creditMid, creditRatio, delta: best.delta,
      shortSymbol, longSymbol,
      shortOi: best.oi || null,
      longOi: longLegData?.oi || null,
      shortBidAsk, longBidAsk,
      ruleViolations, meetsMinCredit, meetsDte, meetsDelta, meetsOi, meetsBidAsk,
    };
  } catch (e) {
    console.error('fetchRollSuggestion failed:', e);
    return null;
  }
}

// ── Roll validation helper ─────────────────────────────────────────────────
function rollIsBlocking(suggestion: RollSuggestion): boolean {
  // Only block on hard rule violations — soft warnings can be overridden
  return !suggestion.meetsMinCredit || !suggestion.meetsDte;
}

// ── OCC Symbol Builder ─────────────────────────────────────────────────────
function buildOccSymbol(underlying: string, expiry: string, optType: 'P' | 'C', strike: number): string {
  const exp = expiry.replace(/-/g, '').slice(2); // YYMMDD
  const under = underlying.padEnd(6, ' ');
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${under}${exp}${optType}${strikeStr}`;
}

function instrType(symbol: string): 'Equity Option' | 'Index Option' {
  return ['SPX', 'NDX', 'RUT', 'VIX'].includes(symbol.toUpperCase().trim()) ? 'Index Option' : 'Equity Option';
}

// ── Order Builders ─────────────────────────────────────────────────────────
function buildCloseOrder(pos: Position, limitPrice: number, tif: 'GTC' | 'Day' = 'Day'): OrderBody {
  const itype = instrType(pos.symbol);
  const effectiveTif = (!isMarketOpen() && tif === 'Day') ? 'GTC' : tif;
  // TastyTrade price convention: price is always a POSITIVE magnitude, and the
  // direction is carried by 'price-effect'. For a close, a positive net price
  // means we PAY to buy back the spread (Debit). On rare inversions the math
  // can come out negative — meaning closing actually pays us — which must be
  // submitted as a Credit, not a Debit, or TastyTrade rejects the order.
  // Hardcoding 'Debit' was the root cause of close / close-roll rejections.
  // TastyTrade rejects Market orders on multi-leg spreads, so always Limit.
  // Floor the MAGNITUDE at $0.01 (never a sub-penny or zero price).
  const priceEffect: 'Debit' | 'Credit' = limitPrice < 0 ? 'Credit' : 'Debit';
  const safePrice = Math.max(Math.abs(limitPrice), 0.01);
  return {
    'order-type': 'Limit',
    'time-in-force': effectiveTif,
    price: safePrice.toFixed(2),
    'price-effect': priceEffect,
    legs: pos.legs.map(leg => ({
      symbol: leg.symbol,
      quantity: leg.quantity,
      action: leg.direction === 'Short' ? 'Buy to Close' : 'Sell to Close',
      'instrument-type': itype,
    })),
  };
}

function buildOpenSpreadOrder(
  underlying: string, expiry: string, optType: 'P' | 'C',
  shortStrike: number, longStrike: number, quantity: number, credit: number,
  shortSymbolOverride?: string, longSymbolOverride?: string
): OrderBody {
  const itype = instrType(underlying);
  // Prefer native OCC symbols from TastyTrade chain (guaranteed correct format)
  // Fall back to builder only if chain symbols aren't available
  const shortSym = shortSymbolOverride ?? buildOccSymbol(underlying, expiry, optType, shortStrike);
  const longSym  = longSymbolOverride  ?? buildOccSymbol(underlying, expiry, optType, longStrike);
  // Floor at $0.01, mirroring buildCloseOrder — a zero or negative credit here
  // would otherwise flow straight through into a guaranteed TastyTrade rejection.
  const safeCredit = Math.max(Math.abs(credit), 0.01);
  console.log(`BUILD OPEN SPREAD: short=${shortSym} long=${longSym} credit=$${safeCredit} qty=${quantity}`);
  return {
    'order-type': 'Limit',
    'time-in-force': 'GTC',
    price: safeCredit.toFixed(2),
    'price-effect': 'Credit',
    legs: [
      { symbol: shortSym, quantity, action: 'Sell to Open', 'instrument-type': itype },
      { symbol: longSym,  quantity, action: 'Buy to Open',  'instrument-type': itype },
    ],
  };
}

// ── Position Loading ───────────────────────────────────────────────────────
function parseOptionSymbol(sym: string): { optionType: 'P' | 'C'; strikePrice: number } {
  const match = sym.trim().replace(/\s+/g, '').match(/^([A-Z/]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return { optionType: 'C', strikePrice: 0 };
  return { optionType: match[3] as 'P' | 'C', strikePrice: parseInt(match[4], 10) / 1000 };
}


function calculateSpreadCredit(legs: Pick<PositionLeg, 'direction' | 'quantity' | 'avgOpenPrice'>[]): number {
  // Returns the actual net opening credit for the whole position in dollars.
  // TT leg prices are per-share option prices; multiply by contracts * 100.
  const net = legs.reduce((sum, leg) => {
    const qty = Math.abs(Number(leg.quantity) || 0);
    const price = Number(leg.avgOpenPrice) || 0;
    return sum + (leg.direction === 'Short' ? price * qty : -price * qty);
  }, 0);
  return Math.max(0, Math.round(net * 100 * 100) / 100);
}

function sideGrossRisk(
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

function calculateMaxRisk(legs: PositionLeg[], creditReceived: number, strategy: string): number {
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

function normalizeOccSymbol(symbol: string): string { return String(symbol ?? '').replace(/\s+/g, '').trim(); }
function normalizeOrderAction(action: string): string { return String(action ?? '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
function isBuyToCloseAction(action: string): boolean { const n = normalizeOrderAction(action); return n === 'buy to close' || n === 'btc'; }
function isStopOrder(order: GtcOrder): boolean { return Boolean(order.stopPrice) || order.orderType.toLowerCase().includes('stop'); }

function pickOrderField(o: any, keys: string[]): string | null {
  for (const key of keys) { const v = o?.[key]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v); }
  return null;
}

function mapGtcOrder(o: any, parentTif?: string, parentComplexId?: string): GtcOrder {
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

function collectRawOrders(raw: any): any[] {
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

function findProfitGtcOrder(positionLegs: PositionLeg[], gtcOrders: GtcOrder[]): GtcOrder | null {
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

async function ttPatch(path: string, token: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? data?.['error-message'] ?? `PATCH ${path} failed (${res.status})`);
  return data;
}

async function fetchAllComplexOrders(accountNumber: string, token: string): Promise<any> {
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

async function fetchGtcOrders(accountNumber: string, token: string): Promise<GtcOrder[]> {
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

function classifyPositionStopLoss(position: Pick<Position, 'legs' | 'creditReceived'>, gtcOrders: GtcOrder[]): StopLossInfo {
  const shortLeg = position.legs.find(l => l.direction === 'Short');
  if (!shortLeg?.symbol) return { status: 'unknown', price: null };
  const creditPerContract = shortLeg.quantity > 0 ? position.creditReceived / (shortLeg.quantity * 100) : position.creditReceived / 100;
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

async function loadPositions(): Promise<{ positions: Position[]; pendingOrders: PendingOrder[] }> {
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

  const groups: Record<string, any[]> = {};
  for (const pos of optionPositions) {
    const key = `${pos['underlying-symbol']}::${pos['expires-at']?.slice(0, 10) ?? 'unknown'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pos);
  }

  const allOptionSymbols = optionPositions.map((p: any) => p.symbol).filter(Boolean);
  const currentPrices: Record<string, number> = {};
  const unpriceableSymbols = new Set<string>();
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
          if (!twoSided && mark <= 0) unpriceableSymbols.add(sym);
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

  let intentOverrides: Record<string, PositionIntent> = {};
  try {
    const intentRes = await fetch('/api/position-intent');
    if (intentRes.ok) intentOverrides = (await intentRes.json())?.intents ?? {};
  } catch {}

  const today = new Date();
  let positions: Position[] = Object.entries(groups).map(([key, legs]) => {
    const [symbol, expDate] = key.split('::');
    const dte = Math.round((new Date(expDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const openedAt = legs[0]?.['created-at']?.slice(0, 10) ?? null;
    const entryDte = openedAt ? Math.round((new Date(expDate).getTime() - new Date(openedAt).getTime()) / (1000 * 60 * 60 * 24)) : dte;
    const putLegs = legs.filter((l: any) => parseOptionSymbol(l.symbol).optionType === 'P');
    const callLegs = legs.filter((l: any) => parseOptionSymbol(l.symbol).optionType === 'C');
    let strategy = 'UNKNOWN';
    if (putLegs.length >= 2 && callLegs.length === 0) strategy = 'BPS';
    else if (callLegs.length >= 2 && putLegs.length === 0) strategy = 'BCS';
    else if (putLegs.length >= 2 && callLegs.length >= 2) strategy = 'IC';
    else if (putLegs.length === 1) strategy = 'PUT';
    else if (callLegs.length === 1) strategy = 'CALL';

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

    let currentValue = 0; let hasCurrentPrices = true;
    for (const leg of legs) {
      const qty = parseInt(leg['quantity'] ?? '1', 10);
      const price = currentPrices[leg.symbol?.replace(/\s+/g, '')];
      if (price == null) { hasCurrentPrices = false; break; }
      currentValue += leg['quantity-direction'] === 'Short' ? price * qty : -(price * qty);
    }
    currentValue = currentValue * 100;

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

    const stopLoss = classifyPositionStopLoss({ legs: positionLegs, creditReceived: Math.abs(creditReceived) }, gtcOrders);

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
      creditReceived: Math.abs(creditReceived),
      currentValue: hasCurrentPrices ? Math.abs(currentValue) : null,
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

  positions = attachEntrySnapshots(positions);

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

// ── Recommendation Engine ──────────────────────────────────────────────────
interface Recommendation { action: ActionType; detail: string; }

// Returns true when this was intentionally entered as a short-dated trade
function isShortDateEntry(pos: Position): boolean {
  return pos.entryDte <= 21;
}

function getRecommendation(pos: Position, trend: TrendResult | null): Recommendation {
  const pnlPct = pos.pnl != null && pos.creditReceived !== 0 ? (pos.pnl / pos.creditReceived) * 100 : 0;
  const targetPct = pos.profitTarget * 100;
  const trendAgainst = trend && ((pos.strategy === 'BPS' && trend.trend === 'downtrend') || (pos.strategy === 'BCS' && trend.trend === 'uptrend'));
  const trendAligns = trend && ((pos.strategy === 'BPS' && trend.trend === 'uptrend') || (pos.strategy === 'BCS' && trend.trend === 'downtrend') || (pos.strategy === 'IC' && trend.trend === 'sideways'));
  const shortDate = isShortDateEntry(pos);
  const breached = pos.buffer != null && pos.buffer <= 0;
  const criticalBuffer = pos.buffer != null && pos.buffer < 2;
  const veryLargeLoss = pnlPct <= -200;
  const shortQty = Math.abs(pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1);
  // stopLossPrice is a per-spread/per-contract option price (e.g. 1.56 = $156 per contract).
  // currentValue is the total buyback value for the whole position, so scale the stop by contracts.
  const stopLossBreached = pos.stopLossPrice != null && pos.currentValue != null && shortQty > 0
    ? pos.currentValue >= (pos.stopLossPrice * 100 * shortQty)
    : false;

  // needsClose only fires for standard entries (entryDte > 21) — short-dated entries skip this
  if (pos.needsClose && pnlPct >= 0) return { action: 'CLOSE_ROLL', detail: `${pos.dte} DTE — close or roll to next expiry` };
  if (pos.needsClose && pnlPct < 0)  return { action: 'MANAGE', detail: `${pos.dte} DTE with loss — review close/roll, don't auto-cut` };

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

// Shared action-relevance gate — used by BOTH the per-card buttons and the bulk
// action bar so they never diverge on which actions apply to a position.
function isActionRelevant(pos: Position, action: ActionType): boolean {
  const rec = getRecommendation(pos, null);
  const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : null;
  if (action === 'TAKE_PROFIT') {
    // Take Profit is a valid manual choice on ANY position currently in the
    // green — not only when the formal target is hit or the engine recommends
    // it. pnl > 0 is the gate; hitTarget / recommendation are kept so the
    // button still shows for at-target positions even if pnl rounds to 0.
    const inProfit = pos.pnl != null && pos.pnl > 0;
    return inProfit || pos.hitTarget || rec.action === 'TAKE_PROFIT';
  }
  if (action === 'CUT_LOSSES') {
    const breached = pos.buffer != null && pos.buffer <= 0;
    const atExtremeLoss = pnlPct != null && pnlPct <= -200;
    const shortQty = Math.abs(pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1);
    const stopLossBreached = pos.stopLossPrice != null && pos.currentValue != null && shortQty > 0
      ? pos.currentValue >= (pos.stopLossPrice * 100 * shortQty)
      : false;
    return breached || atExtremeLoss || stopLossBreached || rec.action === 'CUT_LOSSES';
  }
  if (action === 'PLACE_GTC') {
    return !pos.hasGtc;
  }
  // CLOSE_ROLL and anything else: always applicable.
  return true;
}

// Separate function so getRecommendation stays clean — called in PositionCard render
function getExtendSignal(pos: Position): string | null {
  if (!pos.hasGtc) return null;
  // Never suggest extending on short-dated entries — the goal is fast profit capture, not riding theta longer
  if (isShortDateEntry(pos)) return null;
  const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : 0;
  // Only suggest extension when: profit > 50%, DTE > 25, IVR >= 35, buffer > 5%
  if (
    pnlPct >= 50 &&
    pos.dte >= 25 &&
    (pos.ivr == null || pos.ivr >= 35) &&
    (pos.buffer == null || pos.buffer >= 5)
  ) {
    return `↑ Consider extending — ${pnlPct.toFixed(0)}% profit with ${pos.dte}d left`;
  }
  return null;
}

// ── AI Analysis ───────────────────────────────────────────────────────────
const TRADING_CHAT_PROMPT = `You are a professional options trader and portfolio analyst advising a trader who uses the Options Hunter methodology as a foundation — but you treat those rules as informed guidelines, not rigid constraints.

You are in a live conversation about a specific position or portfolio. The trader has already seen a structured analysis. They are now asking follow-up questions to dig deeper.

CRITICAL CONTEXT RULE:
The first assistant message in the conversation may contain a POSITION SNAPSHOT with actual position numbers. Treat that snapshot as the source of truth for the follow-up answer. Do not ignore it. Do not answer from generic options theory when position data is available.

RESPOND IN PLAIN CONVERSATIONAL PROSE. No JSON. No bullet headers. No structured output format. Talk like a senior trader giving direct advice over the phone — clear, specific, and honest. Use the actual numbers from the snapshot when they matter. Be direct about risk. Don't hedge everything with disclaimers.

You know the methodology deeply:
- BPS for bullish/neutral, BCS for bearish, IC for range-bound
- 50% profit target with GTC at entry, hard close at 21 DTE (only for standard entries > 21 DTE; short-dated entries use lower take-profit thresholds and fast exit before expiry)
- IVR >= 30 for edge, buffer % to short strike is critical, gamma accelerates near expiry
- When to deviate: high IV exceptions, broken thesis, early close to protect profits

For follow-up questions:
- If asked why P&L is positive or negative, compare entry credit, current buyback value, profit captured, DTE, buffer, IV/HV/IVR, theta, gamma, delta, and vega.
- If asked how to watch the trade better in the app, recommend specific fields, alerts, thresholds, and visual indicators.
- If a needed value is missing, say exactly what is missing and what field should be added.
- Never claim IV expansion or contraction unless IV-at-entry or prior IV is provided.

Keep responses focused and concise — 3-6 sentences unless the question genuinely requires more. If the trader asks about rolling, give specific guidance on strikes and expiry. If they ask about risk, quantify it. If they're thinking about something wrong, say so directly.`;

const TRADING_SYSTEM_PROMPT = `You are a professional options trader and portfolio analyst with deep expertise in selling premium through credit spreads, cash-secured puts, covered calls, and wheel-style income trades. You advise a trader who follows the Options Hunter methodology as a foundation — but you treat those rules as informed guidelines, not rigid constraints. You understand when deviation is appropriate.

CORE METHODOLOGY (know it deeply, apply it intelligently):
- Strategies: Bull Put Spread (BPS) for bullish/neutral, Bear Call Spread (BCS) for bearish, Iron Condor (IC) for range-bound
- Entry rules (as guidelines): IVR ≥ 30, DTE 30-45, credit ≥ 1/3 spread width, OI ≥ 500, bid-ask ≤ $0.10
- Target exits: 50% profit (place GTC at entry), hard close at 21 DTE regardless of P&L — BUT ONLY when entry DTE was > 21. Short-dated entries (entered at ≤ 21 DTE) follow a different framework: maximize profit quickly, lower the take-profit threshold to 30-40%, tighten the loss tolerance, and exit before expiry to avoid pin/assignment risk. The 21 DTE hard-close rule does NOT apply to intentional short-dated trades.
- Short strike deltas: BPS -0.20 to -0.30, BCS +0.20 to +0.30, IC ±0.16 to ±0.20
- IC requires sideways price action 2+ weeks, no higher highs/lower lows

PRICE SUPPORT ANALYSIS — CRITICAL FOR BULLISH PUT TRADES:
- For CSPs and bull put spreads, evaluate whether the short put strike is below meaningful recent support.
- Use the support analysis supplied in the position prompt: 20-day low, 50-day low, swing lows, MA20, MA50, nearest support zone, strike-vs-support %, and support verdict.
- For BPS/CSP, ideal structure is: current price above support zone, and short strike at or below support.
- GOOD support means the short strike is below or near recent support and price trend is holding above key moving averages.
- CAUTION means the short strike is sitting inside/near the support zone or trend confirmation is mixed.
- BAD means the short strike is above support, price has lost MA20/MA50, or support must hold perfectly for the trade to survive.
- Do not give HIGH confidence to a new or continuing bullish put recommendation unless support analysis is GOOD or the rationale clearly explains why CAUTION is acceptable.
- Support analysis is not a guarantee. It is a risk-quality filter, not a mechanical trade signal.

TRADER INTENT — HONOR IT OVER STRUCTURE:
- Each position carries a STATED INTENT: acquisition, income, or neutral.
- ACQUISITION means the trader wants the shares: assignment is the planned outcome,
  NOT a failure. Do not recommend defensive rolls or cite assignment risk as a
  negative for an acquisition-intent put that is ITM or near it — instead judge
  whether the effective basis is still attractive given the trend.
- INCOME means avoid assignment and manage to keep the short OTM.
- NEUTRAL means weigh both outcomes without preference.
- Stated intent OVERRIDES the structural read. A short put marked income is managed
  like income even though its structure could wheel; a spread is never "acquisition."

CSP / WHEEL MANAGEMENT — CRITICAL:
- A cash-secured put is NOT managed like a bull put spread.
- If strategy is CSP, PUT, or a single short put with no long protective leg, assume the trader may be using it for wheel-income unless the prompt says otherwise.
- For CSP/wheel positions, assignment can be acceptable and may be part of the plan.
- Do NOT apply the 21 DTE hard-close rule automatically to CSP/wheel positions.
- For CSP/wheel positions, evaluate:
  1. premium remaining,
  2. theta per day,
  3. effective assignment basis,
  4. stock price versus short strike,
  5. delta/assignment risk,
  6. whether rolling improves basis for a net credit.
- Recommend HOLD when the CSP is OTM, theta-positive, has meaningful premium left, and assignment is acceptable.
- Recommend TAKE_PROFIT or CLOSE when 80-90% of premium has been captured.
- Recommend ROLL only when expiration is near, meaningful extrinsic value remains, and the roll can be done for a net credit or better basis.
- Recommend accepting assignment when the effective basis is attractive and the trader is willing to own shares.

WHEN TO DEVIATE FROM RULES (apply professional judgment):
- If IV is very high (IVR > 70) and credit is exceptional, a wider spread or slightly aggressive delta can be justified
- If a position is at 40% profit but 15 DTE with gamma risk rising sharply, closing early beats waiting for 50%
- If trend has reversed hard against a spread, cutting losses at 1.5x credit is better than waiting for 2x
- If IVR just dropped below 30 mid-trade but P&L is positive, holding can still make sense if trend confirms
- Earnings risk only exists if earnings occurs on or before the option expiration; never mention post-expiration earnings as a current-position risk
- Sometimes doing nothing is the hardest but best trade

P&L RELIABILITY — READ BEFORE REACTING TO ANY LOSS:
- The position prompt states whether the open P&L is RELIABLE or a QUOTE ARTIFACT.
- If P&L is flagged unreliable, or if the loss magnitude conflicts with the
  position geometry (a double-digit OTM buffer with low prob of max loss should
  NOT show a large realizable loss), trust the GEOMETRY — buffer %, DTE, distance
  to the short strike — over the raw mark. Say so explicitly and do not recommend
  CLOSE/CUT_LOSSES on the strength of a number you have been told is unreliable.
- A wide or one-sided bid/ask on a high-IV or illiquid chain routinely prints a
  phantom loss. Price the position at mid in your head and discount the artifact.
- A RELIABLE loss is NOT automatically an actionable loss. A credit spread that is
  comfortably OTM routinely shows an open paper loss for most of its life because:
  (a) the trade is short vega, so any rise in IV after entry inflates buyback even
  though price has not moved toward the strike; (b) the short leg still holds time
  value you have not yet earned — that unrealized extrinsic reads as a loss until
  theta grinds it out; (c) closing means buying back at the ask, and slippage on an
  illiquid high-IV chain is real cost you would not pay if held. None of these means
  the position is failing. A deep-OTM spread showing red is a WINNING trade that is
  simply early — do NOT recommend CLOSE/CUT_LOSSES on the strength of that paper loss.

DO NOT MANUFACTURE URGENCY:
- HARD GATE (concept, not keyword): if the OTM buffer is >= 5%, you may NOT cite
  expiry-proximity danger as a close reason under ANY label — not "gamma," not
  "acceleration risk," not "late-stage risk," not "proximity to expiry," not
  "gamma issues eroding returns." These are the same forbidden concept renamed.
  At a 5%+ buffer the position is far from the strike and expiry proximity is NOT a
  danger. Before listing ANY risk, state the buffer and whether it is >= 5%; if it
  is, every risk you list must be a REAL geometry/trend/event risk, not a Greek that
  is normal for the position. Only below a 5% buffer near expiry may expiry-proximity
  risk legitimately factor in.
- A safe, deep-OTM, near-max-profit position approaching 21 DTE should be framed
  as RULE-BASED PROFIT-TAKING (take the profit, redeploy capital), NOT as loss
  mitigation. These lead to the same action for opposite reasons — name the right one.
- Reserve CLOSE/CUT_LOSSES for genuine geometry risk (thin buffer near expiry,
  trend broken against the thesis, loss approaching the stop), not for normal
  open-trade noise on a position that is working.
- SELF-CONSISTENCY: your recommendation and reasoning may not contradict your own
  stated geometry. If you describe a position as comfortably/significantly OTM with
  a healthy buffer and low prob of max loss, you may NOT then recommend a danger-
  driven exit. The ONLY valid reason to close such a position is the 21-DTE TIME
  RULE (standard entries only) — and you must frame it that way: rule-based exit to
  recycle capital and avoid the final-weeks gamma zone, NOT loss mitigation and NOT
  current danger. Say plainly that the position is safe by geometry and you are
  closing to honor the time rule.

WEIGH THE WHOLE PICTURE, NOT JUST THE GREEKS:
- Greeks are real but they are inputs, not the verdict. Weigh, in order: position
  geometry (buffer, DTE, prob of max loss, defined vs undefined risk), then Greeks,
  then market direction vs the position's directional bias, then news/catalysts
  (earnings within expiry first), then fundamentals and the trader's stated intent.
- Be neither optimistic nor pessimistic. Give the honest call a senior trader would
  give on this exact position. If the right answer depends on unknowable intent or
  direction, say MEDIUM confidence — never fake HIGH confidence to sound decisive.

ANALYSIS PRINCIPLES:
- Always consider the trend direction vs. the strategy type — a BPS in a downtrend is broken thesis
- Buffer % to short strike is DTE-dependent — below 2% is always critical; below 3% matters at > 21 DTE; below 5% is only worth noting at > 30 DTE. A 3% buffer at 5 DTE is fine — theta is destroying the spread daily.
- NEVER label a buffer as "critical threshold" or "minimum acceptable" unless it is actually below 2%. A 3% buffer at 44 DTE is a WATCH item, not a crisis. Use language like "worth monitoring" or "on the tighter side" instead.
- IV edge = IV minus HV30. If either is unknown, say so but don't list it as a risk unless it's genuinely missing AND relevant to the recommendation.
- High gamma near expiry (DTE < 21) magnifies risk exponentially — treat with respect
- IV vs HV comparison: if IV >> HV (IV premium), edge exists; if IV ≈ HV, edge is thin
- Theta decay accelerates in final 3 weeks — this is your friend if positioned correctly
- Net delta tells you your directional exposure — you're supposed to be mostly neutral

OUTPUT FORMAT (JSON only, no prose outside the JSON):
For position analysis:
{
  "recommendation": "HOLD|CLOSE|ROLL|TAKE_PROFIT|CUT_LOSSES|WATCH|MANAGE",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "1-2 sentence TL;DR",
  "reasoning": "2-3 sentence explanation of your reasoning, including what the key factors are",
  "risks": ["risk 1", "risk 2", "risk 3"],
  "catalysts": ["positive factor 1", "positive factor 2"],
  "deviatesFromRules": true|false,
  "deviationNote": "null or explanation of why professional judgment overrides the standard rule"
}

For portfolio analysis:
{
  "netDeltaBias": "BULLISH|BEARISH|NEUTRAL",
  "dominantRisk": "single sentence describing the biggest portfolio-level risk",
  "sectorConcentration": ["sector concern 1", "sector concern 2"],
  "thetaYield": "qualitative assessment of theta capture rate",
  "topRisks": ["risk 1", "risk 2", "risk 3"],
  "priorityActions": ["highest priority action", "second priority", "third priority"],
  "marketContext": "how current market conditions affect this portfolio",
  "summary": "2-3 sentence overall portfolio assessment"
}

Be direct. Be honest. If a position is in trouble, say so. If a rule should be broken, explain why.`;

function buildPositionPrompt(pos: Position, trend: TrendResult | null): string {
  const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? ((pos.pnl / pos.creditReceived) * 100).toFixed(1) : 'unknown';
  const netEdge = netEdgeLive(pos);
  const netEdgePk = netEdgePeak(pos);
  const thetaDollars = pos.theta != null ? pos.theta * 100 : null;
  const gammaCostDollars = (netEdge != null && thetaDollars != null) ? (thetaDollars - netEdge) : null;
  const netEdgeOffPeakPct = (netEdge != null && netEdgePk != null && netEdgePk > 0) ? ((netEdge - netEdgePk) / netEdgePk) * 100 : null;
  const ivEdge = pos.iv != null && pos.hv30 != null ? (pos.iv - pos.hv30) : null;
  const shortPut = pos.legs.find(l => l.direction === 'Short' && l.optionType === 'P');
  const longPut = pos.legs.find(l => l.direction === 'Long' && l.optionType === 'P');
  const shortCall = pos.legs.find(l => l.direction === 'Short' && l.optionType === 'C');
  const longCall = pos.legs.find(l => l.direction === 'Long' && l.optionType === 'C');

  const isCspLike = !!shortPut && !longPut && !shortCall && !longCall;
  const isDefinedRiskSpread =
    pos.strategy === 'BPS' ||
    pos.strategy === 'BCS' ||
    pos.strategy === 'IC' ||
    (!!shortPut && !!longPut) ||
    (!!shortCall && !!longCall);

  const shortQty = Math.max(1, Math.abs(shortPut?.quantity ?? shortCall?.quantity ?? 1));
  const creditPerContract = pos.creditReceived / 100 / shortQty;
  const currentBuybackPerContract = pos.currentValue != null ? pos.currentValue / 100 / shortQty : null;
  const premiumCapturedPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : null;

  const effectiveAssignmentBasis =
    isCspLike && shortPut
      ? shortPut.strikePrice - creditPerContract
      : null;

  const strategyIntent = isCspLike
    ? 'wheel-income / cash-secured put'
    : isDefinedRiskSpread
    ? 'defined-risk spread'
    : 'other options position';

  const assignmentWilling = isCspLike
    ? 'yes — assignment is acceptable if basis is attractive'
    : 'no / not primary intent';

  const support = trend?.supportAnalysis;
  const supportText = support
    ? `Support verdict: ${support.verdict} (${support.score}/100)
Lookback: ${support.lookbackDays} trading days
Current price: ${support.price != null ? `$${support.price.toFixed(2)}` : 'unknown'}
Short put strike evaluated: ${support.shortStrike != null ? `$${support.shortStrike.toFixed(2)}` : 'not applicable'}
Nearest support: ${support.nearestSupport != null ? `$${support.nearestSupport.toFixed(2)}` : 'unknown'}
Support zone: ${support.supportZoneLow != null && support.supportZoneHigh != null ? `$${support.supportZoneLow.toFixed(2)} - $${support.supportZoneHigh.toFixed(2)}` : 'unknown'}
20-day low: ${support.low20 != null ? `$${support.low20.toFixed(2)}` : 'unknown'}
50-day low: ${support.low50 != null ? `$${support.low50.toFixed(2)}` : 'unknown'}
Recent swing low: ${support.swingLow != null ? `$${support.swingLow.toFixed(2)}` : 'unknown'}
MA20: ${support.ma20 != null ? `$${support.ma20.toFixed(2)}` : 'unknown'}
MA50: ${support.ma50 != null ? `$${support.ma50.toFixed(2)}` : 'unknown'}
Strike vs nearest support: ${support.strikeVsSupportPct != null ? `${support.strikeVsSupportPct.toFixed(1)}%` : 'unknown'}
Price vs MA20: ${support.priceVsMa20Pct != null ? `${support.priceVsMa20Pct.toFixed(1)}%` : 'unknown'}
Price vs MA50: ${support.priceVsMa50Pct != null ? `${support.priceVsMa50Pct.toFixed(1)}%` : 'unknown'}
Support reason: ${support.reason}`
    : 'Support analysis unavailable';

  return `Analyze this open options position:

POSITION: ${pos.symbol} ${pos.strategy}
Stated intent: ${pos.intent.toUpperCase()} (${pos.intent === 'acquisition' ? 'trader WANTS the shares — assignment is success, not failure; do not treat ITM/assignment risk as a loss' : pos.intent === 'income' ? 'pure premium income — avoid assignment; manage to keep the short OTM' : 'directionally neutral — weigh both sides without an assignment preference'})
Structural read (auto): ${strategyIntent}
Assignment willing: ${assignmentWilling}
Effective assignment basis: ${effectiveAssignmentBasis != null ? `$${effectiveAssignmentBasis.toFixed(2)}` : 'not applicable'}
Expiry: ${pos.expDate} | DTE: ${pos.dte} | Entry DTE: ${pos.entryDte}
Strikes: ${pos.legs.map(l => `${l.direction} ${l.strikePrice}${l.optionType}`).join(', ')}
Credit received: $${pos.creditReceived.toFixed(2)} total | $${creditPerContract.toFixed(2)} per short contract
Current buyback: $${pos.currentValue?.toFixed(2) ?? 'unknown'} total | ${currentBuybackPerContract != null ? `$${currentBuybackPerContract.toFixed(2)} per short contract` : 'unknown'}
P&L: ${pos.pnl != null ? `$${pos.pnl.toFixed(2)} (${pnlPct}% of credit)` : 'unknown'} ${pos.pnl != null ? (pos.pnlReliable ? '[RELIABLE mark]' : '[QUOTE ARTIFACT — illiquid/one-sided legs; trust geometry over this number]') : ''}${pos.pnl != null && pos.pnlReliable && pos.buffer != null && pos.buffer >= 5 ? ' — NOTE: reliable does not mean actionable; a paper loss on a comfortably-OTM spread is normal (short vega + unearned time value), not a reason to close' : ''}
Premium captured: ${premiumCapturedPct != null ? `${premiumCapturedPct.toFixed(1)}%` : 'unknown'}
Profit target: ${Math.round(pos.profitTarget * 100)}% ($${pos.targetPrice.toFixed(2)})
Max risk: $${pos.maxRisk.toFixed(2)}

MARKET DATA:
Stock price: $${pos.stockPrice?.toFixed(2) ?? 'unknown'}
Buffer to short strike: ${pos.buffer?.toFixed(1) ?? 'unknown'}%${pos.buffer != null && pos.buffer >= 5 ? ` — SAFE BY GEOMETRY: short strike is ${pos.buffer.toFixed(1)}% away, so breach/assignment is unlikely and a paper loss here is not danger. Do NOT cite breach proximity as a close reason. HOWEVER, a genuinely negative NET DAILY EDGE (see below) IS a valid economic close/roll reason even at a wide buffer — thin premium for the gamma risk carried is about risk/reward, not breach. Frame any close as either the 21-DTE recycling rule or weak net-edge economics, not as breach danger.` : pos.buffer != null && pos.buffer < 2 ? ` — TIGHT: under 2% buffer, genuine breach risk; defensive posture warranted.` : ''}
OTM buffer at entry / first tracked: ${pos.otmAtEntry != null ? `${pos.otmAtEntry.toFixed(1)}%` : 'unknown'}
DTE entry/now: ${pos.dteAtEntry ?? pos.entryDte ?? 'unknown'} → ${pos.dte}
IVR: ${pos.ivr ?? 'unknown'}
Current IV: ${pos.iv ?? 'unknown'}%
IV at entry / first tracked: ${pos.ivAtEntry ?? 'unknown'}%
IV change: ${pos.ivAtEntry != null && pos.iv != null ? `${(pos.iv - pos.ivAtEntry).toFixed(1)} pts` : 'unknown'}
HV30: ${pos.hv30 ?? 'unknown'}%
IV edge (IV - HV30): ${ivEdge != null ? `${ivEdge.toFixed(1)}%` : 'unknown'}
Beta: ${pos.beta ?? 'unknown'}

PRICE SUPPORT ANALYSIS:
${supportText}

GREEKS (net position):
Delta: ${pos.netDelta?.toFixed(4) ?? 'unknown'} (entry/now: ${pos.deltaAtEntry != null && pos.netDelta != null ? `${pos.deltaAtEntry.toFixed(4)} → ${pos.netDelta.toFixed(4)}` : 'unknown'})
Theta: ${pos.theta?.toFixed(4) ?? 'unknown'} (entry/now: ${pos.thetaAtEntry != null && pos.theta != null ? `${pos.thetaAtEntry.toFixed(4)} → ${pos.theta.toFixed(4)}` : 'unknown'})
Gamma: ${pos.gamma?.toFixed(4) ?? 'unknown'} (gamma's DOLLAR cost scales with the underlying's daily dollar move squared — it can be material even far OTM on large-notional names like SPX/NDX where a 1-sigma day is hundreds of points. Do NOT assume gamma is negligible just because the buffer is wide; see NET DAILY EDGE below for the actual theta-vs-gamma economics.)
Vega: ${pos.netVega?.toFixed(4) ?? 'unknown'} (short vega — IV rises inflate buyback as paper loss, not directional danger)

NET DAILY EDGE (theta vs gamma economics):
Net edge: ${netEdge != null ? `$${netEdge.toFixed(0)}/day` : 'unknown'}${thetaDollars != null && gammaCostDollars != null ? ` (collecting $${thetaDollars.toFixed(0)}/d theta minus ~$${gammaCostDollars.toFixed(0)}/d expected gamma cost)` : ''}
Peak net edge (this position, tracked): ${netEdgePk != null ? `$${netEdgePk.toFixed(0)}/day` : 'unknown'}${netEdgeOffPeakPct != null ? ` — currently ${netEdgeOffPeakPct >= 0 ? 'at/near' : `${Math.abs(netEdgeOffPeakPct).toFixed(0)}% below`} peak` : ''}
What this means: net edge estimates whether the remaining premium still justifies the gamma risk of holding. It is a RISK/REWARD measure, NOT a current loss — a profitable, deep-OTM position can have negative net edge and still be worth holding if breach risk is genuinely low.
How to use it (conservative posture — preserve capital first):
- Net edge clearly positive AND near peak AND comfortable buffer → the back half of premium is worth reaching for; stretching toward a 75% profit target is justified.
- Net edge fading off its peak (even if still positive) → the easy theta is harvested; favor banking at the standard 50% target rather than stretching.
- Net edge negative → remaining premium no longer compensates for the gamma risk; favor close/roll. Lean toward closing when corroborated by tight buffer, adverse trend, or weak support. The ONLY reason to keep holding a negative-net-edge position is that it is comfortably profitable and deep-OTM with genuinely low breach risk (don't forfeit a near-certain winner).
- Never panic-close a likely winner on net edge alone; never stretch to 75% when net edge is negative.

OPERATIONAL STATUS:
GTC order: ${pos.hasGtc ? 'Yes — profit target working' : 'No — unprotected'}
Stop loss: ${pos.stopLossStatus} ${pos.stopLossPrice ? `@ $${pos.stopLossPrice}` : ''}
Earnings within expiry: ${isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? `Yes — ${pos.earningsDate}` : 'No'}

TREND ANALYSIS:
Direction: ${trend?.trend ?? 'unknown'} (confidence: ${trend?.confidence ?? 'unknown'}%)
Suggested strategy: ${trend?.strategy ?? 'unknown'}
Reason: ${trend?.reason ?? 'none'}

Flags: ${[
  !isCspLike && pos.needsClose ? '⚠ AT 21 DTE — defined-risk spread should be closed or rolled unless there is a clear reason to hold' : '',
  isCspLike && pos.dte <= 21 ? `ℹ CSP under 21 DTE — evaluate premium, theta, delta, and assignment basis; do not auto-close` : '',
  pos.entryDte <= 21 && !isCspLike ? `ℹ SHORT-DATED ENTRY — entered at ${pos.entryDte} DTE, now ${pos.dte} DTE. Goal is fast profit capture, NOT the standard 50%/21-DTE framework. The 21-DTE hard-close rule does NOT apply; do NOT use close-now / time-rule framing for this position. Evaluate for early exit at 30-40% or on any sign of adverse movement.` : '',
  pos.hitTarget ? '✓ Profit target hit' : '',
  !pos.hasGtc ? '⚠ No GTC order' : '',
  !isCspLike && pos.buffer != null && pos.buffer < 2 ? `⚠ CRITICAL spread buffer ${pos.buffer.toFixed(1)}% at ${pos.dte} DTE — near breach` : '',
  isCspLike && pos.buffer != null && pos.buffer < 2 ? `ℹ CSP tight buffer ${pos.buffer.toFixed(1)}% — assignment becoming more likely, not automatic failure` : '',
  !isCspLike && pos.buffer != null && pos.buffer < 3 && pos.dte > 14 ? `⚠ Tight spread buffer ${pos.buffer.toFixed(1)}% at ${pos.dte} DTE` : '',
  !isCspLike && pos.buffer != null && pos.buffer < 5 && pos.dte > 30 ? `ℹ Spread buffer ${pos.buffer.toFixed(1)}% with ${pos.dte} DTE — watch closely` : '',
  (isCspLike || pos.strategy === 'BPS') && support?.verdict === 'BAD' ? '⚠ Support check BAD — short put strike is not well protected by recent price support' : '',
  (isCspLike || pos.strategy === 'BPS') && support?.verdict === 'CAUTION' ? 'ℹ Support check CAUTION — strike is near support or trend confirmation is mixed' : '',
  isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? `⚠ Upcoming earnings ${pos.earningsDate}` : '',
].filter(Boolean).join(', ') || 'None'}

EXPERT DECISION CHECKLIST:
Before giving the recommendation, evaluate all of these:

1. POSITION TYPE
- Identify the exact trade: CSP/short put, covered call, vertical spread, iron condor, PMCC, naked option, or other.
- Do not assume covered call unless long stock plus short call exists.
- Explain the management logic for that specific structure.
- Do not manage a CSP like a BPS, and do not manage a BPS like a CSP.

2. DTE MANAGEMENT
- First determine whether this is a CSP/wheel position or a defined-risk spread.
- For defined-risk spreads: 21 DTE matters. Manage actively as expiration approaches because gamma risk can overwhelm the remaining reward.
- For CSP/wheel positions where assignment is acceptable: DO NOT treat 21 DTE, 16 DTE, or tight OTM buffer as automatic close/roll triggers.
- For CSP/wheel positions, compare remaining premium versus theta/day, assignment basis, and willingness to own shares.
- For CSP/wheel positions, HOLD is valid when:
  1. assignment basis is acceptable,
  2. theta is still meaningful,
  3. there is still premium left to harvest,
  4. the trader is comfortable owning shares.
- For CSP/wheel positions, ROLL only when:
  1. the roll produces a net credit,
  2. the roll improves basis or reduces assignment risk,
  3. the trader prefers avoiding assignment instead of owning shares now.
- For CSP/wheel positions, ACCEPT ASSIGNMENT is valid when the effective basis is attractive.

3. PROFIT CAPTURE
- Calculate profit captured as current P&L divided by original credit.
- For defined-risk spreads: if profit is near or above 50%, favor TAKE_PROFIT.
- For CSP/wheel positions: favor CLOSE/TAKE_PROFIT when 80-90% of premium has been captured.
- If CSP premium is not exhausted and assignment is acceptable, HOLD/WATCH can be correct.
- If loss exceeds planned stop or risk/reward is poor on a spread, recommend MANAGE/CUT_LOSSES.

4. DISTANCE TO STRIKE / BUFFER
- Use OTM % and stock price relative to short strike.
- Interpret buffer by strategy type.

For defined-risk spreads:
- More buffer is good; shrinking buffer is danger.
- Under 2-3% buffer near 21 DTE is high risk.
- 3-5% buffer near 14-21 DTE is moderate risk.
- >5% buffer generally supports holding if Greeks are favorable.
- A shrinking buffer can justify MANAGE, CLOSE, or ROLL because probability and spread value can expand before breach.

For CSP / short put / wheel-income:
- More buffer is good, but shrinking buffer means assignment is becoming more likely, not that the trade has failed.
- Under 2-3% buffer near 21 DTE is high assignment risk, not an automatic close signal.
- 3-5% buffer near 14-21 DTE is moderate assignment risk.
- >5% buffer generally supports holding if theta and premium remaining are favorable.
- If assignment is acceptable and effective assignment basis is attractive, a narrow buffer can still support HOLD/WATCH.
- If assignment is not acceptable, then a narrow buffer supports ROLL or CLOSE.

For covered calls / short calls:
- More upside buffer is good unless the trader is willing to have shares called away.
- If call-away is acceptable, shrinking buffer is not automatically bad.

5. PRICE SUPPORT CHECK
- For bullish put trades (CSP or BPS), evaluate whether the short put strike is below meaningful recent support.
- GOOD: current price is above the support zone, trend is above MA20/MA50 or improving, and the short strike is at or below support.
- CAUTION: the short strike is inside/near support, price is close to MA20/MA50, or support is not clearly below the strike.
- BAD: the short strike is above support, price has lost key moving averages, or support must hold perfectly for the trade to work.
- Do not recommend HIGH confidence for CSP/BPS unless support verdict is GOOD or the reasoning clearly explains why CAUTION is acceptable.
- For CSP/wheel positions, weak support does not automatically mean CLOSE, but it should lower confidence and may support WATCH/ROLL if assignment is no longer attractive.
- For defined-risk spreads, weak support should increase defensive posture because spread loss can expand before the strike is breached.

6. GREEKS
- A Greek is only a RISK when it is ABNORMAL for this position, never by default.
  Do not list a Greek as a risk if it sits within normal entry parameters.
- Delta: directional exposure / rough assignment proxy. A short-put delta of 0.20-0.30
  is NORMAL (it is the entry target) — do NOT call it 'high delta' or a risk.
- Gamma — OBJECTIVE RULE (no judgment calls): gamma may be cited as a risk ONLY when the
  NET DAILY EDGE figure quantifies it as one. Specifically:
    * If net edge is negative OR gamma cost is a large fraction of theta (roughly half or more),
      gamma IS a real cost — cite it, and cite the DOLLAR figure (e.g. "gamma costs ~$25/d vs $4/d
      theta, net edge -$21/d"). Never cite gamma risk without the number behind it.
    * If net edge is positive AND gamma cost is a small fraction of theta, gamma is NOT a risk —
      do NOT cite it as one under any name (gamma, acceleration, late-stage risk, proximity-to-
      expiry risk, "gamma increasing as DTE decreases"). These are all forbidden when the number
      does not support them, regardless of buffer or DTE.
    * NEVER use vague time-decay gestures like "gamma risk increases with expiry approaching" as a
      standalone claim. Gamma is either quantified by net edge as a cost, or it is not mentioned.
- Theta: remaining income reward.
- Vega: short vega means an IV rise shows as paper loss; that is expected, not danger.
- Compare theta versus gamma using the NET DAILY EDGE number, not intuition:
  - Net edge clearly positive → theta is winning; holding may be valid.
  - Net edge negative → gamma is winning; favor close/roll on spreads, citing the dollar figures.
- Mention whether the Greeks support HOLD, CLOSE, or ROLL.

7. VOLATILITY
- Compare IV, HV, and IVR.
- High IVR can support keeping short premium trades if risk is controlled.
- Low IVR weakens new short-premium rolls.
- If IV is much higher than HV, short premium has edge but also event-risk exposure.
- If IV is collapsing after earnings, favor taking profit sooner.

8. TREND / MARKET CONTEXT
- Use trend direction and confidence.
- For bullish/sideways trend, CSP/put spreads are stronger.
- For bearish/sideways trend, covered calls/call spreads are stronger.
- If trend conflicts with the position, lower confidence or recommend manage.
- Consider broad market risk if the underlying has high beta.

9. EARNINGS / CATALYSTS
- Only treat earnings as a risk if earningsDate is today or future and before expiration.
- If earningsDate is in the past, state that it is not a current earnings risk.
- If earnings is within the option cycle, favor closing/rolling unless intentionally holding through earnings.

10. ORDER / EXECUTION
- If GTC target is missing, recommend placing one.
- If stop loss is missing or loose, flag it.
- If rolling, say whether to roll out, up/down, and why.
- Do not recommend rolling unless the new trade improves duration, credit, delta, support location, or risk.

11. SPREAD DEFENSE MODE
For defined-risk spreads only:
- GREEN: buffer >8%, delta <10, favorable theta/risk, and support is GOOD or not relevant.
- YELLOW: buffer 5-8%, delta 10-15, DTE <30, or support is CAUTION.
- ORANGE: buffer 3-5%, delta 15-20, DTE <21, or support is BAD.
- RED: buffer <3%, delta >20, gamma risk rising, loss >75% of credit, or price has clearly lost support.
- RED spreads should rarely receive HOLD.
- If remaining reward is small compared with remaining risk, favor TAKE_PROFIT/CLOSE.

12. CSP/WHEEL OVERRIDE RULE
- If the position is a CSP/short put, assignment is acceptable, and the effective assignment basis is attractive, do not recommend MANAGE, CLOSE, or ROLL solely because DTE is under 21 or buffer is under 2%. The recommendation should usually be HOLD/WATCH unless theta has collapsed, the trader no longer wants the shares, support has failed badly enough to change assignment desirability, earnings risk is unacceptable, or rolling clearly improves basis for a net credit.

13. FINAL ACTION
Give one clear action:
- HOLD
- WATCH
- TAKE_PROFIT
- CLOSE
- ROLL
- MANAGE
- CUT_LOSSES

The summary must sound like an expert trader talking to me directly, using the actual numbers from the position.

Return JSON only in this exact shape:
{
  "recommendation": "HOLD|CLOSE|ROLL|TAKE_PROFIT|CUT_LOSSES|WATCH|MANAGE",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Direct recommendation using actual numbers.",
  "reasoning": "Expert-level paragraph covering position type, DTE, profit %, OTM buffer, price support, delta, theta, gamma, vega, IV/HV/IVR, trend, earnings, assignment basis, and execution.",
  "risks": ["specific risk 1", "specific risk 2", "specific risk 3"],
  "catalysts": ["specific factor in favor 1", "specific factor in favor 2"],
  "deviatesFromRules": false,
  "deviationNote": null
}`;
}

function buildPortfolioPrompt(positions: Position[]): string {
  const lines = positions.map(p => {
    const pnlPct = p.pnl != null && p.creditReceived > 0 ? ((p.pnl / p.creditReceived) * 100).toFixed(0) : '?';
    return `${p.symbol} ${p.strategy}: DTE ${p.dte}, P&L ${pnlPct}%, buffer ${p.buffer?.toFixed(1) ?? '?'}%, IVR ${p.ivr ?? '?'}, ${p.needsClose ? 'NEEDS CLOSE' : p.hitTarget ? 'TARGET HIT' : 'active'}`;
  });

  const totalCredit = positions.reduce((s, p) => s + p.creditReceived, 0);
  const totalPnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const totalAtRisk = positions.reduce((s, p) => s + p.maxRisk, 0);
  const portfolioGreeks = calculatePortfolioGreeks(positions);
  const urgentCount = positions.filter(p => p.needsClose || p.hitTarget || (p.buffer != null && p.buffer < 5)).length;

  return `Analyze this options portfolio as a whole:

PORTFOLIO SUMMARY:
${positions.length} open positions | ${urgentCount} requiring immediate attention
Total credit collected: $${totalCredit.toFixed(2)}
Current P&L: $${totalPnl.toFixed(2)} (${totalCredit > 0 ? ((totalPnl / totalCredit) * 100).toFixed(1) : 0}% of credit)
Total at risk: $${totalAtRisk.toFixed(2)}
Net delta: ${portfolioGreeks.deltaShares != null ? `${portfolioGreeks.deltaShares.toFixed(0)} share-equivalent` : 'N/A'}
Net theta/d: ${portfolioGreeks.thetaPerDay != null ? `$${portfolioGreeks.thetaPerDay.toFixed(0)}/d` : 'N/A'}
Net gamma: ${portfolioGreeks.gammaSharesPerDollar != null ? `${portfolioGreeks.gammaSharesPerDollar.toFixed(1)} shares per $1 move` : 'N/A'}
Net vega: ${portfolioGreeks.vegaPerIvPoint != null ? `$${portfolioGreeks.vegaPerIvPoint.toFixed(0)} per 1 IV point` : 'N/A'}

POSITIONS:
${lines.join('\n')}

STRATEGY MIX:
BPS: ${positions.filter(p => p.strategy === 'BPS').length} | BCS: ${positions.filter(p => p.strategy === 'BCS').length} | IC: ${positions.filter(p => p.strategy === 'IC').length} | Other: ${positions.filter(p => !['BPS','BCS','IC'].includes(p.strategy)).length}

SYMBOLS: ${positions.map(p => p.symbol).filter((v, i, a) => a.indexOf(v) === i).join(', ')}

DTE DISTRIBUTION:
< 21 DTE: ${positions.filter(p => p.dte < 21).length} positions
21-30 DTE: ${positions.filter(p => p.dte >= 21 && p.dte <= 30).length} positions
> 30 DTE: ${positions.filter(p => p.dte > 30).length} positions

Provide portfolio-level analysis as JSON only.`;
}

const TRADING_VERDICT_PROMPT = `You are the most experienced options trader in the world. You have traded through every market cycle since the 1980s — Black Monday, the dot-com crash, 2008, COVID. You have made and lost fortunes and learned exactly when to hold, when to run, and when greed kills a good trade.

A trader is about to take an action on an open options position. Your job is to evaluate that specific action and deliver a verdict — instantly, honestly, without hedging.

You are NOT a financial advisor covering yourself with disclaimers. You are a mentor who will tell someone directly when they are about to make a stupid mistake, and who will give them confidence when the move is smart.

VERDICT SCALE:
- GO: This is a smart move. The data supports it. Execute it.
- CAUTION: This might work but there are real risks. Proceed carefully and know what you're risking.
- STOP: This is a mistake. The numbers say so. You need a very good reason to override this.

WHAT TO EVALUATE PER ACTION:
EXTEND_PROFIT (e.g. moving 50% target to 70%):
- Is the remaining premium worth the risk? Calculate: remaining_credit = credit × (1 - new_target). Is that worth holding?
- DTE: if < 21, gamma risk makes holding dangerous. If > 30, extension is more reasonable.
- Trend: if trend is confirmed aligned, extension has merit. If trend is uncertain or against, don't be greedy.
- Earnings approaching: never extend through an earnings event for extra premium.
- CRITICAL: If a position's earningsDate field is null or not provided, DO NOT guess, assume, or speculate about earnings timing. Instead use web search to look up the actual next earnings date for that ticker before giving any earnings-related advice. Never hallucinate earnings dates.
- Buffer: if buffer < 5%, don't extend — protect the capital.

CLOSE_ROLL (closing and re-entering):
- Are you rolling a winner (good) or a loser (dangerous — you're often just deferring pain)?
- Can you collect meaningful credit on the new spread? If not, the roll just costs you money.
- Is the trend still valid for the original strategy? Rolling a BPS in a downtrend is doubling a broken bet.
- Mechanically: roll at 21 DTE to avoid gamma, not before.

TAKE_PROFIT (closing for profit):
- Is this at or near the 50% target? Taking 40-50% is almost always correct.
- Is there a catalyst (earnings, Fed decision) making early exit smart? Good reason to deviate up.
- Are they leaving too much on the table? If at 20% profit with 35 DTE, hold.

CUT_LOSSES (closing at a loss):
- Is the thesis genuinely broken (trend reversed, breach imminent) or is this just uncomfortable?
- What's the actual loss vs max loss? If at 1x credit loss, cutting is reasonable. Beyond 2x, you should have cut already.
- Buffer: use DTE-aware judgment — < 2% at any DTE is critical; < 3% only concerning if DTE > 21; < 5% only worth noting if DTE > 30. Short-dated positions (< 14 DTE) with thin buffers are often fine — theta is working hard.

PLACE_GTC (placing a profit target order):
- Almost always a GO — this is standard practice and protects the position.
- Any profit target between 40-85% is valid and should NOT be flagged. The trader knows their target.
- Only CAUTION if: target is below 20% (fires almost immediately, not worth the order) or above 90% (basically never fires).
- Do NOT flag the buffer or any other position metric as a reason to CAUTION a PLACE_GTC. The GTC protects the position — placing it is always better than not placing it.
- Do NOT comment on whether 50% vs 65% vs 75% is the right target. That is the trader's decision.

OUTPUT FORMAT — JSON only, nothing else:
{
  "verdict": "GO|CAUTION|STOP",
  "confidence": "HIGH|MEDIUM|LOW",
  "headline": "Single blunt sentence. Max 15 words. Make it land.",
  "reasoning": "2-3 sentences. Be specific — use the actual numbers from the position. Tell them exactly why."
}`;

function isUpcomingEarningsRisk(earningsDate: string | null, expDate: string): boolean {
  if (!earningsDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const earnings = new Date(`${earningsDate}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);

  if (Number.isNaN(earnings.getTime()) || Number.isNaN(expiry.getTime())) return false;

  return earnings >= today && earnings <= expiry;
}
function buildVerdictPrompt(pos: Position, action: EvaluatedAction, detail?: string): string {
  const pnlPct = pos.pnl != null && pos.creditReceived > 0
    ? ((pos.pnl / pos.creditReceived) * 100).toFixed(1) : 'unknown';
  const creditPerContract = (pos.creditReceived / 100).toFixed(2);

  const actionDesc = action === 'EXTEND_PROFIT' && detail
    ? `EXTEND_PROFIT — moving profit target from current to ${detail}% (new BTC price: $${((pos.creditReceived / 100) * (1 - parseInt(detail) / 100)).toFixed(2)})`
    : action === 'CLOSE_ROLL'
    ? `CLOSE_ROLL — close current position and re-enter next expiry`
    : action === 'TAKE_PROFIT'
    ? `TAKE_PROFIT — close now for ${pnlPct}% of credit ($${pos.pnl?.toFixed(2) ?? '?'})`
    : action === 'CUT_LOSSES'
    ? `CUT_LOSSES — close at a loss of ${pnlPct}% (${pos.pnl?.toFixed(2) ?? '?'})`
    : `PLACE_GTC — set profit target GTC order`;

  // Pull relevant memory context for this symbol and action
  const memoryContext = buildMemoryContext(pos.symbol, action);

  return `Evaluate this specific action a trader is about to take:

ACTION: ${actionDesc}

POSITION: ${pos.symbol} ${pos.strategy}
DTE: ${pos.dte} | Entry DTE: ${pos.entryDte}
Strikes: ${pos.legs.map(l => `${l.direction} ${l.strikePrice}${l.optionType}`).join(', ')}
Credit (total): $${pos.creditReceived.toFixed(2)} | Per contract: $${creditPerContract}
Current buyback cost: $${pos.currentValue?.toFixed(2) ?? 'unknown'}
P&L: $${pos.pnl?.toFixed(2) ?? 'unknown'} (${pnlPct}% of credit)
Current profit target: ${Math.round(pos.profitTarget * 100)}%

Stock price: $${pos.stockPrice?.toFixed(2) ?? 'unknown'}
Buffer to short strike: ${pos.buffer?.toFixed(1) ?? 'unknown'}%
OTM buffer at entry / first tracked: ${pos.otmAtEntry != null ? `${pos.otmAtEntry.toFixed(1)}%` : 'unknown'}
DTE entry/now: ${pos.dteAtEntry ?? pos.entryDte ?? 'unknown'} → ${pos.dte}
IVR: ${pos.ivr ?? 'unknown'} | IV: ${pos.iv ?? 'unknown'}% | HV30: ${pos.hv30 ?? 'unknown'}%
Theta/d: ${pos.theta?.toFixed(4) ?? 'unknown'} | Gamma: ${pos.gamma?.toFixed(4) ?? 'unknown'}
GTC working: ${pos.hasGtc ? 'Yes' : 'No'}
Earnings: ${isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? `UPCOMING — ${pos.earningsDate}` : pos.earningsDate ? `PAST — ${pos.earningsDate} — ignore as current risk` : 'None before expiration'}

Flags: ${[
    pos.needsClose ? 'AT 21 DTE (standard entry — must close/roll)' : '',
    pos.entryDte <= 21 ? `SHORT-DATED ENTRY (entered at ${pos.entryDte} DTE, now ${pos.dte} DTE — fast profit capture goal, lower thresholds apply)` : '',
    pos.hitTarget ? 'TARGET HIT' : '',
    pos.buffer != null && pos.buffer < 2 ? `CRITICAL BUFFER ${pos.buffer.toFixed(1)}% at ${pos.dte} DTE` : pos.buffer != null && pos.buffer < 3 && pos.dte > 14 ? `TIGHT BUFFER ${pos.buffer.toFixed(1)}% at ${pos.dte} DTE` : pos.buffer != null && pos.buffer < 5 && pos.dte > 30 ? `WATCH BUFFER ${pos.buffer.toFixed(1)}% at ${pos.dte} DTE` : '',
    isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? `UPCOMING EARNINGS ${pos.earningsDate}` : '',
    (pos.pnl ?? 0) < -pos.creditReceived ? 'LOSS EXCEEDS 1X CREDIT' : '',
  ].filter(Boolean).join(', ') || 'None'}
${memoryContext ? `\n${memoryContext}` : ''}
Give your verdict as JSON only.`;
}

async function evaluateAction(pos: Position, action: EvaluatedAction, detail?: string): Promise<ActionVerdict> {
  const prompt = buildVerdictPrompt(pos, action, detail);
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'fast',
      max_tokens: 400,
      system: TRADING_VERDICT_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `API error: ${res.status}`);
  }
  const data = await res.json();
  const text = (data?.content?.find((b: any) => b.type === 'text')?.text ?? '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(text);
  return {
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    headline: parsed.headline,
    reasoning: parsed.reasoning,
  };
}

async function callAI(userMessage: string): Promise<string> {
  // Calls our own Next.js API route, which selects the configured AI model server-side.
  // Keep model names out of this client file; use profile instead.
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'analysis',
      max_tokens: 1600,
      system: TRADING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `API error: ${res.status}`);
  }
  const data = await res.json();
  const text = data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

interface ChatMessagePart { type: 'text'; text: string; }
interface ChatImagePart { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; }
type ChatContentPart = ChatMessagePart | ChatImagePart;
interface ChatMessage { role: 'user' | 'assistant'; content: string | ChatContentPart[]; }

async function callAIWithHistory(messages: ChatMessage[], systemOverride?: string): Promise<string> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'chat',
      max_tokens: 1400,
      system: systemOverride ?? TRADING_SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `API error: ${res.status}`);
  }
  const data = await res.json();
  const text = data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

function fmtMoney(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? 'unknown' : `$${value.toFixed(digits)}`;
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? 'unknown' : `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? 'unknown' : value.toFixed(digits);
}

function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

function fmtSignedNum(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}


function fmtEntryNowPct(entry: number | null | undefined, current: number | null | undefined, digits = 0): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${entry.toFixed(digits)}→${current.toFixed(digits)}%`;
}

function fmtEntryNowDelta(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${(entry * 100).toFixed(0)}→${(current * 100).toFixed(0)}%`;
}

function fmtEntryNowTheta(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${(entry * 100).toFixed(0)}→${(current * 100).toFixed(0)}/d`;
}

function fmtEntryNowDte(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${entry.toFixed(0)}→${current.toFixed(0)}d`;
}

function fmtPointChange(entry: number | null | undefined, current: number | null | undefined, digits = 0, suffix = ' pts'): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  const diff = current - entry;
  const sign = diff >= 0 ? '+' : '-';
  return `${sign}${Math.abs(diff).toFixed(digits)}${suffix}`;
}

function entryChangeColor(entry: number | null | undefined, current: number | null | undefined, goodWhenDown = true, fallback = 'text-slate-500'): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return fallback;
  const diff = current - entry;
  if (Math.abs(diff) < 0.01) return fallback;
  const good = goodWhenDown ? diff < 0 : diff > 0;
  return good ? 'text-emerald-400' : 'text-red-400';
}

function getShortLegs(pos: Position): PositionLeg[] {
  return pos.legs.filter(l => l.direction === 'Short');
}

function getLongLegs(pos: Position): PositionLeg[] {
  return pos.legs.filter(l => l.direction === 'Long');
}

function inferPositionStructure(pos: Position): string {
  const shorts = getShortLegs(pos);
  const longs = getLongLegs(pos);
  const shortPut = shorts.find(l => l.optionType === 'P');
  const shortCall = shorts.find(l => l.optionType === 'C');
  const longPut = longs.find(l => l.optionType === 'P');
  const longCall = longs.find(l => l.optionType === 'C');

  if (pos.strategy === 'PUT' || (shortPut && !shortCall && longs.length === 0)) return 'Cash-secured put / short put';
  if (pos.strategy === 'CALL' || (shortCall && !shortPut && longs.length === 0)) return 'Short call / covered-call candidate only if long shares exist elsewhere';
  if (pos.strategy === 'BPS' || (shortPut && longPut && !shortCall && !longCall)) return 'Bull put spread';
  if (pos.strategy === 'BCS' || (shortCall && longCall && !shortPut && !longPut)) return 'Bear call spread';
  if (pos.strategy === 'IC' || (shortPut && longPut && shortCall && longCall)) return 'Iron condor';
  return `${pos.strategy || 'Unknown'} options position`;
}

function buildLegSnapshot(pos: Position): string {
  return pos.legs.map(l => {
    const side = l.direction === 'Short' ? 'SHORT' : 'LONG';
    const opt = l.optionType === 'P' ? 'PUT' : 'CALL';
    const mark = l.currentPrice != null ? ` | current mark ${fmtMoney(l.currentPrice)}` : '';
    return `- ${side} ${Math.abs(l.quantity)}x ${l.strikePrice} ${opt} | avg open ${fmtMoney(l.avgOpenPrice)}${mark} | OCC ${l.symbol}`;
  }).join('\n');
}

function buildPositionChatContext(pos: Position, analysis: PositionAnalysis): string {
  const shortLegs = getShortLegs(pos);
  const primaryShort = shortLegs[0] ?? null;
  const pnlCapture = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : null;
  const creditPerContract = primaryShort && Math.abs(primaryShort.quantity) > 0
    ? pos.creditReceived / (Math.abs(primaryShort.quantity) * 100)
    : pos.creditReceived / 100;
  const currentPerContract = primaryShort && Math.abs(primaryShort.quantity) > 0 && pos.currentValue != null
    ? pos.currentValue / (Math.abs(primaryShort.quantity) * 100)
    : null;
  const remainingToTarget = pos.targetPrice != null && pos.currentValue != null
    ? pos.currentValue - pos.targetPrice
    : null;
  const ivEdge = pos.iv != null && pos.hv30 != null ? pos.iv - pos.hv30 : null;
  const thetaGammaRatio = pos.theta != null && pos.gamma != null && Math.abs(pos.gamma) > 0
    ? Math.abs(pos.theta / pos.gamma)
    : null;

  return [
    'POSITION SNAPSHOT — USE THIS DATA FOR EVERY FOLLOW-UP ANSWER',
    `Position type: ${inferPositionStructure(pos)}`,
    `Platform strategy label: ${pos.strategy}`,
    `Symbol: ${pos.symbol}`,
    `Expiration: ${pos.expDate}`,
    `DTE: ${pos.dte}`,
    `Entry date: ${pos.entryDate ?? 'unknown'}`,
    `Entry DTE: ${pos.entryDte}`,
    '',
    'LEGS',
    buildLegSnapshot(pos),
    '',
    'PRICE / STRIKE / BUFFER',
    `Underlying price: ${fmtMoney(pos.stockPrice)}`,
    `Primary short strike: ${primaryShort ? `${primaryShort.strikePrice} ${primaryShort.optionType === 'P' ? 'PUT' : 'CALL'}` : 'unknown'}`,
    `OTM buffer to short strike: ${fmtPct(pos.buffer)}`,
    '',
    'P&L / PREMIUM',
    `Total entry credit: ${fmtMoney(pos.creditReceived)}`,
    `Entry credit per short contract: ${fmtMoney(creditPerContract)}`,
    `Current buyback / mark value: ${fmtMoney(pos.currentValue)}`,
    `Current mark per short contract: ${fmtMoney(currentPerContract)}`,
    `Open P&L: ${fmtSignedMoney(pos.pnl)}`,
    `Profit captured: ${fmtPct(pnlCapture)}`,
    `Profit target: ${Math.round(pos.profitTarget * 100)}% | target buyback ${fmtMoney(pos.targetPrice)}`,
    `Premium still above target buyback: ${fmtMoney(remainingToTarget)}`,
    `Max risk: ${fmtMoney(pos.maxRisk)}`,
    '',
    'GREEKS / VOLATILITY',
    `Delta: ${fmtSignedNum(pos.netDelta, 3)}`,
    `Theta/d: ${fmtSignedNum(pos.theta, 3)}`,
    `Gamma: ${fmtSignedNum(pos.gamma, 4)}`,
    `Theta/Gamma ratio: ${fmtNum(thetaGammaRatio, 1)}`,
    `Vega: ${fmtSignedNum(pos.netVega, 3)}`,
    `IVR: ${pos.ivr ?? 'unknown'}`,
    `Current IV: ${fmtPct(pos.iv, 0)}`,
    `IV at entry / first tracked: ${fmtPct(pos.ivAtEntry, 0)}`,
    `IV change: ${fmtPointChange(pos.ivAtEntry, pos.iv, 0)}`,
    `Delta entry → now: ${fmtEntryNowDelta(pos.deltaAtEntry, pos.netDelta)}`,
    `Theta entry → now: ${fmtEntryNowTheta(pos.thetaAtEntry, pos.theta)}`,
    `OTM entry → now: ${fmtEntryNowPct(pos.otmAtEntry, pos.buffer, 1)}`,
    `DTE entry → now: ${fmtEntryNowDte(pos.dteAtEntry ?? pos.entryDte, pos.dte)}`,
    `HV30: ${fmtPct(pos.hv30, 0)}`,
    `IV edge (IV - HV30): ${fmtPct(ivEdge)}`,
    `Beta: ${fmtNum(pos.beta, 2)}`,
    '',
    'ORDERS / RISK CONTROLS',
    `GTC profit order: ${pos.hasGtc ? `Yes${pos.gtcOrderPrice != null ? ` at ${fmtMoney(pos.gtcOrderPrice)}` : ''}` : 'No'}`,
    `Stop loss status: ${pos.stopLossStatus}${pos.stopLossPrice != null ? ` at ${fmtMoney(pos.stopLossPrice)}` : ''}`,
    `Earnings within expiry: ${isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? pos.earningsDate : 'No / unknown'}`,
    '',
    'ORIGINAL AI ANALYSIS',
    `Recommendation: ${analysis.recommendation}`,
    `Confidence: ${analysis.confidence}`,
    `Summary: ${analysis.summary}`,
    `Reasoning: ${analysis.reasoning}`,
    analysis.risks.length ? `Risks: ${analysis.risks.join(' | ')}` : 'Risks: none listed',
    analysis.catalysts.length ? `In favor: ${analysis.catalysts.join(' | ')}` : 'In favor: none listed',
    analysis.deviatesFromRules && analysis.deviationNote ? `Rule deviation note: ${analysis.deviationNote}` : '',
    '',
    'FOLLOW-UP RESPONSE RULES',
    '- Do not answer with generic options theory.',
    '- Always use the actual numbers above when they are relevant.',
    '- If asked why P&L is positive or negative, compare entry credit, current buyback, profit captured, DTE, IV/HV/IVR, theta, gamma, vega, and buffer.',
    '- If the app is missing the exact data needed, say what field is missing and recommend the exact metric to add.',
    '- For IV-related explanations, compare IV at entry / first tracked to current IV when available. If entry IV is still missing, say so before claiming IV expansion or contraction.',
    '- For “how do I watch this better” questions, recommend specific app fields, alerts, and thresholds based on this position.',
    '- Keep the answer direct and practical, like a senior trader coaching this exact position.'
  ].filter(Boolean).join('\n');
}

async function analyzePosition(pos: Position, trend: TrendResult | null): Promise<PositionAnalysis> {
  const prompt = buildPositionPrompt(pos, trend);
  const raw = await callAI(prompt);
  const parsed = JSON.parse(raw);
  return {
    positionKey: pos.key,
    symbol: pos.symbol,
    loading: false,
    error: null,
    recommendation: parsed.recommendation,
    confidence: parsed.confidence,
    summary: parsed.summary,
    reasoning: parsed.reasoning,
    risks: parsed.risks ?? [],
    catalysts: parsed.catalysts ?? [],
    deviatesFromRules: parsed.deviatesFromRules ?? false,
    deviationNote: parsed.deviationNote ?? null,
    generatedAt: new Date().toISOString(),
  };
}

async function analyzePortfolio(positions: Position[]): Promise<PortfolioAnalysis> {
  const prompt = buildPortfolioPrompt(positions);
  const raw = await callAI(prompt);
  const parsed = JSON.parse(raw);
  return {
    loading: false,
    error: null,
    netDelta: null,
    dominantRisk: parsed.dominantRisk ?? '',
    sectorConcentration: parsed.sectorConcentration ?? [],
    thetaYield: parsed.thetaYield ?? '',
    topRisks: parsed.topRisks ?? [],
    priorityActions: parsed.priorityActions ?? [],
    marketContext: parsed.marketContext ?? '',
    summary: parsed.summary ?? '',
    generatedAt: new Date().toISOString(),
  };
}

// Map index symbols to their chart-compatible equivalents
const INDEX_CHART_SYMBOLS: Record<string, string> = {
  'SPX': '^GSPC',
  'SPXW': '^GSPC',
  'NDX': '^NDX',
  'RUT': '^RUT',
  'VIX': '^VIX',
  'DJX': '^DJI',
};

function avgNumbers(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pctDistance(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function nearestBelowOrEqual(values: number[], target: number): number | null {
  const candidates = values.filter(v => Number.isFinite(v) && v <= target);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function detectSwingLows(lows: number[], window = 2): number[] {
  const swings: number[] = [];
  for (let i = window; i < lows.length - window; i++) {
    const current = lows[i];
    const left = lows.slice(i - window, i);
    const right = lows.slice(i + 1, i + 1 + window);
    if (left.every(v => current <= v) && right.every(v => current <= v)) swings.push(current);
  }
  return swings;
}


function buildPriceSupportAnalysis(
  bars: { c: number; h?: number; l?: number }[],
  shortStrike: number | null
): PriceSupportAnalysis {
  const validBars = bars
    .map(b => ({
      c: Number(b.c),
      h: Number.isFinite(Number(b.h)) ? Number(b.h) : Number(b.c),
      l: Number.isFinite(Number(b.l)) ? Number(b.l) : Number(b.c),
    }))
    .filter(b => Number.isFinite(b.c) && Number.isFinite(b.h) && Number.isFinite(b.l));

  if (validBars.length < 20) {
    return {
      verdict: 'UNKNOWN',
      score: 0,
      lookbackDays: validBars.length,
      price: validBars.length > 0 ? validBars[validBars.length - 1].c : null,
      shortStrike,
      nearestSupport: null,
      supportZoneLow: null,
      supportZoneHigh: null,
      low20: null,
      low50: null,
      swingLow: null,
      ma20: null,
      ma50: null,
      strikeVsSupportPct: null,
      priceVsMa20Pct: null,
      priceVsMa50Pct: null,
      reason: 'Not enough price history to evaluate support.',
    };
  }

  const closes = validBars.map(b => b.c);
  const lows = validBars.map(b => b.l);
  const price = closes[closes.length - 1];

  const low20 = Math.min(...lows.slice(-20));
  const low50 = validBars.length >= 50 ? Math.min(...lows.slice(-50)) : null;
  const ma20 = avgNumbers(closes.slice(-20));
  const ma50 = validBars.length >= 50 ? avgNumbers(closes.slice(-50)) : null;

  const recentSwingLows = detectSwingLows(lows.slice(-60), 2).slice(-5);
  const nearestSwingBelow = nearestBelowOrEqual(recentSwingLows, price);
  const supportCandidates = [low20, low50, nearestSwingBelow, ma20, ma50]
    .filter((v): v is number => v != null && Number.isFinite(v) && v <= price * 1.02);

  const nearestSupport = supportCandidates.length > 0
    ? supportCandidates.reduce((best, v) => Math.abs(price - v) < Math.abs(price - best) ? v : best, supportCandidates[0])
    : null;

  const supportZoneLow = supportCandidates.length > 0 ? Math.min(...supportCandidates) : null;
  const supportZoneHigh = supportCandidates.length > 0 ? Math.max(...supportCandidates) : null;

  const strikeVsSupportPct = shortStrike != null && nearestSupport != null
    ? pctDistance(shortStrike, nearestSupport)
    : null;
  const priceVsMa20Pct = pctDistance(price, ma20);
  const priceVsMa50Pct = ma50 != null ? pctDistance(price, ma50) : null;

  let score = 50;
  const reasons: string[] = [];

  if (price > ma20) { score += 10; reasons.push('price is above MA20'); }
  else { score -= 15; reasons.push('price is below MA20'); }

  if (ma50 != null) {
    if (price > ma50) { score += 10; reasons.push('price is above MA50'); }
    else { score -= 15; reasons.push('price is below MA50'); }

    if (ma20 > ma50) { score += 10; reasons.push('MA20 is above MA50'); }
    else { score -= 10; reasons.push('MA20 is below MA50'); }
  }

  if (shortStrike != null && nearestSupport != null) {
    if (shortStrike <= nearestSupport * 0.99) {
      score += 20;
      reasons.push('short strike is below nearest support');
    } else if (shortStrike <= nearestSupport * 1.01) {
      score += 5;
      reasons.push('short strike is near support');
    } else {
      score -= 25;
      reasons.push('short strike is above nearest support');
    }
  } else if (shortStrike == null) {
    reasons.push('no short put strike supplied for support comparison');
  }

  if (low50 != null && price > low50) {
    score += 5;
    reasons.push('price remains above the 50-day low');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const verdict: PriceSupportAnalysis['verdict'] =
    shortStrike == null || nearestSupport == null ? 'UNKNOWN' :
    score >= 75 ? 'GOOD' :
    score >= 50 ? 'CAUTION' :
    'BAD';

  return {
    verdict,
    score,
    lookbackDays: validBars.length,
    price,
    shortStrike,
    nearestSupport,
    supportZoneLow,
    supportZoneHigh,
    low20,
    low50,
    swingLow: nearestSwingBelow,
    ma20,
    ma50,
    strikeVsSupportPct,
    priceVsMa20Pct,
    priceVsMa50Pct,
    reason: reasons.join('; '),
  };
}

async function getTrend(symbol: string, shortPutStrike: number | null = null): Promise<TrendResult> {
  const chartSymbol = INDEX_CHART_SYMBOLS[symbol.toUpperCase()] ?? symbol;
  const res = await fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' });
  if (!res.ok) {
    return {
      trend: 'unknown',
      strategy: 'NO_TRADE',
      confidence: 0,
      reason: 'Chart data unavailable',
      supportAnalysis: {
        verdict: 'UNKNOWN',
        score: 0,
        lookbackDays: 0,
        price: null,
        shortStrike: shortPutStrike,
        nearestSupport: null,
        supportZoneLow: null,
        supportZoneHigh: null,
        low20: null,
        low50: null,
        swingLow: null,
        ma20: null,
        ma50: null,
        strikeVsSupportPct: null,
        priceVsMa20Pct: null,
        priceVsMa50Pct: null,
        reason: 'Chart data unavailable.',
      },
    };
  }

  const data = await res.json();
  const bars: { c: number; h?: number; l?: number }[] = data?.bars ?? [];
  const closes = bars.map((b: any) => Number(b.c)).filter((c: any): c is number => Number.isFinite(c));
  const supportAnalysis = buildPriceSupportAnalysis(bars, shortPutStrike);

  if (closes.length < 50) {
    return { trend: 'unknown', strategy: 'NO_TRADE', confidence: 0, reason: 'Not enough data', supportAnalysis };
  }

  const price = closes[closes.length - 1];
  const ma20 = avgNumbers(closes.slice(-20));
  const ma50 = avgNumbers(closes.slice(-50));
  const mom20 = (price - closes[closes.length - 21]) / closes[closes.length - 21];
  const low20 = Math.min(...closes.slice(-20));
  const high20 = Math.max(...closes.slice(-20));
  const higherLows = low20 > Math.min(...closes.slice(-40, -20)) * 0.985;
  const lowerHighs = high20 < Math.max(...closes.slice(-40, -20)) * 1.015;

  let score = 0;
  if (price > ma20) score += 2; else score -= 2;
  if (price > ma50) score += 2; else score -= 2;
  if (ma20 > ma50) score += 2; else score -= 2;
  if (mom20 > 0.03) score += 2; else if (mom20 < -0.03) score -= 2;
  if (higherLows) score += 2; else if (lowerHighs) score -= 2;

  const confidence = Math.min(100, Math.abs(score) * 10);
  const supportSuffix = supportAnalysis.verdict !== 'UNKNOWN'
    ? ` | Support ${supportAnalysis.verdict}: ${supportAnalysis.reason}`
    : '';

  if (score >= 4) return { trend: 'uptrend', strategy: 'BPS', confidence, reason: `Price above MA20/MA50, positive momentum${supportSuffix}`, supportAnalysis };
  if (score <= -4) return { trend: 'downtrend', strategy: 'BCS', confidence, reason: `Price below MA20/MA50, negative momentum${supportSuffix}`, supportAnalysis };
  return { trend: 'sideways', strategy: 'IC', confidence, reason: `Mixed signals, range-bound${supportSuffix}`, supportAnalysis };
}
// ── Helpers ────────────────────────────────────────────────────────────────
function stratColor(strategy: string) {
  if (strategy === 'BPS') return 'text-emerald-400 border-emerald-700';
  if (strategy === 'BCS') return 'text-red-400 border-red-700';
  if (strategy === 'IC')  return 'text-blue-400 ac-border-faint';
  return 'text-slate-400 border-slate-700';
}
function pnlColor(pnl: number | null) { return pnl == null ? 'text-slate-400' : pnl >= 0 ? 'text-emerald-400' : 'text-red-400'; }
function dteColor(dte: number) { if (dte <= 7) return 'text-red-500 font-bold'; if (dte <= 21) return 'text-yellow-400 font-bold'; return 'text-slate-400'; }

const ACTION_META: Record<ActionType, { label: string; color: string; btnClass: string }> = {
  HOLD:        { label: '● Hold',         color: 'text-slate-400',   btnClass: 'border-slate-600 text-slate-400' },
  WATCH:       { label: '⚠ Watch',        color: 'text-yellow-400',  btnClass: 'border-yellow-700 text-yellow-400' },
  MANAGE:      { label: '⚡ Manage',       color: 'text-orange-400',  btnClass: 'border-orange-600 text-orange-400' },
  TAKE_PROFIT: { label: '✓ Take Profit',  color: 'text-emerald-400', btnClass: 'border-emerald-600 text-emerald-400 hover:bg-emerald-600/20' },
  CUT_LOSSES:  { label: '✕ Cut Losses',   color: 'text-red-400',     btnClass: 'border-red-600 text-red-400 hover:bg-red-600/20' },
  CLOSE_ROLL:  { label: '↻ Close/Roll',   color: 'text-purple-400',  btnClass: 'border-purple-600 text-purple-400 hover:bg-purple-600/20' },
  PLACE_GTC:   { label: '⏱ Place GTC',   color: 'text-blue-400',    btnClass: 'ac-btn hover:ac-bg-20' },
};

function ThemeToggle({ theme, setTheme, accent, setAccent }: {
  theme: Theme; setTheme: (t: Theme) => void;
  accent: Accent; setAccent: (a: Accent) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {(Object.entries(ACCENTS) as [Accent, typeof ACCENTS[Accent]][]).map(([key, val]) => (
          <button key={key} onClick={() => { setAccent(key); applyAccent(key); try { localStorage.setItem(LS_ACCENT, key); } catch {} }}
            title={val.label}
            className={`w-3.5 h-3.5 rounded-full transition-all ${accent === key ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-black scale-125' : 'opacity-60 hover:opacity-100'}`}
            style={{ backgroundColor: val.hex }}
          />
        ))}
      </div>
      <div className="w-px h-4 bg-white/20" />
      <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1">
        {(['light', 'medium', 'dark'] as Theme[]).map((v, i) => (
          <button key={v} onClick={() => { setTheme(v); try { localStorage.setItem(LS_THEME, v); } catch {} }}
            className={`text-sm px-2 py-1 rounded transition-all ${theme === v ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}`}>
            {['☀', '◐', '☾'][i]}
          </button>
        ))}
      </div>
    </div>
  );
}

type BatchStatus = 'enriching' | 'ready' | 'submitting' | 'done' | 'error';

// ── Batch Confirm Modal ─────────────────────────────────────────────────────
function BatchConfirmModal({
  items: initialItems,
  onClose,
  onSuccess,
  dryRun,
  th,
}: {
  items: { pos: Position; action: ActionType }[];
  onClose: () => void;
  onSuccess: () => void;
  dryRun: boolean;
  th: typeof THEMES[Theme];
}) {
  const [status, setStatus] = useState<BatchStatus>('enriching');
  const [batchItems, setBatchItems] = useState<BatchOrderItem[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [orderResults, setOrderResults] = useState<OrderResult[]>([]);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // Roll state per position
  const [rollInputs, setRollInputs] = useState<Record<string, { expiry: string; shortStrike: string; longStrike: string; credit: string }>>({});
  const [rollMode, setRollMode] = useState<Record<string, string>>({});
  const [rollSuggestions, setRollSuggestions] = useState<Record<string, RollSuggestion | null>>({});
  const [rollCandidatePicks, setRollCandidatePicks] = useState<Record<string, CategorizedRollPick[]>>({});
  const [rollSearchLoading, setRollSearchLoading] = useState<Record<string, boolean>>({});
  const [verdicts, setVerdicts] = useState<Record<string, ActionVerdict>>({});
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [limitOverrides, setLimitOverrides] = useState<Record<string, string>>({});

  // GTC override confirmation
  const [gtcConfirmed, setGtcConfirmed] = useState<Set<string>>(new Set());

  const marketStatus = getMarketStatus();

  // Enrich logic
  useEffect(() => {
    let cancelled = false;
    async function enrich() {
      setStatus('enriching');
      try {
        let token: string;
        try {
          token = await getAccessToken();
        } catch (authErr: any) {
          if (!cancelled) { setErrorMsg(`Authentication error: ${authErr.message}. Try refreshing the page.`); setStatus('error'); }
          return;
        }
        const enriched: BatchOrderItem[] = [];

        for (const { pos, action } of initialItems) {
          const freshPrice = await fetchFreshPositionPrice(pos, token);
          const qty = pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1;
          const freshPerContract = freshPrice != null ? freshPrice / (qty * 100) : null;
          const creditPerContract = pos.creditReceived / (qty * 100);

          const stalePriceWarning = freshPrice != null && pos.currentValue != null
            ? Math.abs(freshPrice - pos.currentValue) / pos.currentValue > STALE_PRICE_THRESHOLD
            : false;

          const duplicateGtcWarning = pos.hasGtc && (action === 'TAKE_PROFIT' || action === 'CUT_LOSSES' || action === 'CLOSE_ROLL');

          let limitPrice: number;
          let priceError: string | null = null;

          const effectiveValue = freshPrice ?? pos.currentValue;
          const effectivePerContract = freshPerContract ?? (pos.currentValue != null ? pos.currentValue / (qty * 100) : null);

          if (action === 'TAKE_PROFIT' || action === 'PLACE_GTC') {
            const effectiveProfitTarget = action === 'PLACE_GTC'
              ? getSmartGtcDefault(pos.symbol)
              : pos.profitTarget;
            const targetPrice = parseFloat((creditPerContract * (1 - effectiveProfitTarget)).toFixed(2));
            if (effectivePerContract != null && targetPrice >= effectivePerContract) {
              limitPrice = parseFloat(Math.max(effectivePerContract - 0.01, 0.01).toFixed(2));
            } else {
              limitPrice = Math.max(targetPrice, 0.01);
            }
            // Hard floor — negative or zero prices are always rejected by TastyTrade
            limitPrice = Math.max(parseFloat(limitPrice.toFixed(2)), 0.01);
          } else if (action === 'CUT_LOSSES' || action === 'CLOSE_ROLL') {
            // Balanced (mid->natural) optimizer; final per-leg refinement runs
            // at submit time in submitAll where fresh quotes are available.
            const optimized = await fetchCloseLimit(pos, token, 0.5).catch(() => null);
            if (optimized != null && optimized > 0) {
              limitPrice = parseFloat(Math.max(optimized, 0.01).toFixed(2));
            } else if (effectivePerContract != null) {
              limitPrice = parseFloat(Math.max(effectivePerContract, 0.01).toFixed(2));
            } else {
              limitPrice = parseFloat((creditPerContract * 0.5).toFixed(2));
              priceError = `No live price available — using estimated limit $${limitPrice.toFixed(2)}. Verify before submitting.`;
            }
          } else {
            const targetPrice = parseFloat((creditPerContract * (1 - pos.profitTarget)).toFixed(2));
            limitPrice = effectivePerContract != null
              ? Math.min(targetPrice, parseFloat((effectivePerContract - 0.01).toFixed(2)))
              : targetPrice;
          }

          if (action === 'PLACE_GTC' && effectivePerContract != null && limitPrice >= effectivePerContract) {
            priceError = `GTC limit $${limitPrice.toFixed(2)} ≥ live spread $${effectivePerContract.toFixed(2)} — would execute immediately. Use Take Profit instead.`;
          }

          // All closing actions rest as GTC so a target/stop/roll-trigger close
          // persists across sessions instead of expiring at end of day. Only a
          // deliberate intraday close would want Day, which we don't issue here.
          const tif: 'GTC' | 'Day' = 'GTC';
          const orderBody = buildCloseOrder(pos, limitPrice, tif);
          const estPnl = effectiveValue != null ? pos.creditReceived - effectiveValue : pos.pnl;

          const closeQuote = await fetchCloseQuote(pos, token).catch(() => null);
          const item: BatchOrderItem = {
            pos, action, orderBody, limitPrice, estPnl,
            stalePriceWarning, freshPrice, freshPerContract, duplicateGtcWarning, priceError,
            closeQuote,
          };

          if (action === 'CLOSE_ROLL') {
            if (!cancelled) setRollSearchLoading(prev => ({ ...prev, [pos.key]: true }));
            const candidates = await findRollCandidates(pos, token).catch(() => []);
            const picks = categorizeRollCandidates(candidates, pos.strategy);
            if (!cancelled) {
              setRollCandidatePicks(prev => ({ ...prev, [pos.key]: picks }));
              setRollSearchLoading(prev => ({ ...prev, [pos.key]: false }));
            }
            const defaultPick = picks[0]?.candidate ?? null;
            if (!cancelled) setRollSuggestions(prev => ({ ...prev, [pos.key]: defaultPick }));
            if (defaultPick && !rollInputs[pos.key]) {
              setRollInputs(prev => ({
                ...prev,
                [pos.key]: {
                  expiry: defaultPick.expiry,
                  shortStrike: String(defaultPick.shortStrike),
                  longStrike: String(defaultPick.longStrike),
                  credit: String(defaultPick.credit),
                },
              }));
            }
          }

          enriched.push(item);
          if (!cancelled) setBatchItems([...enriched]);

          const evalAction = action === 'CLOSE_ROLL' ? 'CLOSE_ROLL'
            : action === 'TAKE_PROFIT' ? 'TAKE_PROFIT'
            : action === 'CUT_LOSSES' ? 'CUT_LOSSES'
            : action === 'PLACE_GTC' ? 'PLACE_GTC'
            : null;
          if (evalAction) {
            evaluateAction(pos, evalAction as EvaluatedAction).then(v => {
              if (!cancelled) setVerdicts(prev => ({ ...prev, [pos.key]: v }));
            }).catch(() => {});
          }
        }

        if (!cancelled) setStatus('ready');
      } catch (e: any) {
        if (!cancelled) { setErrorMsg(e.message); setStatus('error'); }
      }
    }
    enrich();
    return () => { cancelled = true; };
  }, [initialItems]);

  const activeItems = batchItems
    .filter(i => !excluded.has(i.pos.key))
    .map(i => {
      const ovr = limitOverrides[i.pos.key];
      if (ovr !== undefined && ovr !== '') {
        const parsed = parseFloat(ovr);
        if (!isNaN(parsed) && parsed > 0) {
          const updatedBody = buildCloseOrder(i.pos, parsed, i.orderBody['time-in-force'] as 'GTC' | 'Day');
          return { ...i, limitPrice: parsed, orderBody: updatedBody };
        }
      }
      return i;
    });

  const totalDebit = activeItems.reduce((s, i) => s + i.limitPrice, 0);
  const totalEstPnl = activeItems.reduce((s, i) => s + (i.estPnl ?? 0), 0);
  const warningCount = activeItems.filter(i => i.stalePriceWarning || i.duplicateGtcWarning).length;
  const priceErrorCount = activeItems.filter(i => i.priceError != null).length;

  const needsGtcConfirmation = activeItems.filter(item =>
    item.pos.hasGtc && (item.action === 'TAKE_PROFIT' || item.action === 'CUT_LOSSES' || item.action === 'CLOSE_ROLL')
  );
  const allGtcConfirmed = needsGtcConfirmation.every(item => gtcConfirmed.has(item.pos.key));

  const submitAll = async () => {
    if (needsGtcConfirmation.length > 0 && !allGtcConfirmed) {
      setErrorMsg('You must confirm replacing the existing GTC orders before submitting.');
      return;
    }

    setStatus('submitting');
    setSubmitProgress(0);
    const results: OrderResult[] = [];
    try {
      const token = dryRun ? 'DRY-RUN' : await getAccessToken();
      let completed = 0;

      for (const item of activeItems) {
        try {
          let orderId: string;

          // AUTO CANCEL EXISTING GTC IF USER CONFIRMED
          if (!dryRun && item.pos.hasGtc && gtcConfirmed.has(item.pos.key) && item.pos.gtcOrderId) {
            try {
              const gtcComplexId = (item.pos as any).gtcComplexOrderId as string | undefined;
              console.log(`CANCEL DEBUG: symbol=${item.pos.symbol} orderId=${item.pos.gtcOrderId} complexId=${gtcComplexId}`);
              const cancelResult = await cancelOrder(item.pos.accountNumber, item.pos.gtcOrderId, token, gtcComplexId);
              console.log(`CANCEL SUCCESS: ${item.pos.symbol}`, cancelResult);
              await new Promise(r => setTimeout(r, 800));
            } catch (cancelErr: any) {
              console.error(`CANCEL FAILED: ${item.pos.symbol} orderId=${item.pos.gtcOrderId} error=`, cancelErr?.message);
              // TastyTrade may reject cancel if order is in terminal/partial state.
              // Proceed with placing the new order — TT will reject it if the old one
              // is still truly active, but the user will see a clear error message.
            }
          }

          if (!dryRun) {
            try {
              const liveTotal = await fetchFreshPositionPrice(item.pos, token);
              const qty = item.pos.legs.find((l: PositionLeg) => l.direction === 'Short')?.quantity ?? 1;
              const livePerContract = liveTotal != null ? liveTotal / (qty * 100) : null;
              const creditPerContract = item.pos.creditReceived / (qty * 100);

              if (livePerContract != null) {
                if (item.action === 'PLACE_GTC' && item.limitPrice >= livePerContract) {
                  throw new Error(`GTC limit $${item.limitPrice.toFixed(2)} ≥ live spread $${livePerContract.toFixed(2)}`);
                }
                if (item.action === 'TAKE_PROFIT' || item.action === 'CUT_LOSSES' || item.action === 'CLOSE_ROLL') {
                  const pctFromLive = Math.abs(item.limitPrice - livePerContract) / livePerContract;
                  if (pctFromLive > 0.30) {
                    let freshLimit: number;
                    if (item.action === 'TAKE_PROFIT') {
                      freshLimit = Math.max(parseFloat(Math.min(creditPerContract * (1 - item.pos.profitTarget), livePerContract - 0.01).toFixed(2)), 0.01);
                    } else {
                      // CUT_LOSSES / CLOSE_ROLL: price to the marketable side
                      // (balanced mid->natural) so the close fills. Fall back to
                      // livePerContract if the per-leg optimizer can't quote.
                      const optimized = await fetchCloseLimit(item.pos, token, 0.5).catch(() => null);
                      freshLimit = (optimized != null && optimized > 0)
                        ? parseFloat(Math.max(optimized, 0.01).toFixed(2))
                        : parseFloat(Math.max(livePerContract, 0.01).toFixed(2));
                    }
                    item.orderBody = buildCloseOrder(item.pos, freshLimit, item.orderBody['time-in-force'] as 'GTC' | 'Day');
                    (item as any).limitPrice = freshLimit;
                  }
                }
              }
            } catch (priceCheckErr: any) {
              if (String(priceCheckErr.message).includes('already hit') || String(priceCheckErr.message).includes('≥ live')) {
                throw priceCheckErr;
              }
              console.warn(`Pre-submit price check failed for ${item.pos.symbol}:`, priceCheckErr.message);
            }
          }

          if (dryRun) {
            const token2 = await getAccessToken();
            const validation = await ttValidateOrder(`/accounts/${item.pos.accountNumber}/orders`, token2, item.orderBody);
            if (!validation.valid) {
              throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
            }
            orderId = `DRY-${Date.now().toString(36).toUpperCase()}`;
          } else if (item.action === 'CLOSE_ROLL' && rollMode[item.pos.key] === 'roll') {
            // Roll mode: do NOT submit the close standalone. It is carried as the
            // trigger of the OTOCO built below, so the position can never end up
            // half-rolled (closed but not re-opened). orderId is assigned there.
            orderId = '';
          } else {
            const res = await ttPost(`/accounts/${item.pos.accountNumber}/orders`, token, item.orderBody);
            orderId = String(res?.data?.order?.id ?? res?.data?.id ?? 'submitted');
          }

          if (item.action === 'CLOSE_ROLL' && rollMode[item.pos.key] === 'roll') {
            const ri = rollInputs[item.pos.key];
            if (ri?.expiry && ri.shortStrike && ri.longStrike && ri.credit) {
              const _ed = new Date(ri.expiry); const _td = new Date(); _td.setHours(0,0,0,0);
              if (isNaN(_ed.getTime())) throw new Error('Roll expiry is not a valid date.');
              if (_ed <= _td) throw new Error('Roll expiry is in the past. Enter a future date.');
              const optType: 'P' | 'C' = item.pos.strategy === 'BCS' ? 'C' : 'P';
              const suggestion = rollSuggestions[item.pos.key];
              const qty = item.pos.legs[0]?.quantity ?? 1;

              const inputCredit = parseFloat(ri.credit);
              const inputWidth  = Math.abs(parseFloat(ri.shortStrike) - parseFloat(ri.longStrike));
              if (inputWidth > 0 && inputCredit < inputWidth / 3) {
                throw new Error(`Roll credit $${inputCredit.toFixed(2)} is less than 1/3 of spread width $${inputWidth} ($${(inputWidth/3).toFixed(2)} min). This roll doesn't meet the credit rule.`);
              }

              let finalCredit = inputCredit;
              if (!dryRun && suggestion) {
                try {
                  const liveChain = await ttFetch(`/option-chains/${encodeURIComponent(item.pos.symbol)}/nested?expiration-date=${ri.expiry}`, token);
                  const liveStrikes: any[] = liveChain?.data?.items?.[0]?.strikes ?? [];
                  let shortLive: any = null;
                  let longLive: any = null;
                  for (const s of liveStrikes) {
                    if (s['strike-price'] === parseFloat(ri.shortStrike)) shortLive = s[optType === 'P' ? 'put' : 'call'];
                    if (s['strike-price'] === parseFloat(ri.longStrike)) longLive = s[optType === 'P' ? 'put' : 'call'];
                  }
                  if (shortLive && longLive) {
                    const shortMid = (parseFloat(shortLive.bid ?? '0') + parseFloat(shortLive.ask ?? '0')) / 2;
                    const longMid = (parseFloat(longLive.bid ?? '0') + parseFloat(longLive.ask ?? '0')) / 2;
                    const liveCreditMid = shortMid - longMid;
                    const liveCredit85 = parseFloat((liveCreditMid * 0.85).toFixed(2));
                    if (liveCreditMid > 0 && Math.abs(liveCreditMid - inputCredit) / inputCredit > 0.20) {
                      finalCredit = liveCredit85;
                    }
                    if (inputWidth > 0 && liveCreditMid < inputWidth / 3) {
                      throw new Error(`Roll credit dropped to $${liveCreditMid.toFixed(2)} — no longer meets 1/3 rule.`);
                    }
                  }
                } catch (creditCheckErr: any) {
                  if (String(creditCheckErr.message).includes('1/3 rule') || String(creditCheckErr.message).includes('credit rule')) {
                    throw creditCheckErr;
                  }
                  console.warn(`Roll credit re-fetch failed for ${item.pos.symbol}:`, creditCheckErr.message);
                }
              }

              const openBody = buildOpenSpreadOrder(
                item.pos.symbol, ri.expiry, optType,
                parseFloat(ri.shortStrike), parseFloat(ri.longStrike),
                qty, finalCredit,
                suggestion?.shortSymbol, suggestion?.longSymbol
              );

              // Atomic roll via OTOCO: the close is the trigger; once it fills,
              // the open is released as the contingent order. If the OTOCO is
              // rejected up front, NOTHING is placed and the position is
              // untouched. If the close fills but the open never fills, the
              // position is flat (not naked) with a resting open visible in
              // Pending Orders. There is no half-rolled naked state.
              const otocoBody = {
                type: 'OTOCO',
                'trigger-order': item.orderBody,
                orders: [openBody],
              };

              let openId: string;
              if (dryRun) {
                const token2 = await getAccessToken();
                const validation = await ttValidateOrder(
                  `/accounts/${item.pos.accountNumber}/complex-orders`, token2, otocoBody
                );
                if (!validation.valid) {
                  throw new Error(`Roll OTOCO validation failed: ${validation.errors.join('; ')}`);
                }
                orderId = `DRY-${Date.now().toString(36).toUpperCase()}-ROLL`;
                openId = `DRY-${Date.now().toString(36).toUpperCase()}-OPEN`;
              } else {
                let otocoRes: any;
                try {
                  otocoRes = await ttPostComplex(
                    `/accounts/${item.pos.accountNumber}/complex-orders`, token, otocoBody
                  );
                } catch (otocoErr: any) {
                  // OTOCO is validated and placed atomically. A rejection here
                  // means the broker did not accept it — nothing was placed and
                  // the position is unchanged. Make that explicit.
                  throw new Error(
                    `Roll not placed — position unchanged.\n${otocoErr?.message ?? 'Broker rejected the roll.'}`
                  );
                }
                const complexId = String(
                  otocoRes?.data?.['complex-order']?.id ?? otocoRes?.data?.id ?? 'submitted'
                );
                orderId = complexId;
                openId = complexId;
              }

              writeAuditEntry({
                id: crypto.randomUUID(), timestamp: new Date().toISOString(),
                symbol: item.pos.symbol, strategy: item.pos.strategy, action: 'CLOSE_ROLL',
                orderType: 'OTOCO Roll (close → open)', limitPrice: finalCredit,
                quantity: qty, orderId: openId,
                status: dryRun ? 'dry-run' : 'submitted',
              });

              results.push({ symbol: item.pos.symbol, action: item.action, orderId: `Roll OTOCO #${orderId}`, status: 'working', limitPrice: item.limitPrice, estPnl: item.estPnl });
            } else {
              results.push({ symbol: item.pos.symbol, action: item.action, orderId, status: 'working', limitPrice: item.limitPrice, estPnl: item.estPnl });
            }
          } else {
            results.push({ symbol: item.pos.symbol, action: item.action, orderId, status: 'working', limitPrice: item.limitPrice, estPnl: item.estPnl });
          }

          const _auditQty = item.pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1;
          const _creditPc = item.pos.creditReceived / (_auditQty * 100);
          const _closeProfitPct = (item.action === 'TAKE_PROFIT' && _creditPc > 0 && item.estPnl != null)
            ? Math.round(((item.pos.creditReceived - (item.limitPrice * _auditQty * 100)) / item.pos.creditReceived) * 100)
            : undefined;
          writeAuditEntry({
            id: crypto.randomUUID(), timestamp: new Date().toISOString(),
            symbol: item.pos.symbol, strategy: item.pos.strategy, action: item.action,
            orderType: item.orderBody['order-type'], limitPrice: item.limitPrice,
            quantity: _auditQty, orderId,
            status: dryRun ? 'dry-run' : 'submitted',
            estPnl: item.estPnl ?? undefined,
            closeProfitPct: _closeProfitPct,
            creditAtClose: _creditPc,
          });

          const verdict = verdicts[item.pos.key] ?? null;
          const overridden = overrides.has(item.pos.key);
          const updatedMem = recordTradeInMemory(item.pos, item.action, item.limitPrice, verdict, overridden);

          const profile = updatedMem.symbolProfiles[item.pos.symbol];
          if (profile && profile.recentTrades.length > MEMORY_RAW_TRADES_PER_SYMBOL) {
            summarizeSymbolHistory(item.pos.symbol).catch(() => {});
          }

        } catch (e: any) {
          results.push({ symbol: item.pos.symbol, action: item.action, orderId: '—', status: 'error', error: e.message, limitPrice: item.limitPrice, estPnl: item.estPnl });
          writeAuditEntry({
            id: crypto.randomUUID(), timestamp: new Date().toISOString(),
            symbol: item.pos.symbol, strategy: item.pos.strategy, action: item.action,
            orderType: item.orderBody['order-type'], limitPrice: item.limitPrice,
            quantity: item.pos.legs[0]?.quantity ?? 1, orderId: '—', status: 'error', error: e.message,
          });
        }
        completed++;
        setSubmitProgress(Math.round((completed / activeItems.length) * 100));
      }
      setOrderResults(results);
      setStatus('done');
    } catch (e: any) {
      setErrorMsg(e.message); setStatus('error');
    }
  };

  const filledCount = orderResults.filter(r => r.status === 'filled' || r.status === 'working' || r.status === 'submitted').length;
  const rejectedCount = orderResults.filter(r => r.status === 'error' || r.status === 'rejected').length;

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col`}>

        {dryRun && (
          <div className="bg-amber-500/15 border-b border-amber-500/40 px-6 py-2 flex items-center gap-2 shrink-0">
            <span className="text-amber-400 font-bold text-sm">⚗</span>
            <span className="text-amber-300 text-xs font-bold tracking-wider">DRY RUN MODE — No real orders will be placed</span>
          </div>
        )}

        <div className={`flex items-center justify-between px-6 py-4 border-b ${th.border} shrink-0`}>
          <div>
            <h2 className={`text-sm font-bold ${th.text} tracking-wider`}>
              {status === 'done'
                ? dryRun ? 'DRY RUN COMPLETE' : 'ORDER RESULTS'
                : status === 'submitting'
                ? dryRun ? 'SIMULATING ORDERS...' : 'SUBMITTING ORDERS...'
                : `REVIEW ${activeItems.length} ORDER${activeItems.length !== 1 ? 'S' : ''}`}
            </h2>
          </div>
          {status !== 'submitting' && <button onClick={onClose} className={`text-xl ${th.textFaint} hover:${th.text}`}>✕</button>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {needsGtcConfirmation.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4">
              <p className="text-yellow-400 font-bold text-sm mb-3">⚠ Existing GTC Close Order Detected</p>
              {needsGtcConfirmation.map(item => {
                const gtcProfit = item.pos.gtcOrderPrice != null && item.pos.creditReceived > 0
                  ? Math.round(((item.pos.creditReceived - (item.pos.gtcOrderPrice * (item.pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1) * 100)) / item.pos.creditReceived) * 100)
                  : null;
                return (
                  <div key={item.pos.key} className="flex items-center justify-between py-2 border-b border-yellow-500/20 last:border-none">
                    <div>
                      <span className="text-xs font-medium">{item.pos.symbol}</span>
                      <span className="text-xs text-yellow-300 ml-2">— existing GTC Close at <span className="font-bold">{gtcProfit !== null ? `${gtcProfit}%` : '—'} profit</span></span>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={gtcConfirmed.has(item.pos.key)}
                        onChange={() => {
                          setGtcConfirmed(prev => {
                            const n = new Set(prev);
                            if (gtcConfirmed.has(item.pos.key)) n.delete(item.pos.key);
                            else n.add(item.pos.key);
                            return n;
                          });
                        }}
                        className="accent-yellow-400"
                      />
                      <span className="text-yellow-400 font-medium">Replace existing GTC</span>
                    </label>
                  </div>
                );
              })}
              <p className="text-[10px] text-yellow-300 mt-2">Confirming will cancel the old GTC and place the new close order.</p>
            </div>
          )}

          {/* Enriching spinner */}
          {status === 'enriching' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className={`text-xs ${th.textFaint} tracking-widest`}>FETCHING LIVE PRICES & CHAIN DATA...</p>
            </div>
          )}

          {/* Submitting progress */}
          {status === 'submitting' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-full max-w-xs">
                <div className={`h-2 rounded-full ${th.border} border overflow-hidden`}>
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${submitProgress}%` }} />
                </div>
              </div>
              <p className={`text-xs ${th.textFaint}`}>{submitProgress}% — {Math.round(activeItems.length * submitProgress / 100)} of {activeItems.length} orders submitted</p>
            </div>
          )}

          {/* Order results */}
          {status === 'done' && (
            <div className="p-6 space-y-4">
              <div className="flex gap-4">
                {filledCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-xs text-emerald-400 font-bold">{filledCount} submitted</span></div>}
                {rejectedCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-xs text-red-400 font-bold">{rejectedCount} rejected</span></div>}
              </div>
              <div className="space-y-2">
                {orderResults.map((r, i) => (
                  <div key={i} className={`p-3 rounded-lg border ${r.status === 'error' || r.status === 'rejected' ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{r.symbol}</span>
                        <span className={`text-[10px] ${ACTION_META[r.action].color}`}>{ACTION_META[r.action].label}</span>
                        {(r.status === 'error' || r.status === 'rejected') && <span className="text-[9px] text-red-400 font-bold">REJECTED</span>}
                      </div>
                      <div className="text-right">
                        <p className={`text-[10px] ${th.textFaint}`} style={{ fontFamily: "'DM Mono', monospace" }}>{r.orderId}</p>
                        {r.estPnl != null && <p className={`text-[10px] font-bold ${r.estPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.estPnl >= 0 ? '+' : ''}${r.estPnl.toFixed(2)}</p>}
                      </div>
                    </div>
                    {r.error && (
                      <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                        <p className="text-[10px] text-red-300 leading-relaxed">
                          {r.error.includes('cannot_close_against_more_than_existing') || r.error.includes('closing order')
                            ? `TastyTrade blocked this order because an existing closing order is already working on this position. Go to TastyTrade → Activity → Working Orders, cancel the existing GTC on ${r.symbol}, then retry here.`
                            : r.error.includes('cannot_update_order') || r.error.includes('cancel')
                            ? `The existing GTC order could not be cancelled automatically. Cancel it manually in TastyTrade first, then retry.`
                            : r.error}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className={`text-[10px} ${th.textFaint} text-center`}>
                {dryRun ? 'Dry run complete' : 'Verify working orders in TastyTrade. Positions will refresh on close.'}
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="p-6 flex flex-col items-center gap-3">
              <span className="text-2xl">✕</span>
              <p className="text-sm font-bold text-red-400">FAILED</p>
              <div className={`p-3 rounded-lg bg-red-500/10 border border-red-500/40 w-full`}>
                <p className="text-xs text-red-300" style={{ fontFamily: "'DM Mono', monospace" }}>{errorMsg}</p>
              </div>
            </div>
          )}

          {status === 'ready' && (
            <div className="space-y-2">
              {priceErrorCount > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/40">
                  <span className="text-red-400 font-bold">✕</span>
                  <p className="text-xs text-red-400 font-bold">{priceErrorCount} position{priceErrorCount !== 1 ? 's have' : ' has'} price errors — uncheck or fix before submitting.</p>
                </div>
              )}
              {warningCount > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <span className="text-yellow-400">⚠</span>
                  <p className="text-xs text-yellow-400">{warningCount} position{warningCount !== 1 ? 's have' : ' has'} warnings. Review before submitting.</p>
                </div>
              )}

              {batchItems.map(item => {
                const isExcluded = excluded.has(item.pos.key);
                const ri = rollInputs[item.pos.key];
                const suggestion = rollSuggestions[item.pos.key];
                const verdict = verdicts[item.pos.key];
                const isStopHigh = verdict?.verdict === 'STOP' && verdict.confidence === 'HIGH';
                const isOverridden = overrides.has(item.pos.key);
                return (
                  <div key={item.pos.key} className={`rounded-lg border transition-all ${
                    isExcluded ? 'opacity-40 border-dashed' :
                    item.priceError != null && !isExcluded ? 'border-red-500/70' :
                    isStopHigh && !isOverridden ? 'border-red-500/60' :
                    verdict?.verdict === 'CAUTION' ? 'border-yellow-500/40' :
                    item.stalePriceWarning || item.duplicateGtcWarning ? 'border-yellow-500/50' :
                    th.border
                  }`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <input type="checkbox" checked={!isExcluded}
                        onChange={() => setExcluded(prev => { const n = new Set(prev); isExcluded ? n.delete(item.pos.key) : n.add(item.pos.key); return n; })}
                        className="w-4 h-4 accent-blue-500 cursor-pointer shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{item.pos.symbol}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 border rounded font-bold ${stratColor(item.pos.strategy)}`}>{item.pos.strategy}</span>
                          <span className={`text-[10px] font-bold ${ACTION_META[item.action].color}`}>{ACTION_META[item.action].label}</span>
                          {verdict && <ActionVerdictBadge verdict={verdict} compact th={th} />}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className={`text-[10px] ${th.textFaint}`}>{item.pos.expDate} · {item.pos.dte}d</span>
                          {item.stalePriceWarning && <span className="text-[10px] text-yellow-400 font-bold">⚠ Price moved since load</span>}
                          {item.duplicateGtcWarning && <span className="text-[10px] text-yellow-400 font-bold">⚠ GTC already working</span>}
                        </div>
                        {item.priceError != null && !isExcluded && (
                          <div className="mt-1.5 flex items-start gap-1.5">
                            <span className="text-red-400 text-[9px] mt-0.5 shrink-0">✕</span>
                            <p className="text-[9px] text-red-400 leading-relaxed">{item.priceError}</p>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0 space-y-1 min-w-[140px]">
                        <div className="flex items-center justify-end gap-1">
                          <span className={`text-[9px} ${th.textFaint}`}>Limit $</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={limitOverrides[item.pos.key] ?? item.limitPrice.toFixed(2)}
                            onChange={e => setLimitOverrides(prev => ({ ...prev, [item.pos.key]: e.target.value }))}
                            onBlur={e => {
                              const v = parseFloat(e.target.value);
                              if (isNaN(v) || v <= 0) setLimitOverrides(prev => { const n = { ...prev }; delete n[item.pos.key]; return n; });
                              else setLimitOverrides(prev => ({ ...prev, [item.pos.key]: v.toFixed(2) }));
                            }}
                            className={`w-20 text-xs font-bold text-right px-1.5 py-0.5 rounded border ${item.priceError != null ? 'border-red-500/60 text-red-400' : 'border-blue-500/40 text-blue-400'} bg-transparent outline-none focus:ac-border`}
                            style={{ fontFamily: "'DM Mono', monospace" }}
                          />
                        </div>
                        {(() => {
                          const q = Math.abs(item.pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1) || 1;
                          const creditPc = item.pos.creditReceived / (q * 100);
                          const effLimit = parseFloat(limitOverrides[item.pos.key] ?? item.limitPrice.toFixed(2)) || item.limitPrice;
                          // Live P&L follows the current limit: credit kept minus cost to close.
                          const livePnl = parseFloat(((creditPc - effLimit) * q * 100).toFixed(2));
                          return (
                            <p className={`text-[10px} font-bold ${livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}
                            </p>
                          );
                        })()}
                        <p className={`text-[10px} ${th.textFaint}`}>{item.orderBody['time-in-force']}</p>
                      </div>
                    </div>

                    {!isExcluded && (item.action === 'TAKE_PROFIT' || item.action === 'CUT_LOSSES' || item.action === 'CLOSE_ROLL') && (
                      <div className="px-4 pb-2">
                        <TakeProfitScale
                          creditPerContract={(() => {
                            const q = Math.abs(item.pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1) || 1;
                            return item.pos.creditReceived / (q * 100);
                          })()}
                          quote={item.closeQuote ?? null}
                          limit={parseFloat(limitOverrides[item.pos.key] ?? item.limitPrice.toFixed(2)) || item.limitPrice}
                          onChange={(price) => setLimitOverrides(prev => ({ ...prev, [item.pos.key]: price.toFixed(2) }))}
                          th={th}
                        />
                      </div>
                    )}

                    {item.action === 'CLOSE_ROLL' && !isExcluded && (
                      <div className={`px-4 pb-3 border-t ${th.borderLight}`}>
                        <div className="flex items-center gap-2 pt-2 pb-2">
                          <span className={`text-[9px} ${th.textFaint} uppercase`}>Action:</span>
                          <button onClick={() => setRollMode((p: Record<string,string>) => ({...p, [item.pos.key]: 'close'}))} className={`text-[9px] px-2 py-0.5 rounded border font-bold ${(rollMode[item.pos.key] ?? 'close') === 'close' ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' : th.border + ' ' + th.textFaint}`}>Close Only</button>
                          <button onClick={() => setRollMode((p: Record<string,string>) => ({...p, [item.pos.key]: 'roll'}))} className={`text-[9px] px-2 py-0.5 rounded border font-bold ${rollMode[item.pos.key] === 'roll' ? 'border-purple-500 text-purple-400 bg-purple-500/10' : th.border + ' ' + th.textFaint}`}>Close + Roll</button>
                          <span className={`text-[9px} ${th.textFaint}`}>{rollMode[item.pos.key] === 'roll' ? 'Closes and opens new spread.' : 'Closes position only.'}</span>
                        </div>
                        <div className="pt-2 space-y-3" style={{display: rollMode[item.pos.key] === 'roll' ? undefined : 'none'}}>
                          {rollSearchLoading[item.pos.key] && (
                            <div className="flex items-center gap-2 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                              <p className="text-[10px] text-blue-300">Scanning the chain for the best roll across expirations and strikes...</p>
                            </div>
                          )}
                          {!rollSearchLoading[item.pos.key] && (rollCandidatePicks[item.pos.key]?.length ?? 0) === 0 && (
                            <div className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                              <p className="text-[10px] text-yellow-300">No qualifying roll candidates found in the 28-50 DTE window for this symbol. Enter the new expiry/strikes/credit manually below.</p>
                            </div>
                          )}
                          {(rollCandidatePicks[item.pos.key] ?? []).map((pick, pickIdx) => {
                            const c = pick.candidate;
                            const isSelected = suggestion != null
                              && suggestion.expiry === c.expiry
                              && suggestion.shortStrike === c.shortStrike
                              && suggestion.longStrike === c.longStrike;
                            return (
                              <div key={`${c.expiry}-${c.shortStrike}-${c.longStrike}`} className={`rounded-lg border p-3 space-y-2 ${
                                isSelected ? 'border-purple-500/60 bg-purple-500/10' :
                                rollIsBlocking(c) ? 'border-red-500/50 bg-red-500/5' :
                                c.ruleViolations.length > 0 ? 'border-yellow-500/40 bg-yellow-500/5' :
                                'border-blue-500/30 bg-blue-500/5'
                              }`}>
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {pick.categories.map(cat => (
                                      <span key={cat} className="text-[9px] text-blue-400 font-bold uppercase tracking-widest px-1.5 py-0.5 border border-blue-500/40 rounded bg-blue-500/10">
                                        {ROLL_CATEGORY_LABELS[cat]}
                                      </span>
                                    ))}
                                    <span className="text-[10px] ac-text" style={{ fontFamily: "'DM Mono', monospace" }}>
                                      {c.expiry} ({c.dte}d) · {c.shortStrike}/{c.longStrike} · δ{c.delta.toFixed(2)}
                                    </span>
                                  </div>
                                  <button onClick={() => {
                                    setRollSuggestions(prev => ({ ...prev, [item.pos.key]: c }));
                                    setRollInputs(prev => ({
                                      ...prev,
                                      [item.pos.key]: { expiry: c.expiry, shortStrike: String(c.shortStrike), longStrike: String(c.longStrike), credit: String(c.credit) }
                                    }));
                                  }} className={`text-[9px] px-2 py-0.5 border rounded transition-colors ${isSelected ? 'border-purple-500 text-purple-300 bg-purple-500/20' : 'ac-btn hover:ac-bg-20'}`}>
                                    {isSelected ? '✓ Selected' : 'Use this'}
                                  </button>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                  <div>
                                    <p className={`text-[9px} ${th.textFaint}`}>Credit (mid)</p>
                                    <p className={`text-[10px} font-bold ${c.meetsMinCredit ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                                      ${c.creditMid.toFixed(2)}
                                    </p>
                                    <p className={`text-[9px} ${th.textFaint}`}>{(c.creditRatio * 100).toFixed(0)}% of width</p>
                                  </div>
                                  <div>
                                    <p className={`text-[9px} ${th.textFaint}`}>Limit order</p>
                                    <p className={`text-[10px} font-bold text-blue-400`} style={{ fontFamily: "'DM Mono', monospace" }}>
                                      ${c.credit.toFixed(2)}
                                    </p>
                                    <p className={`text-[9px} ${th.textFaint}`}>85% of mid</p>
                                  </div>
                                  <div>
                                    <p className={`text-[9px} ${th.textFaint}`}>OI (short/long)</p>
                                    <p className={`text-[10px} font-bold ${c.meetsOi ? 'text-emerald-400' : 'text-yellow-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                                      {c.shortOi ?? '?'} / {c.longOi ?? '?'}
                                    </p>
                                    <p className={`text-[9px} ${th.textFaint}`}>need ≥500</p>
                                  </div>
                                  <div>
                                    <p className={`text-[9px} ${th.textFaint}`}>Bid-ask (sh/lg)</p>
                                    <p className={`text-[10px} font-bold ${c.meetsBidAsk ? 'text-emerald-400' : 'text-yellow-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                                      ${c.shortBidAsk?.toFixed(2) ?? '?'} / ${c.longBidAsk?.toFixed(2) ?? '?'}
                                    </p>
                                    <p className={`text-[9px} ${th.textFaint}`}>need ≤$0.10</p>
                                  </div>
                                </div>
                                <div className={`pt-2 border-t ${th.borderLight}`}>
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <span className={`text-[9px] ${th.textFaint} uppercase tracking-widest`}>Net Roll P&amp;L</span>
                                    <span className={`text-xs font-bold ${c.netRollPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                                      {c.netRollPnl >= 0 ? '+' : ''}${c.netRollPnl.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                                    <span className={`text-[9px] ${th.textFaint}`}>Close cost <span className="text-red-300 font-bold">-${c.closeCost.toFixed(2)}</span></span>
                                    <span className={`text-[9px] ${th.textFaint}`}>+</span>
                                    <span className={`text-[9px] ${th.textFaint}`}>New credit <span className="text-emerald-300 font-bold">+${c.openCredit.toFixed(2)}</span></span>
                                  </div>
                                </div>
                                {c.ruleViolations.length > 0 && (
                                  <div className="space-y-1">
                                    {c.ruleViolations.map((v, i) => (
                                      <div key={i} className="flex items-start gap-1.5">
                                        <span className={`text-[9px} shrink-0 mt-0.5 ${rollIsBlocking(c) ? 'text-red-400' : 'text-yellow-400'}`}>
                                          {rollIsBlocking(c) ? '✕' : '⚠'}
                                        </span>
                                        <p className={`text-[9px} leading-relaxed ${rollIsBlocking(c) ? 'text-red-300' : 'text-yellow-300'}`}>{v}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: 'New Expiry', key: 'expiry', placeholder: (() => { const d = new Date(); d.setDate(d.getDate() + 45); return d.toISOString().slice(0, 10); })() },
                              { label: 'Short Strike', key: 'shortStrike', placeholder: '490' },
                              { label: 'Long Strike', key: 'longStrike', placeholder: '485' },
                              { label: 'Credit ($)', key: 'credit', placeholder: '1.50' },
                            ].map(f => (
                              <div key={f.key}>
                                <p className={`text-[9px} ${th.textFaint} mb-1`}>{f.label}</p>
                                <input
                                  value={ri?.[f.key as keyof typeof ri] ?? ''}
                                  onChange={e => setRollInputs(prev => ({ ...prev, [item.pos.key]: { ...prev[item.pos.key], [f.key]: e.target.value } }))}
                                  placeholder={f.placeholder}
                                  className={`w-full text-[10px] px-2 py-1.5 rounded border ${th.inputBorder} ${th.input} ${th.text} outline-none focus:border-purple-500`}
                                  style={{ fontFamily: "'DM Mono', monospace" }}
                                />
                              </div>
                            ))}
                          </div>

                          {ri?.credit && ri?.shortStrike && ri?.longStrike && (() => {
                            const inputCredit = parseFloat(ri.credit);
                            const inputWidth  = Math.abs(parseFloat(ri.shortStrike) - parseFloat(ri.longStrike));
                            const inputRatio  = inputWidth > 0 ? inputCredit / inputWidth : 0;
                            const minCredit   = inputWidth / 3;
                            if (inputCredit > 0 && inputRatio < 1/3) {
                              return (
                                <p className="text-[9px} text-red-400">
                                  ✕ Credit ${inputCredit.toFixed(2)} &lt; 1/3 of ${inputWidth} spread (${minCredit.toFixed(2)} min) — violates credit rule
                                </p>
                              );
                            }
                            if (inputCredit > 0) {
                              return (
                                <p className="text-[9px} text-emerald-400">
                                  ✓ Credit ratio {(inputRatio * 100).toFixed(0)}% of spread width — meets 1/3 rule
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`px-6 py-4 border-t ${th.border} shrink-0`}>
          {status === 'ready' && (
            <div className="space-y-3">
              <div className={`flex items-center justify-between p-3 rounded-lg ${th.card}`}>
                <div className="flex gap-6">
                  <div>
                    <p className={`text-[9px} ${th.textFaint} uppercase tracking-widest`}>Orders</p>
                    <p className={`text-sm font-bold ${th.text}`}>{activeItems.length}</p>
                  </div>
                  <div>
                    <p className={`text-[9px} ${th.textFaint} uppercase tracking-widest`}>Total Debit</p>
                    <p className="text-sm font-bold text-blue-400" style={{ fontFamily: "'DM Mono', monospace" }}>${totalDebit.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className={`text-[9px} ${th.textFaint} uppercase tracking-widest`}>Est. P&L</p>
                    <p className={`text-sm font-bold ${totalEstPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                      {totalEstPnl >= 0 ? '+' : ''}${totalEstPnl.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                {needsGtcConfirmation.length > 0 && !allGtcConfirmed ? (
                  <button disabled className="flex-1 py-3 bg-slate-700 text-slate-400 rounded-xl text-xs font-bold tracking-widest cursor-not-allowed">
                    CONFIRM REPLACING EXISTING GTC TO CONTINUE
                  </button>
                ) : (
                  <button onClick={submitAll} disabled={activeItems.length === 0}
                    className={`flex-1 py-3 text-white rounded-xl text-xs font-bold tracking-widest transition-colors ${dryRun ? 'bg-amber-600 hover:bg-amber-500' : 'ac-btn-solid'}`}>
                    {dryRun ? `⚗ DRY RUN — Simulate ${activeItems.length} Order${activeItems.length !== 1 ? 's' : ''}` : `SUBMIT ${activeItems.length} ORDER${activeItems.length !== 1 ? 'S' : ''}`}
                  </button>
                )}
                <button onClick={onClose} className={`px-4 py-3 border ${th.border} ${th.textFaint} rounded-xl text-xs font-medium hover:border-white/30 transition-colors`}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {status === 'done' && (
            <div className="flex gap-3">
              <button onClick={() => { onSuccess(); onClose(); }} className={`flex-1 py-3 text-white rounded-xl text-xs font-bold tracking-widest transition-colors ${dryRun ? 'bg-amber-600 hover:bg-amber-500' : 'ac-btn-solid'}`}>
                {dryRun ? 'DRY RUN DONE — Close' : 'DONE — REFRESH POSITIONS'}
              </button>
            </div>
          )}
          {status === 'error' && (
            <button onClick={onClose} className={`w-full py-3 border ${th.border} ${th.textFaint} rounded-xl text-xs font-medium hover:border-white/30 transition-colors`}>
              Close
            </button>
          )}
          {(status === 'enriching' || status === 'submitting') && (
            <button disabled className="w-full py-3 bg-slate-700 text-slate-500 rounded-xl text-xs font-bold tracking-widest">
              {status === 'enriching' ? 'FETCHING DATA...' : 'SUBMITTING...'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Audit Log Panel ────────────────────────────────────────────────────────
function AuditLogPanel({ onClose, th }: { onClose: () => void; th: typeof THEMES[Theme] }) {
  const [log, setLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    setLog(readAuditLog());
  }, []);

  const clearAuditLog = () => {
    if (!confirm('Clear the audit log? This cannot be undone.')) return;
    try {
      localStorage.removeItem(LS_AUDIT_LOG);
      setLog([]);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`${th.card} border ${th.border} rounded-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden shadow-2xl`}>
        <div className={`px-6 py-4 border-b ${th.border} flex items-center justify-between`}>
          <div>
            <h2 className={`text-lg font-bold ${th.text}`}>Audit Log</h2>
            <p className={`text-xs ${th.textFaint}`}>{log.length} recorded action{log.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className={`text-xl ${th.textFaint} hover:${th.text}`}>×</button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[65vh]">
          {log.length === 0 ? (
            <div className={`p-8 rounded-xl border ${th.border} text-center ${th.textMuted}`}>
              No audit entries yet.
            </div>
          ) : (
            <div className="space-y-2">
              {log.map((entry) => (
                <div key={entry.id} className={`p-4 rounded-xl border ${th.border} ${th.input}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${th.text}`}>{entry.symbol}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${th.tag} ${th.textMuted}`}>{entry.strategy}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${entry.status === 'error' ? 'bg-red-500/15 text-red-300' : entry.status === 'dry-run' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {entry.status}
                        </span>
                      </div>
                      <p className={`text-xs ${th.textFaint} mt-1`}>
                        {new Date(entry.timestamp).toLocaleString()} · {entry.action} · {entry.orderType}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-mono ${th.text}`}>${entry.limitPrice.toFixed(2)}</p>
                      <p className={`text-xs ${th.textFaint}`}>Qty {entry.quantity}</p>
                    </div>
                  </div>
                  {entry.error && <p className="mt-2 text-xs text-red-300">{entry.error}</p>}
                  {entry.estPnl != null && <p className={`mt-2 text-xs ${entry.estPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>Est. P/L: ${entry.estPnl.toFixed(2)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`px-6 py-4 border-t ${th.border} flex gap-3 justify-end`}>
          <button onClick={exportAuditCsv} disabled={log.length === 0} className={`px-4 py-2 rounded-xl border ${th.border} ${th.textMuted} disabled:opacity-40 text-xs font-bold tracking-widest`}>
            Export CSV
          </button>
          <button onClick={clearAuditLog} disabled={log.length === 0} className="px-4 py-2 rounded-xl border border-red-500/40 text-red-300 disabled:opacity-40 text-xs font-bold tracking-widest">
            Clear
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold tracking-widest">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Memory Panel ───────────────────────────────────────────────────────────
function MemoryPanel({ onClose, th }: { onClose: () => void; th: typeof THEMES[Theme] }) {
  const [mem, setMem] = useState<TradingMemory>(readMemory);
  const [summarizing, setSummarizing] = useState(false);

  const handleSummarizeAll = async () => {
    setSummarizing(true);
    try {
      const m = readMemory();
      // Summarize all symbols with enough data
      for (const sym of Object.keys(m.symbolProfiles)) {
        if (m.symbolProfiles[sym].recentTrades.length > MEMORY_RAW_TRADES_PER_SYMBOL) {
          await summarizeSymbolHistory(sym);
        }
      }
      // Force behavior summarization regardless of time interval
      const m2 = readMemory();
      m2.lastSummarized = null; // reset so summarize runs
      writeMemory(m2);
      await summarizeBehaviorProfile();
      setMem(readMemory());
    } finally { setSummarizing(false); }
  };

  const symbols = Object.values(mem.symbolProfiles).sort((a, b) => b.tradeCount - a.tradeCount);
  const bp = mem.behaviorProfile;

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${th.border} shrink-0`}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-purple-400 text-sm">◆</span>
              <h2 className={`text-sm font-bold ${th.text} tracking-wider`}>TRADING MEMORY</h2>
            </div>
            <p className={`text-[10px] ${th.textFaint} mt-0.5`}>
              {bp.totalTrades} trades recorded · {symbols.length} symbols tracked
              {mem.lastSummarized ? ` · Last summarized ${Math.round((Date.now() - new Date(mem.lastSummarized).getTime()) / 86400000)}d ago` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSummarizeAll} disabled={summarizing}
              className={`text-[10px] px-3 py-1.5 border border-purple-700 text-purple-400 rounded hover:border-purple-500 hover:bg-purple-500/10 transition-colors disabled:opacity-50`}>
              {summarizing ? '◈ Summarizing...' : '◈ Summarize Now'}
            </button>
            <button onClick={() => { clearMemory(); setMem(emptyMemory()); }}
              className={`text-[10px] px-3 py-1.5 border ${th.border} ${th.textFaint} rounded hover:border-red-500 hover:text-red-400 transition-colors`}>
              Clear
            </button>
            <button onClick={onClose} className={`text-xl ${th.textFaint} hover:${th.text}`}>✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {bp.totalTrades === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <p className={`text-sm ${th.textFaint}`}>No trades recorded yet</p>
              <p className={`text-[10px] ${th.textFaint} text-center max-w-xs`}>
                Memory builds automatically as you execute trades through Options Hunter. Each trade teaches the verdict engine your patterns.
              </p>
            </div>
          )}

          {/* Behavioral profile */}
          {bp.totalTrades > 0 && (
            <div className={`p-4 rounded-xl border border-purple-700/40 bg-purple-500/5`}>
              <p className="text-[9px] text-purple-400 uppercase tracking-widest mb-3 font-bold">Your Trading Profile</p>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <p className={`text-[9px] ${th.textFaint}`}>Total trades</p>
                  <p className={`text-sm font-bold ${th.text}`}>{bp.totalTrades}</p>
                </div>
                <div>
                  <p className={`text-[9px] ${th.textFaint}`}>AI overrides</p>
                  <p className={`text-sm font-bold ${bp.overrideCount > 0 ? 'text-yellow-400' : th.textFaint}`}>
                    {bp.overrideCount}
                    {bp.overrideCount > 0 && <span className={`text-[10px] ml-1 ${th.textFaint}`}>({Math.round((bp.overrideWins / bp.overrideCount) * 100)}% right)</span>}
                  </p>
                </div>
                <div>
                  <p className={`text-[9px] ${th.textFaint}`}>Symbols tracked</p>
                  <p className={`text-sm font-bold ${th.text}`}>{symbols.length}</p>
                </div>
              </div>
              {bp.summary && <p className={`text-[11px] ${th.textFaint} leading-relaxed mb-2`}>{bp.summary}</p>}
              <div className="grid grid-cols-2 gap-3">
                {bp.strengths.length > 0 && (
                  <div>
                    <p className="text-[9px] text-emerald-400 font-bold mb-1">Strengths</p>
                    {bp.strengths.map((s, i) => <p key={i} className="text-[10px] text-emerald-300">▸ {s}</p>)}
                  </div>
                )}
                {bp.weaknesses.length > 0 && (
                  <div>
                    <p className="text-[9px] text-red-400 font-bold mb-1">Watch out for</p>
                    {bp.weaknesses.map((w, i) => <p key={i} className="text-[10px] text-red-300">▸ {w}</p>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Symbol profiles */}
          {symbols.length > 0 && (
            <div>
              <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-3 font-bold`}>Symbol History</p>
              <div className="space-y-3">
                {symbols.map(profile => (
                  <div key={profile.symbol} className={`p-4 rounded-lg border ${th.border}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{profile.symbol}</span>
                        <span className={`text-[10px] ${th.textFaint}`}>{profile.tradeCount} trades</span>
                        <span className={`text-[10px] font-bold ${profile.winRate >= 0.6 ? 'text-emerald-400' : profile.winRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {Math.round(profile.winRate * 100)}% win rate
                        </span>
                        <span className={`text-[10px] font-bold ${profile.avgPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          avg {profile.avgPnlPct.toFixed(1)}% P&L
                        </span>
                      </div>
                    </div>
                    {profile.historySummary && (
                      <p className={`text-[10px] ${th.textFaint} leading-relaxed mb-2`}>{profile.historySummary}</p>
                    )}
                    {profile.recentTrades.slice(0, 3).map((t, i) => {
                      const ago = Math.round((Date.now() - new Date(t.timestamp).getTime()) / 86400000);
                      return (
                        <div key={i} className={`flex items-center gap-3 text-[9px] py-1 border-t ${th.borderLight} first:border-t-0`}>
                          <span className={`${th.textFaint} w-12 shrink-0`}>{ago}d ago</span>
                          <span className={`${th.text} w-16 shrink-0`} style={{ fontFamily: "'DM Mono', monospace" }}>{t.strategy}</span>
                          <span className={`${th.textFaint} flex-1`}>{t.action} @ {t.dte}d DTE</span>
                          <span className={`font-bold ${t.outcome === 'WIN' ? 'text-emerald-400' : t.outcome === 'LOSS' ? 'text-red-400' : 'text-slate-400'}`}>
                            {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
                          </span>
                          {t.aiVerdict && (
                            <span className={`${t.aiVerdict === 'STOP' ? 'text-red-400' : t.aiVerdict === 'CAUTION' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                              AI:{t.aiVerdict}{t.aiOverridden ? '⚡' : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBar({ positions, th }: { positions: Position[]; th: typeof THEMES[Theme] }) {
  const totalCredit = positions.reduce((s, p) => s + p.creditReceived, 0);
  const totalPnl = positions.reduce((s, p) => s + (p.pnl ?? p.plOpen ?? 0), 0);
  const capturedPct = totalCredit > 0 ? (totalPnl / totalCredit) * 100 : 0;
  const totalAtRisk = positions.reduce((s, p) => s + p.maxRisk, 0);
  const totalTheta = positions.reduce((s, p) => {
    if (p.currentValue != null && p.dte > 0) return s + p.currentValue / p.dte;
    if (p.dte > 0) return s + p.creditReceived / p.dte;
    return s;
  }, 0);

  return (
    <div className={`grid grid-cols-5 border-b ${th.border}`}>
      {[
        { label: 'Open Positions', value: String(positions.length), sub: `${positions.length} position${positions.length !== 1 ? 's' : ''}`, color: th.text },
        { label: 'Captured', value: `${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(0)}`, sub: `of $${totalCredit.toFixed(0)} · ${capturedPct.toFixed(0)}%`, color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
        { label: `${positions.length > 0 ? Math.round(positions.reduce((s,p) => s + p.profitTarget, 0) / positions.length * 100) : 50}% Target`, value: `$${Math.round(positions.reduce((s,p) => s + p.targetPrice, 0))}`, sub: `${totalCredit > 0 ? Math.round((totalPnl / Math.max(positions.reduce((s,p) => s + p.targetPrice, 0), 1)) * 100) : 0}% of target`, color: 'text-yellow-400' },
        { label: 'At Risk', value: `$${totalAtRisk.toFixed(0)}`, sub: 'max loss if expired', color: th.textMuted },
        { label: 'Est. Theta/D', value: totalTheta > 0 ? `+$${totalTheta.toFixed(2)}` : '—', sub: 'daily decay', color: 'text-blue-400' },
      ].map((item, i, arr) => (
        <div key={item.label} className={`p-5 ${i < arr.length - 1 ? `border-r ${th.border}` : ''} flex flex-col items-center text-center`}>
          <p className={`text-[10px] ${th.textFaint} uppercase tracking-widest mb-2`}>{item.label}</p>
          <p className={`text-3xl font-bold ${item.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>{item.value}</p>
          <p className={`text-[10px] ${th.textFaint} mt-1`}>{item.sub}</p>
        </div>
      ))}
    </div>
  );
}


interface PortfolioGreekTotals {
  netDeltaRaw: number | null;
  deltaShares: number | null;
  thetaRaw: number | null;
  thetaPerDay: number | null;
  gammaRaw: number | null;
  gammaSharesPerDollar: number | null;
  vegaRaw: number | null;
  vegaPerIvPoint: number | null;
}

function sumNullable(positions: Position[], selector: (p: Position) => number | null): number | null {
  let total = 0;
  let any = false;
  for (const pos of positions) {
    const val = selector(pos);
    if (val == null || Number.isNaN(val)) continue;
    total += val;
    any = true;
  }
  return any ? total : null;
}

function calculatePortfolioGreeks(positions: Position[]): PortfolioGreekTotals {
  const netDeltaRaw = sumNullable(positions, p => p.netDelta);
  const thetaRaw = sumNullable(positions, p => p.theta);
  const gammaRaw = sumNullable(positions, p => p.gamma);
  const vegaRaw = sumNullable(positions, p => p.netVega);

  return {
    netDeltaRaw,
    deltaShares: netDeltaRaw == null ? null : netDeltaRaw * 100,
    thetaRaw,
    thetaPerDay: thetaRaw == null ? null : thetaRaw * 100,
    gammaRaw,
    gammaSharesPerDollar: gammaRaw == null ? null : gammaRaw * 100,
    vegaRaw,
    vegaPerIvPoint: vegaRaw == null ? null : vegaRaw * 100,
  };
}

function fmtSignedWhole(value: number | null, suffix = ''): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(0)}${suffix}`;
}

function fmtSignedMoneyWhole(value: number | null, suffix = ''): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(0)}${suffix}`;
}

function fmtSignedDecimal(value: number | null, decimals = 1, suffix = ''): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(decimals)}${suffix}`;
}

function fmtAbsDecimal(value: number | null, decimals = 1, suffix = ''): string {
  if (value == null) return '—';
  return `${Math.abs(value).toFixed(decimals)}${suffix}`;
}

function portfolioDeltaColor(deltaShares: number | null, fallback: string): string {
  if (deltaShares == null) return fallback;
  const abs = Math.abs(deltaShares);
  if (abs <= 100) return 'text-emerald-400';
  if (abs <= 250) return 'text-yellow-400';
  if (abs <= 500) return 'text-orange-400';
  return 'text-red-400';
}

function portfolioDeltaLabel(deltaShares: number | null): string {
  if (deltaShares == null) return 'Not Available';
  const abs = Math.abs(deltaShares);
  if (abs <= 25) return '⚪ Neutral';
  if (abs <= 100) return deltaShares >= 0 ? '🟢 Mild Bullish' : '🟢 Mild Bearish';
  if (abs <= 250) return deltaShares >= 0 ? '🟡 Bullish' : '🟡 Bearish';
  if (abs <= 500) return '🟠 Elevated Direction';
  return '🔴 High Directional Risk';
}

function portfolioThetaColor(thetaPerDay: number | null, fallback: string): string {
  if (thetaPerDay == null) return fallback;
  if (thetaPerDay >= 50) return 'text-emerald-400';
  if (thetaPerDay >= 20) return 'text-emerald-300';
  if (thetaPerDay >= 5) return 'text-yellow-400';
  if (thetaPerDay >= 0) return 'text-orange-400';
  return 'text-red-400';
}

function portfolioThetaLabel(thetaPerDay: number | null): string {
  if (thetaPerDay == null) return 'Not Available';
  if (thetaPerDay >= 50) return '🟢 Excellent Income';
  if (thetaPerDay >= 20) return '🟢 Strong Income';
  if (thetaPerDay >= 5) return '🟡 Light Income';
  if (thetaPerDay >= 0) return '🟠 Minimal Income';
  return '🔴 Negative Theta';
}

function portfolioGammaColor(gammaSharesPerDollar: number | null, fallback: string): string {
  if (gammaSharesPerDollar == null) return fallback;
  const abs = Math.abs(gammaSharesPerDollar);
  if (abs <= 5) return 'text-emerald-400';
  if (abs <= 15) return 'text-yellow-400';
  if (abs <= 30) return 'text-orange-400';
  return 'text-red-400';
}

function portfolioGammaLabel(gammaSharesPerDollar: number | null): string {
  if (gammaSharesPerDollar == null) return 'Not Available';
  const abs = Math.abs(gammaSharesPerDollar);
  if (abs <= 5) return '🟢 Low Gamma Risk';
  if (abs <= 15) return '🟡 Moderate Gamma Risk';
  if (abs <= 30) return '🟠 Elevated Gamma Risk';
  return '🔴 High Gamma Risk';
}

function portfolioVegaColor(vegaPerIvPoint: number | null, fallback: string): string {
  if (vegaPerIvPoint == null) return fallback;
  const abs = Math.abs(vegaPerIvPoint);
  if (abs <= 100) return 'text-emerald-400';
  if (abs <= 250) return 'text-yellow-400';
  if (abs <= 500) return 'text-orange-400';
  return 'text-red-400';
}

function portfolioVegaLabel(vegaPerIvPoint: number | null): string {
  if (vegaPerIvPoint == null) return 'Not Available';
  const abs = Math.abs(vegaPerIvPoint);
  if (abs < 1) return '⚪ Neutral Vol';
  const side = vegaPerIvPoint < 0 ? 'Short Vol' : 'Long Vol';
  if (abs <= 100) return vegaPerIvPoint < 0 ? `🟢 ${side}` : `🟡 ${side}`;
  if (abs <= 250) return `🟡 Moderate ${side}`;
  if (abs <= 500) return `🟠 Elevated ${side}`;
  return `🔴 High ${side} Risk`;
}

function topGreekContributors(
  positions: Position[],
  selector: (p: Position) => number | null,
  formatter: (value: number) => string,
  count = 3
): string {
  const rows = positions
    .map(p => ({ pos: p, value: selector(p) }))
    .filter((row): row is { pos: Position; value: number } => row.value != null && !Number.isNaN(row.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, count);

  if (rows.length === 0) return 'No data';
  return rows.map(row => `${row.pos.symbol} ${formatter(row.value)}`).join(' · ');
}

function PortfolioGreeksDashboard({ positions, th }: { positions: Position[]; th: typeof THEMES[Theme] }) {
  const totals = calculatePortfolioGreeks(positions);

  const deltaDrivers = topGreekContributors(
    positions,
    p => p.netDelta == null ? null : p.netDelta * 100,
    v => fmtSignedWhole(v, ' shares'),
    2
  );
  const thetaDrivers = topGreekContributors(
    positions,
    p => p.theta == null ? null : p.theta * 100,
    v => fmtSignedMoneyWhole(v, '/d'),
    2
  );
  const gammaDrivers = topGreekContributors(
    positions,
    p => p.gamma == null ? null : p.gamma * 100,
    v => fmtAbsDecimal(v, 1),
    2
  );
  const vegaDrivers = topGreekContributors(
    positions,
    p => p.netVega == null ? null : p.netVega * 100,
    v => fmtSignedMoneyWhole(v, '/pt'),
    2
  );

  const cards = [
    {
      greek: 'Δ',
      label: 'Direction',
      value: fmtSignedWhole(totals.deltaShares, ' shares'),
      status: portfolioDeltaLabel(totals.deltaShares),
      drivers: deltaDrivers,
      color: portfolioDeltaColor(totals.deltaShares, th.text),
      title: totals.netDeltaRaw != null
        ? `Net delta: ${totals.deltaShares?.toFixed(0)} share-equivalent · raw ${totals.netDeltaRaw.toFixed(4)} · ${portfolioDeltaLabel(totals.deltaShares)}`
        : undefined,
    },
    {
      greek: 'Θ',
      label: 'Income',
      value: fmtSignedMoneyWhole(totals.thetaPerDay, '/d'),
      status: portfolioThetaLabel(totals.thetaPerDay),
      drivers: thetaDrivers,
      color: portfolioThetaColor(totals.thetaPerDay, th.text),
      title: totals.thetaRaw != null
        ? `Theta: $${totals.thetaPerDay?.toFixed(0)}/d · raw ${totals.thetaRaw.toFixed(4)} · ${portfolioThetaLabel(totals.thetaPerDay)}`
        : undefined,
    },
    {
      greek: 'Γ',
      label: 'Gamma Risk',
      value: fmtAbsDecimal(totals.gammaSharesPerDollar, 1),
      status: portfolioGammaLabel(totals.gammaSharesPerDollar),
      drivers: gammaDrivers,
      color: portfolioGammaColor(totals.gammaSharesPerDollar, th.text),
      title: totals.gammaRaw != null
        ? `Gamma: ${totals.gammaSharesPerDollar?.toFixed(1)} share-equivalent per $1 underlying move · raw ${totals.gammaRaw.toFixed(4)} · ${portfolioGammaLabel(totals.gammaSharesPerDollar)}`
        : undefined,
    },
    {
      greek: 'V',
      label: 'Volatility',
      value: fmtSignedMoneyWhole(totals.vegaPerIvPoint, '/pt'),
      status: portfolioVegaLabel(totals.vegaPerIvPoint),
      drivers: vegaDrivers,
      color: portfolioVegaColor(totals.vegaPerIvPoint, th.text),
      title: totals.vegaRaw != null
        ? `Vega: $${totals.vegaPerIvPoint?.toFixed(0)} per IV point · raw ${totals.vegaRaw.toFixed(4)} · ${portfolioVegaLabel(totals.vegaPerIvPoint)}`
        : undefined,
    },
  ];

  return (
    <div className={`border ${th.border} ${th.card} rounded-lg overflow-hidden`}> 
      <div className={`px-4 py-2 border-b ${th.border} flex items-center justify-between`}> 
        <p className={`text-[10px] ${th.textFaint} uppercase tracking-widest font-bold`}>
          Portfolio Greeks <span className="normal-case tracking-normal font-medium">({positions.length} position{positions.length !== 1 ? 's' : ''})</span>
        </p>
        <p className={`text-[10px] ${th.textFaint}`}>status line shows healthy zone</p>
      </div>

      <div className="grid grid-cols-4">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className={`px-4 py-3 ${i < cards.length - 1 ? `border-r ${th.border}` : ''}`}
            title={card.title}
          >
            <div className="flex items-baseline gap-2">
              <span className={`text-[10px] ${th.textFaint} font-bold uppercase tracking-wider`}>{card.label}</span>
              <span className={`text-[10px] ${th.textFaint} font-bold`}>{card.greek}</span>
            </div>
            <div className={`text-xl font-bold ${card.color} mt-0.5`} style={{ fontFamily: "'DM Mono', monospace" }}>
              {card.value}
            </div>
            <p className={`text-[11px] font-bold ${card.color} mt-1 truncate`}>
              {card.status}
            </p>
            <p className={`text-[10px] ${th.textFaint} mt-1 truncate`}>
              {card.drivers}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analysis Panel ─────────────────────────────────────────────────────────
const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: 'text-emerald-400', MEDIUM: 'text-yellow-400', LOW: 'text-orange-400',
};
const REC_COLOR: Record<string, string> = {
  HOLD: 'text-slate-400', WATCH: 'text-yellow-400', MANAGE: 'text-orange-400',
  TAKE_PROFIT: 'text-emerald-400', CUT_LOSSES: 'text-red-400',
  CLOSE: 'text-red-400', ROLL: 'text-purple-400',
};

// ── Chat Thread ────────────────────────────────────────────────────────────
// Reusable multi-turn chat component. Receives initial context as the first
// assistant message so the AI already "knows" the position or portfolio.

function ChatThread({ initialContext, systemPrompt, placeholder, th }: {
  initialContext: string;   // the analysis text shown as the first assistant message
  systemPrompt?: string;    // optional override — defaults to TRADING_SYSTEM_PROMPT
  placeholder?: string;
  th: typeof THEMES[Theme];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: initialContext },
  ]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Scroll within the chat container only — never move the page
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [meta, base64] = dataUrl.split(',');
      const mediaType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      setPendingImage({ base64, mediaType, preview: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const send = async () => {
    const text = input.trim();
    if (!text && !pendingImage || loading) return;
    setInput('');
    setError(null);
    const parts: ChatContentPart[] = [];
    if (pendingImage) parts.push({ type: 'image', source: { type: 'base64', media_type: pendingImage.mediaType, data: pendingImage.base64 } });
    if (text) parts.push({ type: 'text', text });
    const userMsg: ChatMessage = { role: 'user', content: parts.length === 1 && !pendingImage ? text : parts };
    setPendingImage(null);
    const next: ChatMessage[] = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    try {
      const reply = await callAIWithHistory(next, systemPrompt);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setError(e.message ?? 'Failed');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const getMessageText = (content: ChatMessage['content']): string => {
    if (typeof content === 'string') return content;
    return content.filter((p): p is ChatMessagePart => p.type === 'text').map(p => p.text).join(' ');
  };

  const getMessageImage = (content: ChatMessage['content']): string | null => {
    if (typeof content === 'string') return null;
    const img = content.find((p): p is ChatImagePart => p.type === 'image');
    return img ? `data:${img.source.media_type};base64,${img.source.data}` : null;
  };

  // Suggested follow-up prompts shown below the initial analysis
  const suggestions = [
    'What would make this go wrong fast?',
    'If I roll, what strikes should I target?',
    'Should I close early given current conditions?',
    'What\'s my max pain scenario here?',
  ];

  return (
    <div className={`border-t ${th.border} flex flex-col`} style={{ background: 'rgba(99,102,241,0.03)' }}>
      {/* Message history — skip the first assistant message, it's already shown above */}
      {messages.length > 1 && (
        <div ref={scrollContainerRef} className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
          {messages.slice(1).map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <span className="text-indigo-400 text-[10px] mt-1 shrink-0 font-bold">◈</span>
              )}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                m.role === 'user'
                  ? 'ac-bg-20 border ac-border/30 text-blue-100 ml-auto'
                  : `${th.card} border ${th.border} ${th.textMuted}`
              }`}>
                {(() => {
                  const imgSrc = getMessageImage(m.content);
                  const txt = getMessageText(m.content);
                  return (<>
                    {imgSrc && <img src={imgSrc} alt="attachment" className="rounded-lg max-w-full mb-1.5" style={{ maxHeight: '180px', objectFit: 'contain' }} />}
                    {txt && <span>{txt}</span>}
                  </>);
                })()}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 justify-start">
              <span className="text-indigo-400 text-[10px] mt-1 shrink-0 font-bold">◈</span>
              <div className={`${th.card} border ${th.border} rounded-xl px-3 py-2`}>
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          {error && (
            <p className="text-[10px] text-red-400 px-1">Error: {error} —
              <button onClick={() => { setError(null); send(); }} className="underline ml-1">retry</button>
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Suggestions — only shown before any user message */}
      {messages.length === 1 && (
        <div className="px-4 pt-3 pb-1 flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
              className={`text-[10px] px-2.5 py-1 rounded-full border ${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400 transition-colors`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 space-y-2">
        {/* Image preview */}
        {pendingImage && (
          <div className="relative inline-block">
            <img src={pendingImage.preview} alt="pending" className="rounded-lg max-h-24 object-contain border border-indigo-500/40" />
            <button onClick={() => setPendingImage(null)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-700 border border-slate-500 text-slate-300 text-[9px] flex items-center justify-center hover:bg-red-600 transition-colors">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          {/* Attach button */}
          <button onClick={() => fileInputRef.current?.click()} disabled={loading}
            title="Attach image"
            className={`shrink-0 w-8 h-8 rounded-xl border ${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400 disabled:opacity-40 flex items-center justify-center transition-colors`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder ?? 'Ask a follow-up question... (Enter to send, Shift+Enter for newline)'}
            rows={1}
            disabled={loading}
            className={`flex-1 resize-none text-[11px] px-3 py-2 rounded-xl border ${th.inputBorder} ${th.input} ${th.text} outline-none focus:border-indigo-500 transition-colors placeholder:${th.textFaint} disabled:opacity-50`}
            style={{ fontFamily: "'DM Sans', system-ui, sans-serif", minHeight: '36px', maxHeight: '120px' }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button onClick={send} disabled={loading || (!input.trim() && !pendingImage)}
            className="shrink-0 w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-colors text-sm">
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis, pos, th }: { analysis: PositionAnalysis; pos: Position; th: typeof THEMES[Theme] }) {
  // The first chat message is hidden from the UI, but sent to the AI on every follow-up.
  // It contains the actual position numbers so the chat answers do not become generic.
  const chatContext = buildPositionChatContext(pos, analysis);

  return (
    <div className={`border-t ${th.border}`} style={{ background: 'rgba(99,102,241,0.04)' }}>
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-indigo-400 tracking-widest font-bold uppercase">AI Analysis</span>
            <span className={`text-[10px] font-bold ${REC_COLOR[analysis.recommendation] ?? 'text-white'}`}>
              → {analysis.recommendation.replace('_', ' ')}
            </span>
            <span className={`text-[9px] font-bold ${CONFIDENCE_COLOR[analysis.confidence] ?? 'text-slate-400'}`}>
              {analysis.confidence} confidence
            </span>
            {analysis.deviatesFromRules && (
              <span className="text-[9px] px-2 py-0.5 rounded border border-yellow-600/50 text-yellow-400 font-bold">
                ⚡ Outside rules
              </span>
            )}
          </div>
          <span className={`text-[9px] ${th.textFaint}`}>{new Date(analysis.generatedAt).toLocaleTimeString()}</span>
        </div>

        <p className={`text-xs ${th.textMuted} leading-relaxed`}>{analysis.summary}</p>
        <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>{analysis.reasoning}</p>

        {analysis.deviatesFromRules && analysis.deviationNote && (
          <div className="flex items-start gap-2 p-2 rounded border border-yellow-600/30 bg-yellow-500/5">
            <span className="text-yellow-400 shrink-0 text-[10px] mt-0.5">⚡</span>
            <p className="text-[10px] text-yellow-300 leading-relaxed">{analysis.deviationNote}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {analysis.risks.length > 0 && (
            <div>
              <p className="text-[9px] text-red-400 uppercase tracking-widest mb-1.5 font-bold">Risks</p>
              <div className="space-y-1">
                {analysis.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-red-400 text-[9px] mt-0.5 shrink-0">▸</span>
                    <p className="text-[10px] text-red-300 leading-snug">{r}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analysis.catalysts.length > 0 && (
            <div>
              <p className="text-[9px] text-emerald-400 uppercase tracking-widest mb-1.5 font-bold">In your favor</p>
              <div className="space-y-1">
                {analysis.catalysts.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-emerald-400 text-[9px] mt-0.5 shrink-0">▸</span>
                    <p className="text-[10px] text-emerald-300 leading-snug">{c}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`flex items-center gap-2 pt-1`}>
          <span className="text-[9px] text-indigo-400 font-bold tracking-widest uppercase">◈ Ask a follow-up</span>
          <div className={`flex-1 h-px ${th.borderLight} border-t`} />
        </div>
      </div>

      <ChatThread
        initialContext={chatContext}
        systemPrompt={TRADING_CHAT_PROMPT}
        placeholder={`Ask about ${analysis.symbol}... e.g. "Should I roll to next month?"`}
        th={th}
      />
    </div>
  );
}

function PortfolioAnalysisPanel({ analysis, positions, onClose, th }: {
  analysis: PortfolioAnalysis; positions: Position[]; onClose: () => void; th: typeof THEMES[Theme];
}) {
  // Build rich initial context for portfolio chat
  const chatContext = [
    `I've analyzed your portfolio of ${positions.length} open positions.`,
    ``,
    analysis.summary,
    analysis.marketContext ? `\n**Market context:** ${analysis.marketContext}` : '',
    analysis.dominantRisk ? `\n**Dominant risk:** ${analysis.dominantRisk}` : '',
    analysis.priorityActions.length > 0 ? `\n**Priority actions:** ${analysis.priorityActions.map((a, i) => `${i+1}. ${a}`).join(' ')}` : '',
    analysis.topRisks.length > 0 ? `\n**Portfolio risks:** ${analysis.topRisks.join(' · ')}` : '',
    analysis.thetaYield ? `\n**Theta yield:** ${analysis.thetaYield}` : '',
    ``,
    `Positions: ${positions.map(p => `${p.symbol} ${p.strategy} (${p.dte}d, ${p.pnl != null ? ((p.pnl/p.creditReceived)*100).toFixed(0)+'% P&L' : 'no price'})`).join(', ')}`,
  ].filter(Boolean).join('\n');

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${th.border} shrink-0`}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 text-sm">◈</span>
              <h2 className={`text-sm font-bold ${th.text} tracking-wider`}>PORTFOLIO ANALYSIS</h2>
            </div>
            <p className={`text-[10px] ${th.textFaint} mt-0.5`}>Generated {new Date(analysis.generatedAt).toLocaleTimeString()}</p>
          </div>
          <button onClick={onClose} className={`text-xl ${th.textFaint} hover:${th.text}`}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Summary */}
            <div className={`p-4 rounded-xl border ${th.border}`} style={{ background: 'rgba(99,102,241,0.05)' }}>
              <p className={`text-xs ${th.textMuted} leading-relaxed`}>{analysis.summary}</p>
            </div>

            {/* Market context */}
            {analysis.marketContext && (
              <div>
                <p className="text-[9px] text-indigo-400 uppercase tracking-widest mb-2 font-bold">Market Context</p>
                <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>{analysis.marketContext}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              {analysis.priorityActions.length > 0 && (
                <div>
                  <p className="text-[9px] text-blue-400 uppercase tracking-widest mb-2 font-bold">Priority Actions</p>
                  <div className="space-y-2">
                    {analysis.priorityActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-blue-400 text-[10px] font-bold shrink-0 mt-0.5">{i + 1}.</span>
                        <p className={`text-[10px] ${th.textMuted} leading-snug`}>{a}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analysis.topRisks.length > 0 && (
                <div>
                  <p className="text-[9px] text-red-400 uppercase tracking-widest mb-2 font-bold">Portfolio Risks</p>
                  <div className="space-y-2">
                    {analysis.topRisks.map((r, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-red-400 text-[9px] shrink-0 mt-0.5">▸</span>
                        <p className="text-[10px] text-red-300 leading-snug">{r}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {analysis.dominantRisk && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                <span className="text-red-400 shrink-0 text-[10px] mt-0.5 font-bold">!</span>
                <div>
                  <p className="text-[9px] text-red-400 uppercase tracking-widest mb-1 font-bold">Dominant Risk</p>
                  <p className="text-[10px] text-red-300">{analysis.dominantRisk}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              {analysis.sectorConcentration.length > 0 && (
                <div>
                  <p className="text-[9px] text-yellow-400 uppercase tracking-widest mb-2 font-bold">Concentration Risk</p>
                  <div className="space-y-1">
                    {analysis.sectorConcentration.map((s, i) => (
                      <p key={i} className="text-[10px] text-yellow-300">▸ {s}</p>
                    ))}
                  </div>
                </div>
              )}
              {analysis.thetaYield && (
                <div>
                  <p className="text-[9px] text-emerald-400 uppercase tracking-widest mb-2 font-bold">Theta Yield</p>
                  <p className={`text-[10px] ${th.textMuted}`}>{analysis.thetaYield}</p>
                </div>
              )}
            </div>

            {/* Divider before chat */}
            <div className={`flex items-center gap-2 pt-1`}>
              <span className="text-[9px] text-indigo-400 font-bold tracking-widest uppercase">◈ Ask about your portfolio</span>
              <div className={`flex-1 h-px ${th.borderLight} border-t`} />
            </div>
          </div>

          <ChatThread
            initialContext={chatContext}
            systemPrompt={TRADING_CHAT_PROMPT}
            placeholder='Ask anything — e.g. "Which position should I close first if I need cash?" or "Am I too long tech?"'
            th={th}
          />
        </div>

        <div className={`px-6 py-4 border-t ${th.border} shrink-0`}>
          <button onClick={onClose} className={`w-full py-3 border ${th.border} ${th.textFaint} rounded-xl text-xs font-medium hover:border-white/30 transition-colors`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action Verdict Badge ───────────────────────────────────────────────────
const VERDICT_STYLE = {
  GO:      { border: 'border-emerald-500/60', bg: 'bg-emerald-500/8',  icon: '✓', iconColor: 'text-emerald-400', labelColor: 'text-emerald-300', label: 'GO' },
  CAUTION: { border: 'border-yellow-500/60',  bg: 'bg-yellow-500/8',   icon: '⚠', iconColor: 'text-yellow-400',  labelColor: 'text-yellow-300',  label: 'CAUTION' },
  STOP:    { border: 'border-red-500/60',     bg: 'bg-red-500/8',      icon: '✕', iconColor: 'text-red-400',     labelColor: 'text-red-300',     label: 'STOP' },
};

// Profit-capture scale for a closing order. The track runs from entry credit
// (left, 0% of max profit captured) to worthless (right, 100% captured). The
// live bid-ask band is drawn as a tinted zone; the draggable handle is the
// limit price and writes to limitOverrides via onChange. A price at or right of
// the bid-ask band is marketable now (green); a price well left of it is a
// patient target that waits for decay (amber).
function TakeProfitScale({
  creditPerContract, quote, limit, onChange, th,
}: {
  creditPerContract: number;
  quote: CloseQuote | null | undefined;
  limit: number;
  onChange: (price: number) => void;
  th: typeof THEMES[Theme];
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Scale: x = 0 at entry credit (left), x = 1 at worthless 0.00 (right).
  const span = Math.max(creditPerContract, 0.01);
  const toX = (price: number) => Math.min(1, Math.max(0, 1 - (price / span)));
  const toPrice = (x: number) => parseFloat((span * (1 - Math.min(1, Math.max(0, x)))).toFixed(2));
  const capturedPct = (price: number) =>
    Math.round(Math.min(100, Math.max(0, (1 - price / span) * 100)));

  const mid = quote?.netMid ?? null;
  const bid = quote?.netBid ?? null;
  const ask = quote?.netAsk ?? null;
  const targetPrice = parseFloat((span * 0.5).toFixed(2)); // 50% capture reference

  // A close fills when its limit is at or above the marketable (ask) side.
  const marketable = ask != null && limit >= ask - 0.001;

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    onChange(toPrice(x));
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent | TouchEvent) => {
      const cx = 'touches' in e ? e.touches[0]?.clientX : (e as MouseEvent).clientX;
      if (cx != null) setFromClientX(cx);
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const handleX = toX(limit);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[9px] uppercase tracking-wide ${th.textFaint}`}>Profit capture</span>
        <div className="flex items-center gap-2">
          {(() => {
            const pnlPc = parseFloat((span - limit).toFixed(2)); // per-contract P&L
            const isLoss = pnlPc < 0;
            return (
              <span className={`text-[10px] font-bold ${isLoss ? 'text-red-400' : (marketable ? 'text-emerald-400' : 'text-yellow-400')}`}
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                {capturedPct(limit)}% · ${limit.toFixed(2)} · {pnlPc >= 0 ? '+' : ''}${pnlPc.toFixed(2)}/ct
              </span>
            );
          })()}
          {ask != null && (
            <button
              type="button"
              onClick={() => onChange(parseFloat(Math.max(ask, 0.01).toFixed(2)))}
              className="text-[9px] px-2 py-0.5 rounded border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 font-bold whitespace-nowrap">
              Snap to fill
            </button>
          )}
        </div>
      </div>

      <div
        ref={trackRef}
        onMouseDown={e => { setDragging(true); setFromClientX(e.clientX); }}
        onTouchStart={e => { setDragging(true); const cx = e.touches[0]?.clientX; if (cx != null) setFromClientX(cx); }}
        className={`relative h-6 rounded cursor-pointer select-none border ${th.borderLight}`}
        style={{ background: 'linear-gradient(90deg, rgba(148,163,184,0.10), rgba(16,185,129,0.18))' }}
        title="Drag to set your close limit">

        {/* live bid-ask band (marketable zone) */}
        {bid != null && ask != null && (
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/20 border-x border-emerald-400/40"
            style={{ left: pct(toX(ask)), width: pct(Math.max(0, toX(bid) - toX(ask))) }}
            title={`Market: bid $${bid.toFixed(2)} / ask $${ask.toFixed(2)}`} />
        )}

        {/* 50% target marker */}
        <div className="absolute top-0 bottom-0 w-px bg-blue-400/70" style={{ left: pct(toX(targetPrice)) }}
             title={`50% target $${targetPrice.toFixed(2)}`} />

        {/* current mid marker */}
        {mid != null && (
          <div className="absolute top-0 bottom-0 w-px bg-slate-300/70" style={{ left: pct(toX(mid)) }}
               title={`Mid $${mid.toFixed(2)}`} />
        )}

        {/* draggable handle */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-7 rounded-sm border-2 ${marketable ? 'bg-emerald-400 border-emerald-200' : 'bg-yellow-400 border-yellow-200'} shadow`}
          style={{ left: pct(handleX) }} />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className={`text-[8px] ${th.textFaint}`}>entry ${span.toFixed(2)} · 0%</span>
        <span className={`text-[8px] ${th.textFaint}`}>
          {marketable ? 'fills now' : 'waits for decay'}
        </span>
        <span className={`text-[8px] ${th.textFaint}`}>$0.00 · 100%</span>
      </div>
    </div>
  );
}

function ActionVerdictBadge({ verdict, compact = false, th }: {
  verdict: ActionVerdict;
  compact?: boolean;
  th: typeof THEMES[Theme];
}) {
  const style = VERDICT_STYLE[verdict.verdict];
  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${style.border} ${style.bg}`}>
        <span className={`text-[10px] font-bold ${style.iconColor}`}>{style.icon}</span>
        <span className={`text-[10px] font-bold ${style.labelColor}`}>{style.label}</span>
        <span className={`text-[10px] ${th.textFaint} truncate max-w-[200px]`}>{verdict.headline}</span>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border ${style.border} p-4 space-y-2`} style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="flex items-center gap-2">
        <span className={`text-lg ${style.iconColor}`}>{style.icon}</span>
        <span className={`text-xs font-bold tracking-widest ${style.labelColor}`}>{style.label}</span>
        <span className={`text-[9px] font-bold ${verdict.confidence === 'HIGH' ? style.labelColor : 'text-slate-400'} ml-1`}>
          {verdict.confidence} CONFIDENCE
        </span>
      </div>
      <p className={`text-sm font-bold ${style.labelColor} leading-snug`}>{verdict.headline}</p>
      <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>{verdict.reasoning}</p>
    </div>
  );
}

// ── Extend Profit Button ───────────────────────────────────────────────────
// ── Extend Profit State Assessment ───────────────────────────────────────
// Evaluates whether conditions favor or warn against extending profit target
function assessExtendConditions(pos: Position): {
  signal: 'favorable' | 'neutral' | 'warning' | 'bad';
  reasons: string[];
  warnings: string[];
} {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // P&L check — most important
  const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : 0;
  if (pnlPct < 0) {
    warnings.push(`Position is at a loss (${pnlPct.toFixed(0)}%) — extending a losing position is rarely right`);
    score -= 3;
  } else if (pnlPct < 30) {
    warnings.push(`Only ${pnlPct.toFixed(0)}% profit captured — haven't hit standard target yet`);
    score -= 1;
  } else if (pnlPct >= 50) {
    reasons.push(`${pnlPct.toFixed(0)}% profit already captured — solid base to extend from`);
    score += 2;
  }

  // DTE check
  if (pos.dte < 21) {
    warnings.push(`${pos.dte} DTE — gamma risk is elevated, holding longer is dangerous`);
    score -= 3;
  } else if (pos.dte < 28) {
    warnings.push(`${pos.dte} DTE — getting close to gamma zone, extend only if trend is strong`);
    score -= 1;
  } else if (pos.dte >= 30) {
    reasons.push(`${pos.dte} DTE — plenty of time, gamma risk is low`);
    score += 1;
  }

  // IVR check
  if (pos.ivr != null && pos.ivr < 30) {
    warnings.push(`IVR ${pos.ivr} — below minimum threshold, edge is thin`);
    score -= 2;
  } else if (pos.ivr != null && pos.ivr >= 40) {
    reasons.push(`IVR ${pos.ivr} — elevated volatility means more premium to capture`);
    score += 1;
  }

  // Buffer check
  if (pos.buffer != null && pos.buffer < 5 && pos.dte > 14) {
    warnings.push(`Buffer only ${pos.buffer.toFixed(1)}% — thin cushion makes holding longer risky`);
    score -= 2;
  } else if (pos.buffer != null && pos.buffer >= 10) {
    reasons.push(`${pos.buffer.toFixed(1)}% buffer — strong cushion supports holding longer`);
    score += 1;
  }

  // Theta check
  if (pos.theta != null && pos.theta < 0.02) {
    warnings.push(`Theta only $${(pos.theta * 100).toFixed(2)}/d — slow decay, extra holding time has low reward`);
    score -= 1;
  } else if (pos.theta != null && pos.theta >= 0.05) {
    reasons.push(`Theta $${(pos.theta * 100).toFixed(2)}/d — strong decay working in your favor`);
    score += 1;
  }

  const signal = score >= 3 ? 'favorable' : score >= 0 ? 'neutral' : score >= -2 ? 'warning' : 'bad';
  return { signal, reasons, warnings };
}

function ExtendProfitButton({ pos, th }: { pos: Position; th: typeof THEMES[Theme] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [resultMsg, setResultMsg] = useState('');
  const [verdict, setVerdict] = useState<ActionVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [selectedPct, setSelectedPct] = useState<number | null>(null);

  if (!pos.hasGtc) return null;

  const currentTargetPct = pos.gtcOrderPrice != null && pos.creditReceived > 0
    ? Math.round((1 - pos.gtcOrderPrice / (pos.creditReceived / 100)) * 100)
    : Math.round(pos.profitTarget * 100);

  const options = [55, 60, 65, 70, 75, 80, 85, 90].filter(pct => pct > currentTargetPct);
  if (options.length === 0) return null;

  // Re-fetch the live GTC order ID if it wasn't captured at load time
  const resolveGtcOrderId = async (token: string): Promise<string | null> => {
    if (pos.gtcOrderId) return pos.gtcOrderId;
    const orders = await fetchGtcOrders(pos.accountNumber, token);
    const shortSymbol = pos.legs.find(l => l.direction === 'Short')?.symbol ?? '';
    const match = orders.find(o =>
      !isStopOrder(o) &&
      o.legs.some(l => normalizeOccSymbol(l.symbol) === normalizeOccSymbol(shortSymbol) && isBuyToCloseAction(l.action))
    );
    return match?.id ?? null;
  };

  const handleOpen = async () => {
    setOpen(true);
    setResult(null);
    setVerdict(null);
    setSelectedPct(null);
    // Fetch a general extend verdict immediately when dropdown opens
    setVerdictLoading(true);
    try {
      const v = await evaluateAction(pos, 'EXTEND_PROFIT', String(options[0]));
      setVerdict(v);
    } catch { /* verdict optional */ }
    finally { setVerdictLoading(false); }
  };

  const handleSelectPct = async (pct: number) => {
    setSelectedPct(pct);
    setVerdict(null);
    setVerdictLoading(true);
    try {
      const v = await evaluateAction(pos, 'EXTEND_PROFIT', String(pct));
      setVerdict(v);
    } catch { /* verdict optional */ }
    finally { setVerdictLoading(false); }
  };

  const extend = async (targetPct: number) => {
    setLoading(true);
    setResult(null);
    try {
      const token = await getAccessToken();
      const orderId = await resolveGtcOrderId(token);
      if (!orderId) {
        throw new Error('Could not find a working GTC order for this position. It may have already been filled or cancelled. Refresh positions and try again.');
      }
      const newPrice = parseFloat(((pos.creditReceived / 100) * (1 - targetPct / 100)).toFixed(2));
      await ttPatch(
        `/accounts/${pos.accountNumber}/orders/${orderId}`,
        token,
        { price: newPrice.toFixed(2), 'time-in-force': 'GTC' }
      );
      setResult('success');
      setResultMsg(`Target extended to ${targetPct}% — GTC updated to $${newPrice.toFixed(2)}`);
      setOpen(false);
    } catch (e: any) {
      setResult('error');
      setResultMsg(e.message ?? 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  const extendAssessment = assessExtendConditions(pos);
  const assessColor = extendAssessment.signal === 'favorable' ? 'border-emerald-600 text-emerald-400' :
                      extendAssessment.signal === 'neutral'   ? 'border-slate-600 text-slate-400' :
                      extendAssessment.signal === 'warning'   ? 'border-yellow-600 text-yellow-400' :
                                                                'border-red-700 text-red-400';

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : handleOpen(); }}
        className={`text-[9px] px-2.5 py-1 border rounded font-bold transition-colors ${
          result === 'success' ? 'border-emerald-600 text-emerald-400' :
          result === 'error'   ? 'border-red-600 text-red-400' :
          open ? 'ac-btn ac-bg-10' :
          assessColor
        }`}>
        {result === 'success' ? '✓ Extended' : result === 'error' ? '✕ Failed' : '↑ Extend Profit'}
      </button>

      {open && (
        <div className={`absolute bottom-full mb-2 left-0 z-30 ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-4 w-80`}
          onClick={e => e.stopPropagation()}>
          <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-2`}>
            Extend target — current: {currentTargetPct}%
          </p>

          {/* State assessment banner */}
          <div className={`mb-3 p-2.5 rounded-lg border text-[9px] leading-relaxed ${
            extendAssessment.signal === 'favorable' ? 'border-emerald-600/40 bg-emerald-500/5' :
            extendAssessment.signal === 'neutral'   ? 'border-slate-600/40 bg-slate-500/5' :
            extendAssessment.signal === 'warning'   ? 'border-yellow-600/40 bg-yellow-500/5' :
                                                      'border-red-600/40 bg-red-500/5'
          }`}>
            <p className={`font-bold mb-1 ${
              extendAssessment.signal === 'favorable' ? 'text-emerald-400' :
              extendAssessment.signal === 'neutral'   ? 'text-slate-400' :
              extendAssessment.signal === 'warning'   ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {extendAssessment.signal === 'favorable' ? '✓ Conditions favor extension' :
               extendAssessment.signal === 'neutral'   ? '◦ Neutral — proceed with caution' :
               extendAssessment.signal === 'warning'   ? '⚠ Conditions are marginal' :
               '✕ Conditions do not favor extension'}
            </p>
            {extendAssessment.warnings.map((w, i) => (
              <p key={i} className="text-red-300/80 mt-0.5">▸ {w}</p>
            ))}
            {extendAssessment.reasons.map((r, i) => (
              <p key={i} className="text-emerald-300/80 mt-0.5">▸ {r}</p>
            ))}
          </div>

          {/* Verdict */}
          {verdictLoading && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg border border-indigo-700/40 bg-indigo-500/5">
              <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className="text-[10px] text-indigo-400">Evaluating move...</p>
            </div>
          )}
          {verdict && !verdictLoading && (
            <div className="mb-3">
              <ActionVerdictBadge verdict={verdict} th={th} />
            </div>
          )}

          {/* Target options */}
          <div className="space-y-1">
            {options.map(pct => {
              const newPrice = ((pos.creditReceived / 100) * (1 - pct / 100)).toFixed(2);
              const isSelected = selectedPct === pct;
              const isStop = verdict?.verdict === 'STOP' && verdict.confidence === 'HIGH';
              return (
                <div key={pct} className="space-y-1">
                  <button
                    disabled={loading}
                    onClick={() => handleSelectPct(pct)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors text-[10px] font-bold ${
                      isSelected ? 'border-blue-500 bg-blue-500/15' : `${th.border} ac-hover-border hover:ac-bg-10`
                    } disabled:opacity-50`}>
                    <span className="text-blue-400">{pct}% profit target</span>
                    <span className={`${th.textFaint} font-normal`}>BTC @ ${newPrice}</span>
                  </button>
                  {/* Confirm button shown when selected */}
                  {isSelected && (
                    <div className="space-y-1 pl-2">
                      {isStop && (
                        <p className={`text-[9px] text-red-400 px-1`}>
                          AI says STOP — click confirm to override
                        </p>
                      )}
                      <button
                        disabled={loading}
                        onClick={() => extend(pct)}
                        className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                          isStop
                            ? 'bg-red-600/20 border border-red-600 text-red-400 hover:bg-red-600/40'
                            : 'ac-btn-solid text-white'
                        } disabled:opacity-50`}>
                        {loading ? 'Updating...' : isStop ? `Override & Extend to ${pct}%` : `Confirm — Extend to ${pct}%`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {result === 'error' && <p className="text-[9px] text-red-400 mt-2 whitespace-pre-line">{resultMsg}</p>}
          <button onClick={() => setOpen(false)} className={`w-full mt-3 text-[9px] ${th.textFaint} hover:${th.text} text-center`}>
            Cancel
          </button>
        </div>
      )}

      {result === 'success' && resultMsg && (
        <p className={`absolute bottom-full mb-1 left-0 text-[9px] text-emerald-400 whitespace-nowrap bg-black/80 px-2 py-1 rounded border border-emerald-700`}>
          {resultMsg}
        </p>
      )}
    </div>
  );
}

// ── Set / Update Stop Loss Button ─────────────────────────────────────────
// When a GTC profit-target order already exists on the position, TastyTrade
// rejects a second standalone stop order targeting the same legs. The correct
// approach is to:
//   1. Cancel the existing standalone GTC limit order
//   2. Re-submit both the profit target AND the stop together as an OCO
//      complex order via POST /accounts/{acct}/complex-orders
// If no existing GTC limit order exists, we submit the stop as a standalone
// order via POST /accounts/{acct}/orders.

async function ttDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? data?.['error-message'] ?? `DELETE ${path} failed (${res.status})`);
  }
}


function formatTastyTradeRejection(data: any): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  const add = (label: string, value: unknown) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text) return;
    const line = label ? `${label}: ${text}` : text;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  };

  const describeObject = (obj: any, fallbackLabel: string) => {
    if (!obj || typeof obj !== 'object') return false;
    const code = obj.code ?? obj.reason ?? obj.name ?? obj.type ?? obj.domain ?? obj.id ?? obj['error-code'] ?? obj['check-name'] ?? obj.check;
    const msg = obj.message ?? obj['error-message'] ?? obj.description ?? obj.detail ?? obj.details ?? obj.error ?? obj.result;
    const status = obj.status ?? obj.outcome ?? obj.passed;

    if (msg != null || code != null) {
      const label = code ? `${fallbackLabel} ${code}` : fallbackLabel;
      const suffix = status != null && status !== true ? ` (${String(status)})` : '';
      add(label, `${msg ?? 'failed'}${suffix}`);
      return true;
    }
    return false;
  };

  const walk = (obj: any, label = 'Check', depth = 0) => {
    if (obj == null || depth > 6) return;
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      add(label, obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => walk(item, `${label} ${idx + 1}`, depth + 1));
      return;
    }
    if (typeof obj !== 'object') return;

    describeObject(obj, label);

    const priorityKeys = [
      'errors', 'error', 'warnings', 'warning', 'preflight-checks', 'preflightChecks',
      'preflight_checks', 'preflight', 'checks', 'violations', 'rejections', 'messages'
    ];
    for (const key of priorityKeys) {
      if (obj[key] != null) walk(obj[key], key.replace(/[-_]/g, ' '), depth + 1);
    }

    for (const [key, val] of Object.entries(obj)) {
      if (priorityKeys.includes(key)) continue;
      if (val && typeof val === 'object') walk(val, key.replace(/[-_]/g, ' '), depth + 1);
    }
  };

  walk(data, 'Broker');

  if (lines.length === 0) {
    const fallback = JSON.stringify(data?.error ?? data ?? {}).slice(0, 1000);
    return fallback || 'Unknown broker rejection. Open the browser console for the raw response.';
  }

  return lines.slice(0, 12).join('\n');
}

async function ttPostComplex(path: string, token: string, body: unknown) {
  console.log('TT COMPLEX ORDER BODY:', JSON.stringify(body, null, 2));
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  const data = await res.json();
  console.log('TT COMPLEX ORDER RESPONSE:', JSON.stringify(data, null, 2));
  if (!res.ok) {
    const details = formatTastyTradeRejection(data);
    throw new Error(`Complex order rejected (${res.status}):\n${details}`);
  }
  return data;
}

// ── Stop/GTC AI suggestion ─────────────────────────────────────────────────
interface StopGtcSuggestion {
  gtcPrice: number;       // recommended profit-target BTC price
  gtcPct: number;         // what % of credit that represents
  stopPrice: number;      // recommended stop trigger price
  stopMultiple: number;   // how many × credit that is
  rationale: string;      // 2-3 sentence explanation
  gtcRationale: string;   // why this GTC level specifically
  stopRationale: string;  // why this stop level specifically
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  deviatesFromRules: boolean;
  deviationNote: string | null;
}

const STOP_GTC_SYSTEM_PROMPT = `You are an expert options trader specializing in credit spreads using the Options Hunter methodology. Your job is to recommend optimal GTC profit-target and stop-loss prices for an open spread position.

CRITICAL RULE — STOP MUST BE ABOVE CURRENT SPREAD VALUE:
The stop trigger price MUST be strictly above the current spread value (buyback cost). A stop at or below the current value would execute immediately and be rejected by the broker. This is a hard constraint — never violate it.

CRITICAL RULE — GTC MUST BE BELOW CURRENT SPREAD VALUE:
The GTC profit-target price MUST be strictly below the current spread value. A GTC at or above current value would execute immediately. This is a hard constraint — never violate it.

STOP LOSS PHILOSOPHY — ANCHOR TO CURRENT VALUE, NOT ORIGINAL CREDIT:
The "2× original credit" rule is an ENTRY rule designed for when you first open the position. Once significant profit has been captured, it becomes meaningless and dangerous — a position at 80% profit with a 2× credit stop has virtually no protection.

CORRECT APPROACH: Anchor the stop to the CURRENT spread value, not original credit.
- Ask: "How much of my captured profit am I willing to give back before stopping out?"
- A position at 50%+ profit captured: stop should be set to protect most of that gain — typically current value × 2.0 to 3.0 (allowing the spread to double or triple from here before stopping)
- A position at 20-40% profit: more room needed — current value × 2.5 to 4.0
- A position at 0-20% profit or a loss: tighter protection — current value × 1.5 to 2.5

ADDITIONAL STOP ADJUSTMENTS (on top of current-value anchor):
- Buffer < 2%: tighten aggressively — near breach, use current value × 1.5 to 2.0
- Buffer < 5% AND DTE > 21: tighten — position needs protection, use current value × 1.5 to 2.5
- Buffer < 5% AND DTE < 14: less urgent — theta working hard, normal stop is fine
- Buffer > 15%: can use current value × 3.0 to 4.0 — stock has room to move
- DTE < 21: position should be closing anyway — note this and set tight stop
- DTE > 35: more time = more room for noise — slightly looser stop acceptable
- High IVR (>60): spreads swing more on normal days — use current value × 2.5 minimum to avoid noise triggers
- Low IVR (<30): IV collapsing, edge gone — tighter stop appropriate, current value × 1.5 to 2.0
- Earnings within expiry: binary event risk — tighten significantly, current value × 1.5
- Trend against strategy: thesis may be broken — tighten to current value × 1.5 to 2.0

GTC PROFIT TARGET:
- Standard: 50% of original credit received
- Tighten to 40% if: DTE < 25, buffer < 5%, earnings approaching, or significant profit already captured (>60%) and you want to lock it in
- Loosen to 60-65% if: DTE > 35, trend strongly confirms, IVR elevated with more premium to capture
- The GTC price = credit_per_contract × (1 - target_pct/100). MUST be below current spread value.

OUTPUT FORMAT — JSON only, nothing else:
{
  "gtcPrice": <number: BTC limit price, MUST be below current spread value>,
  "gtcPct": <number: percentage of credit this represents, e.g. 50>,
  "stopPrice": <number: stop trigger price, MUST be above current spread value>,
  "stopMultiple": <number: how many times the CURRENT spread value this represents — NOT original credit>,
  "rationale": "<2-3 sentence overall rationale — reference actual numbers from the position>",
  "gtcRationale": "<1-2 sentences specifically about the GTC choice>",
  "stopRationale": "<1-2 sentences specifically about the stop — reference current spread value, not original credit>",
  "confidence": "HIGH|MEDIUM|LOW",
  "deviatesFromRules": true|false,
  "deviationNote": null or "<explanation if deviating from standard rules>"
}`;

function buildStopGtcPrompt(pos: Position): string {
  const creditPerContract = pos.creditReceived / 100;
  const qty = pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1;
  const currentValuePerContract = pos.currentValue != null ? pos.currentValue / (qty * 100) : null;
  const pnlPct = pos.pnl != null && pos.creditReceived > 0
    ? ((pos.pnl / pos.creditReceived) * 100).toFixed(1) : 'unknown';
  const profitCaptured = currentValuePerContract != null
    ? parseFloat(((1 - currentValuePerContract / creditPerContract) * 100).toFixed(1))
    : null;
  const currentGtcPct = pos.gtcOrderPrice != null
    ? Math.round((1 - pos.gtcOrderPrice / creditPerContract) * 100)
    : Math.round(pos.profitTarget * 100);

  const gtcMax  = currentValuePerContract != null ? (currentValuePerContract - 0.01).toFixed(2) : 'N/A';
  const stopMin = currentValuePerContract != null ? (currentValuePerContract + 0.01).toFixed(2) : 'N/A';
  const stopMax = (creditPerContract * 3.0).toFixed(2);

  return `Recommend optimal GTC profit-target and stop-loss prices for this position.

HARD PRICE CONSTRAINTS (broker rejects violations):
Current spread value (live): ${currentValuePerContract?.toFixed(2) ?? 'unknown'}/contract
GTC MUST be below: ${gtcMax} (below current spread value)
Stop MUST be between: ${stopMin} and ${stopMax} (above current value, below 3x original credit)

POSITION: ${pos.symbol} ${pos.strategy}
Expiry: ${pos.expDate} | DTE: ${pos.dte} | Entry DTE: ${pos.entryDte}
Strikes: ${pos.legs.map(l => l.direction + ' ' + l.strikePrice + l.optionType).join(', ')}

CREDIT AND P&L:
Original credit: ${creditPerContract.toFixed(2)}/contract (${pos.creditReceived.toFixed(2)} total)
Current spread value: ${currentValuePerContract?.toFixed(2) ?? 'unknown'}/contract
Profit captured: ${profitCaptured != null ? profitCaptured + '%' : pnlPct + '%'} of original credit
P&L dollars: ${pos.pnl?.toFixed(2) ?? 'unknown'}
${profitCaptured != null && profitCaptured > 50 ? 'WARNING: ' + profitCaptured + '% profit already captured. Stop must protect this gain — anchor to current spread value, NOT original credit. A stop at 2x original credit is meaningless here.' : ''}

MARKET DATA:
Stock price: ${pos.stockPrice?.toFixed(2) ?? 'unknown'}
Buffer to short strike: ${pos.buffer?.toFixed(1) ?? 'unknown'}%
OTM buffer at entry / first tracked: ${pos.otmAtEntry != null ? `${pos.otmAtEntry.toFixed(1)}%` : 'unknown'}
DTE entry/now: ${pos.dteAtEntry ?? pos.entryDte ?? 'unknown'} → ${pos.dte}
IVR: ${pos.ivr ?? 'unknown'} | IV: ${pos.iv ?? 'unknown'}% | HV30: ${pos.hv30 ?? 'unknown'}%
Theta/d: ${pos.theta?.toFixed(4) ?? 'unknown'} | Gamma: ${pos.gamma?.toFixed(4) ?? 'unknown'}
Earnings within expiry: ${isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? 'YES — ' + pos.earningsDate : 'None'}

CURRENT ORDERS:
GTC profit-target: ${pos.hasGtc ? 'Yes — at $' + (pos.gtcOrderPrice?.toFixed(2) ?? '?') + '/contract (' + currentGtcPct + '% profit)' : 'None set'}
Stop loss: ${pos.stopLossStatus}${pos.stopLossPrice ? ' @ $' + pos.stopLossPrice.toFixed(2) + '/contract' : ''}

FLAGS: ${[
  pos.needsClose ? 'AT 21 DTE — closing soon anyway (standard entry)' : '',
  pos.entryDte <= 21 ? `SHORT-DATED ENTRY (entered at ${pos.entryDte} DTE, now ${pos.dte} DTE — set tight stop, lower GTC target to 30-40%)` : '',
  pos.buffer != null && pos.buffer < 2 ? 'CRITICAL buffer ' + pos.buffer.toFixed(1) + '% at ' + pos.dte + ' DTE — near breach' : pos.buffer != null && pos.buffer < 3 && pos.dte > 14 ? 'TIGHT buffer ' + pos.buffer.toFixed(1) + '% at ' + pos.dte + ' DTE' : pos.buffer != null && pos.buffer < 5 && pos.dte > 30 ? 'WATCH buffer ' + pos.buffer.toFixed(1) + '% at ' + pos.dte + ' DTE' : '',
  isUpcomingEarningsRisk(pos.earningsDate, pos.expDate) ? 'EARNINGS ' + pos.earningsDate : '',
  (pos.ivr ?? 0) < 30 ? 'IVR BELOW 30 — edge thin' : '',
  (pos.ivr ?? 0) > 70 ? 'IVR ABOVE 70 — elevated volatility' : '',
  profitCaptured != null && profitCaptured > 70 ? profitCaptured + '% PROFIT CAPTURED — stop must protect gains, anchor to current value' : '',
].filter(Boolean).join(' | ') || 'None'}

IMPORTANT: stopMultiple in your response should be relative to the CURRENT spread value (${currentValuePerContract?.toFixed(2) ?? '?'}), not original credit. Respond as JSON only.`;
}
async function fetchStopGtcSuggestion(pos: Position): Promise<StopGtcSuggestion> {
  const prompt = buildStopGtcPrompt(pos);
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'analysis',
      max_tokens: 500,
      system: STOP_GTC_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  const data = await res.json();
  const text = (data?.content?.find((b: any) => b.type === 'text')?.text ?? '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text) as StopGtcSuggestion;
}

function SetStopLossButton({ pos, th }: { pos: Position; th: typeof THEMES[Theme] }) {
  // ── Price bounds ──────────────────────────────────────────────────────────
  // All valid GTC and stop prices must respect these hard bounds derived from
  // live spread value and credit received. These are enforced everywhere:
  // AI suggestion prompt, input validation, and pre-submit preflight.
  //
  // GTC (profit target BTC price):
  //   MUST be below current spread value — otherwise executes immediately.
  //   Minimum meaningful target: 10% of credit (anything less = take profit now).
  //   Maximum: current spread value - $0.01
  //
  // Stop trigger:
  //   MUST be above current spread value — otherwise executes immediately.
  //   Maximum reasonable stop: 3× credit per contract (beyond that = max loss anyway).
  //   Minimum: current spread value + $0.01

  const creditPerContract = pos.creditReceived / 100;
  const qty = pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1;
  // currentValue from pos is total across all contracts × 100
  // Per-contract spread value = currentValue / (qty * 100)
  const liveValuePerContract = pos.currentValue != null
    ? pos.currentValue / (qty * 100)
    : null;

  // Hard bounds
  const gtcMin  = parseFloat((creditPerContract * 0.05).toFixed(2));            // 5% profit floor
  const gtcMax  = liveValuePerContract != null
    ? parseFloat((liveValuePerContract - 0.01).toFixed(2))
    : parseFloat((creditPerContract * 0.90).toFixed(2));                        // fallback: 10% profit
  const stopMin = liveValuePerContract != null
    ? parseFloat((liveValuePerContract + 0.01).toFixed(2))
    : parseFloat((creditPerContract * 1.50).toFixed(2));                        // fallback: 1.5× credit
  const stopMax = parseFloat((creditPerContract * 3.0).toFixed(2));             // 3× credit hard ceiling

  // ── State ─────────────────────────────────────────────────────────────────
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase]     = useState('');
  const [result, setResult]   = useState<'success' | 'error' | null>(null);
  const [resultMsg, setResultMsg] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [gtcPrice,  setGtcPrice]  = useState('');

  // AI suggestion
  const [suggestion, setSuggestion]           = useState<StopGtcSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError]   = useState<string | null>(null);

  // Live price fetch state
  const [livePrice, setLivePrice]         = useState<number | null>(null);  // per-contract
  const [livePriceLoading, setLivePriceLoading] = useState(false);
  const [livePriceError, setLivePriceError]   = useState<string | null>(null);

  // Confirmation step before destructive OCO replace
  const [confirming, setConfirming] = useState(false);

  // Mounted guard — prevents state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const needsOco = pos.hasGtc && !!pos.gtcOrderId;
  const existingGtcPrice = pos.gtcOrderPrice
    ?? parseFloat((creditPerContract * (1 - pos.profitTarget)).toFixed(2));

  // ── Validation helpers ────────────────────────────────────────────────────
  const effectiveLive = livePrice ?? liveValuePerContract;  // prefer freshly fetched

  function validateGtc(val: number): string | null {
    if (isNaN(val) || val <= 0) return 'Enter a valid GTC price';
    if (val < gtcMin) return `GTC $${val.toFixed(2)} is too low — minimum is $${gtcMin.toFixed(2)} (5% profit)`;
    if (effectiveLive != null && val >= effectiveLive)
      return `GTC $${val.toFixed(2)} ≥ current spread value $${effectiveLive.toFixed(2)} — would execute immediately. Lower it or use Take Profit.`;
    return null;
  }

  function validateStop(val: number): string | null {
    if (isNaN(val) || val <= 0) return 'Enter a valid stop price';
    if (effectiveLive != null && val <= effectiveLive)
      return `Stop $${val.toFixed(2)} ≤ current spread value $${effectiveLive.toFixed(2)} — would execute immediately. Raise it.`;
    if (val > stopMax)
      return `Stop $${val.toFixed(2)} exceeds 3× credit ($${stopMax.toFixed(2)}) — beyond max loss, no protection value.`;
    return null;
  }

  const gtcError  = needsOco ? validateGtc(parseFloat(gtcPrice || '0'))  : null;
  const stopError = validateStop(parseFloat(stopPrice || '0'));
  const hasErrors = !!stopError || (needsOco && !!gtcError);

  // ── Live price fetch ──────────────────────────────────────────────────────
  const fetchLivePrice = async () => {
    if (!mountedRef.current) return;
    setLivePriceLoading(true);
    setLivePriceError(null);
    try {
      const token = await getAccessToken();
      const fresh = await fetchFreshPositionPrice(pos, token);
      if (!mountedRef.current) return;
      if (fresh != null) {
        const perContract = fresh / (qty * 100);
        setLivePrice(perContract);
        console.log(`LIVE PRICE FETCH ${pos.symbol}: $${perContract.toFixed(4)}/contract (total $${fresh.toFixed(2)})`);
      } else {
        setLivePriceError('Could not fetch live price — using last known value');
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setLivePriceError(`Price fetch failed: ${e.message}`);
    } finally {
      if (mountedRef.current) setLivePriceLoading(false);
    }
  };

  // ── AI suggestion ─────────────────────────────────────────────────────────
  const fetchSuggestion = async () => {
    if (!mountedRef.current) return;
    setSuggestionLoading(true);
    setSuggestionError(null);
    try {
      const s = await fetchStopGtcSuggestion(pos);
      if (!mountedRef.current) return;

      // Clamp AI suggestion to hard bounds before showing
      const clampedGtc  = Math.min(Math.max(s.gtcPrice,  gtcMin),  gtcMax);
      const clampedStop = Math.min(Math.max(s.stopPrice, stopMin), stopMax);

      // If live price is known, enforce directional constraint
      const live = livePrice ?? liveValuePerContract;
      const safeGtc  = live != null ? Math.min(clampedGtc,  live - 0.01) : clampedGtc;
      const safeStop = live != null ? Math.max(clampedStop, live + 0.01) : clampedStop;

      if (!mountedRef.current) return;
      setSuggestion({
        ...s,
        gtcPrice:  parseFloat(safeGtc.toFixed(2)),
        stopPrice: parseFloat(safeStop.toFixed(2)),
        gtcPct:    Math.round((1 - safeGtc / creditPerContract) * 100),
        stopMultiple: parseFloat((safeStop / creditPerContract).toFixed(1)),
      });
      setGtcPrice(safeGtc.toFixed(2));
      setStopPrice(safeStop.toFixed(2));
    } catch (e: any) {
      if (!mountedRef.current) return;
      setSuggestionError(e.message ?? 'AI suggestion failed');
    } finally {
      if (mountedRef.current) setSuggestionLoading(false);
    }
  };

  // ── Open handler ──────────────────────────────────────────────────────────
  const handleOpen = async () => {
    setOpen(true);
    setResult(null);
    setPhase('');
    setSuggestion(null);
    setSuggestionError(null);
    setConfirming(false);
    setLivePrice(null);
    setLivePriceError(null);

    // Step 1: fetch live price first so bounds are accurate
    setLivePriceLoading(true);
    try {
      const token = await getAccessToken();
      if (!mountedRef.current) return;
      const fresh = await fetchFreshPositionPrice(pos, token);
      if (!mountedRef.current) return;
      if (fresh != null) {
        const perContract = fresh / (qty * 100);
        setLivePrice(perContract);
        console.log(`LIVE PRICE FETCH ${pos.symbol}: $${perContract.toFixed(4)}/contract`);
        // Set initial input defaults using live price
        const initGtc  = Math.min(existingGtcPrice, perContract - 0.01);
        const initStop = Math.max(perContract * 2.0,  perContract + 0.01);
        setGtcPrice(Math.max(initGtc, gtcMin).toFixed(2));
        setStopPrice(Math.min(initStop, stopMax).toFixed(2));
      } else {
        setLivePriceError('Could not fetch live price — using estimates');
        setGtcPrice(Math.max(existingGtcPrice, gtcMin).toFixed(2));
        const naiveStop = Math.max(creditPerContract * 2.0, stopMin);
        setStopPrice(Math.min(naiveStop, stopMax).toFixed(2));
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      // Keep modal open even on price fetch failure — show error, use fallback values
      console.warn('SetStopLossButton live price fetch failed:', e.message);
      setLivePriceError(`Price fetch failed: ${e.message ?? 'unknown error'}`);
      setGtcPrice(Math.max(existingGtcPrice, gtcMin).toFixed(2));
      setStopPrice(Math.min(creditPerContract * 2.0, stopMax).toFixed(2));
    } finally {
      if (mountedRef.current) setLivePriceLoading(false);
    }

    // Step 2: fetch AI suggestion (non-blocking, runs after live price)
    if (mountedRef.current) fetchSuggestion();
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setGtcPrice(suggestion.gtcPrice.toFixed(2));
    setStopPrice(suggestion.stopPrice.toFixed(2));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    const stopTrigger = parseFloat(stopPrice);
    const gtcLimit    = parseFloat(gtcPrice);
    let preflightContext = '';

    // Final pre-submit validation — fetch fresh price one more time
    setLoading(true);
    setPhase('Verifying live prices...');
    setResult(null);
    try {
      const token = await getAccessToken();

      // Re-fetch live price immediately before submit
      const freshTotal = await fetchFreshPositionPrice(pos, token);
      const freshPerContract = freshTotal != null ? freshTotal / (qty * 100) : null;
      if (freshPerContract != null) {
        console.log(`PRE-SUBMIT LIVE PRICE ${pos.symbol}: $${freshPerContract.toFixed(4)}/contract`);
        setLivePrice(freshPerContract);
        preflightContext = [
          `Symbol: ${pos.symbol} ${pos.strategy}`,
          `Action: ${needsOco ? 'Replace existing GTC with OCO profit + stop' : 'Place stop order'}`,
          `Live spread value: $${freshPerContract.toFixed(2)} debit`,
          needsOco ? `Profit GTC limit: $${gtcLimit.toFixed(2)} debit` : null,
          `Stop trigger: $${stopTrigger.toFixed(2)} debit`,
          `Original credit: $${creditPerContract.toFixed(2)} | Qty: ${qty}`,
        ].filter(Boolean).join('\n');

        // Hard stop: block if prices violate bounds against fresh price
        if (needsOco && gtcLimit >= freshPerContract) {
          setResult('error');
          setResultMsg(
            `GTC $${gtcLimit.toFixed(2)} ≥ live spread value $${freshPerContract.toFixed(2)}. ` +
            `Spread has moved — profit target already hit. Use Take Profit instead.`
          );
          return;
        }
        if (stopTrigger <= freshPerContract) {
          setResult('error');
          setResultMsg(
            `Stop $${stopTrigger.toFixed(2)} ≤ live spread value $${freshPerContract.toFixed(2)}. ` +
            `Spread has moved — stop would execute immediately. Raise the stop trigger.`
          );
          return;
        }
      }

      const itype = instrType(pos.symbol);
      const legs = pos.legs.map(leg => ({
        symbol: leg.symbol,
        quantity: leg.quantity,
        action: (leg.direction === 'Short' ? 'Buy to Close' : 'Sell to Close') as 'Buy to Close' | 'Sell to Close',
        'instrument-type': itype,
      }));

      if (needsOco) {
        setPhase('Cancelling existing GTC order...');
        console.log('CANCEL EXISTING GTC ORDER:', pos.gtcOrderId);
        // Cancel via complex order endpoint if this is part of an OCO
        const complexId = (pos as any).gtcComplexOrderId;
        console.log(`PLACE_GTC CANCEL: orderId=${pos.gtcOrderId} complexId=${complexId}`);

        // Preserve enough of the original order's shape to re-place it if the
        // replacement OCO fails to go in after cancellation succeeds. TastyTrade
        // has no atomic "replace" operation for resting orders — cancel and place
        // are always two separate calls — so this is the closest we can get to
        // not leaving a position genuinely unprotected on a partial failure.
        let cancelSucceeded = false;
        try {
          if (complexId) {
            console.log(`Cancelling complex order ${complexId}`);
            await ttDelete(`/accounts/${pos.accountNumber}/complex-orders/${complexId}`, token);
          } else {
            console.log(`Cancelling simple order ${pos.gtcOrderId}`);
            await ttDelete(`/accounts/${pos.accountNumber}/orders/${pos.gtcOrderId}`, token);
          }
          cancelSucceeded = true;
        } catch (cancelErr: any) {
          // Cancellation itself failed — old order is still live and still protecting
          // the position, so this is a normal (non-urgent) failure, not a gap.
          throw new Error(`Could not cancel existing GTC order: ${cancelErr.message ?? 'unknown error'}. Existing protection is unchanged — nothing was replaced.`);
        }

        console.log(`Cancel complete, waiting 500ms...`);
        await new Promise(r => setTimeout(r, 500));

        setPhase('Placing OCO order...');
        const ocoBody = {
          type: 'OCO',
          orders: [
            {
              'order-type': 'Limit',
              'time-in-force': 'GTC',
              price: Math.max(gtcLimit, 0.01).toFixed(2),
              'price-effect': 'Debit',
              legs,
            },
            {
              'order-type': 'Stop Limit',
              'time-in-force': 'GTC',
              'stop-trigger': Math.max(stopTrigger, 0.01).toFixed(2),
              price: Math.max(parseFloat((stopTrigger * 1.10).toFixed(2)), 0.01).toFixed(2),  // 10% above trigger for fill room
              'price-effect': 'Debit',
              legs,
            },
          ],
        };

        try {
          const res = await ttPostComplex(`/accounts/${pos.accountNumber}/complex-orders`, token, ocoBody);
          const orderId = String(res?.data?.['complex-order']?.id ?? res?.data?.id ?? 'submitted');
          setResult('success');
          setResultMsg(`OCO placed — profit @ $${gtcLimit.toFixed(2)} / stop @ $${stopTrigger.toFixed(2)} (ID #${orderId})`);
        } catch (placeErr: any) {
          // The old order is already cancelled and the new one failed to go in —
          // the position is genuinely unprotected right now. Attempt one automatic
          // recovery by re-placing the original order before reporting anything.
          if (!cancelSucceeded) throw placeErr;
          setPhase('OCO placement failed — restoring original order...');
          try {
            const restoreBody = {
              'order-type': 'Stop Limit',
              'time-in-force': 'GTC',
              'stop-trigger': Math.max(stopTrigger, 0.01).toFixed(2),
              price: Math.max(parseFloat((stopTrigger * 1.10).toFixed(2)), 0.01).toFixed(2),
              'price-effect': 'Debit',
              legs,
            };
            const restoreRes = await ttPost(`/accounts/${pos.accountNumber}/orders`, token, restoreBody);
            const restoreId = String(restoreRes?.data?.order?.id ?? restoreRes?.data?.id ?? 'submitted');
            setResult('error');
            setResultMsg(
              `OCO placement failed (${placeErr.message ?? 'unknown error'}). ` +
              `Original GTC was already cancelled, so a fallback stop was restored instead ` +
              `(ID #${restoreId}, trigger $${stopTrigger.toFixed(2)}) — your position has stop protection, ` +
              `but not the GTC profit target you configured. Retry to set up the full OCO again.`
            );
          } catch (restoreErr: any) {
            // Recovery itself failed — this is the one case where the position may
            // genuinely have no protective order at all. Make this unmistakable.
            setResult('error');
            setResultMsg(
              `⚠ UNPROTECTED POSITION — OCO placement failed (${placeErr.message ?? 'unknown error'}) ` +
              `AND the automatic fallback stop also failed (${restoreErr.message ?? 'unknown error'}). ` +
              `The original GTC order was already cancelled. ${pos.symbol} currently has no GTC or stop order ` +
              `protecting it. Place a new stop or GTC manually in TastyTrade right away.`
            );
          }
          return;
        }
      } else {
        setPhase('Placing stop order...');
        const stopBody = {
          'order-type': 'Stop Limit',
          'time-in-force': 'GTC',
          'stop-trigger': Math.max(stopTrigger, 0.01).toFixed(2),
          price: Math.max(parseFloat((stopTrigger * 1.10).toFixed(2)), 0.01).toFixed(2),
          'price-effect': 'Debit',
          legs,
        };
        const res = await ttPost(`/accounts/${pos.accountNumber}/orders`, token, stopBody);
        const orderId = String(res?.data?.order?.id ?? res?.data?.id ?? 'submitted');
        setResult('success');
        setResultMsg(`Stop Limit placed @ trigger $${stopTrigger.toFixed(2)} (ID #${orderId})`);
      }
      setOpen(false);
      setConfirming(false);
    } catch (e: any) {
      setResult('error');
      const baseMsg = e.message ?? 'Failed';
      setResultMsg(preflightContext ? `${baseMsg}\n\nOrder values checked:\n${preflightContext}` : baseMsg);
    } finally {
      setLoading(false);
      setPhase('');
    }
  };

  // ── Derived display values ────────────────────────────────────────────────
  const btnLabel =
    result === 'success' ? '✓ Stop Set'       :
    result === 'error'   ? '✕ Failed'          :
    pos.stopLossStatus === 'none'  ? '+ Set Stop'      :
    pos.stopLossStatus === 'loose' ? '⚠ Update Stop'   :
    '✎ Stop';

  const stopParsed  = parseFloat(stopPrice || '0');
  const gtcParsed   = parseFloat(gtcPrice  || '0');
  const stopMultipleDisplay = creditPerContract > 0 ? (stopParsed / creditPerContract).toFixed(1) : '—';
  const gtcPctDisplay       = creditPerContract > 0 ? Math.round((1 - gtcParsed / creditPerContract) * 100) : 0;
  const effectiveLiveDisplay = livePrice ?? liveValuePerContract;

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : handleOpen(); }}
        className={`text-[9px] px-2.5 py-1 border rounded font-bold transition-colors ${
          result === 'success' ? 'border-emerald-600 text-emerald-400' :
          result === 'error'   ? 'border-red-600 text-red-400' :
          open ? 'border-orange-500 text-orange-400 bg-orange-500/10' :
          pos.stopLossStatus === 'none'  ? 'border-red-700 text-red-400 hover:border-orange-500 hover:text-orange-400' :
          pos.stopLossStatus === 'loose' ? 'border-yellow-700 text-yellow-400 hover:border-orange-500 hover:text-orange-400' :
          'border-slate-600 text-slate-400 hover:border-orange-500 hover:text-orange-400'
        }`}>
        {btnLabel}
      </button>

      {open && (
        <div
          className={`absolute bottom-full mb-2 left-0 z-30 ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-4 w-96`}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest`}>
              {needsOco ? 'Set Stop Loss — OCO' : 'Set Stop Loss'}
            </p>
            <span className={`text-[9px] font-bold ${th.textFaint}`}>{pos.symbol} {pos.strategy}</span>
          </div>

          {/* Live price bar */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${th.borderLight} mb-3`}>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] ${th.textFaint} uppercase tracking-widest`}>Live spread value</span>
              {livePriceLoading && <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />}
              {!livePriceLoading && effectiveLiveDisplay != null && (
                <span className="text-[11px] font-bold text-blue-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${effectiveLiveDisplay.toFixed(2)}/contract
                </span>
              )}
              {!livePriceLoading && effectiveLiveDisplay == null && (
                <span className={`text-[10px] ${th.textFaint}`}>unavailable</span>
              )}
            </div>
            <button
              onClick={fetchLivePrice}
              disabled={livePriceLoading}
              className={`text-[9px] ${th.textFaint} ac-hover-text transition-colors disabled:opacity-40`}>
              ↻
            </button>
          </div>

          {livePriceError && (
            <p className="text-[9px] text-yellow-400 mb-2">⚠ {livePriceError}</p>
          )}

          {/* OCO info */}
          {needsOco && (
            <div className="mb-3 p-2.5 rounded-lg border border-yellow-600/40 bg-yellow-500/5">
              <p className="text-[10px] text-yellow-300 leading-relaxed">
                <span className="font-bold">⚠ Existing GTC (${existingGtcPrice.toFixed(2)}) will be cancelled</span> and replaced with an OCO pair. One fills → the other cancels.
              </p>
            </div>
          )}

          {/* AI Suggestion */}
          <div className={`mb-3 rounded-lg border ${th.borderLight} overflow-hidden`}>
            <div className={`flex items-center justify-between px-3 py-2 ${th.card}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-indigo-400 text-[10px]">◈</span>
                <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">AI Recommendation</span>
                {suggestion && <span className={`text-[9px] ${th.textFaint}`}>— within valid bounds</span>}
              </div>
              {!suggestionLoading && (
                <button onClick={fetchSuggestion} className={`text-[9px] ${th.textFaint} hover:text-indigo-400 transition-colors`}>
                  ↻ Refresh
                </button>
              )}
            </div>

            {suggestionLoading && (
              <div className="flex items-center gap-2 px-3 py-3">
                <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-[10px] text-indigo-400">Analyzing position...</p>
              </div>
            )}

            {suggestionError && !suggestionLoading && (
              <div className="px-3 py-2 flex items-center justify-between">
                <p className="text-[10px] text-red-400">{suggestionError}</p>
                <button onClick={fetchSuggestion} className="text-[9px] text-blue-400 hover:underline">Retry</button>
              </div>
            )}

            {suggestion && !suggestionLoading && (
              <div className="px-3 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded border border-emerald-700/40 bg-emerald-500/5">
                    <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest mb-0.5">GTC Target</p>
                    <p className="text-sm font-bold text-emerald-400" style={{ fontFamily: "'DM Mono', monospace" }}>${suggestion.gtcPrice.toFixed(2)}</p>
                    <p className={`text-[9px] ${th.textFaint}`}>{suggestion.gtcPct}% profit</p>
                  </div>
                  <div className="p-2 rounded border border-orange-700/40 bg-orange-500/5">
                    <p className="text-[9px] text-orange-400 font-bold uppercase tracking-widest mb-0.5">Stop Trigger</p>
                    <p className="text-sm font-bold text-orange-400" style={{ fontFamily: "'DM Mono', monospace" }}>${suggestion.stopPrice.toFixed(2)}</p>
                    <p className={`text-[9px] ${th.textFaint}`}>{suggestion.stopMultiple}× credit</p>
                  </div>
                </div>
                <p className={`text-[10px] ${th.textFaint} leading-relaxed`}>{suggestion.rationale}</p>
                {suggestion.gtcRationale && <p className="text-[9px] text-emerald-400/80"><span className="font-bold">GTC: </span>{suggestion.gtcRationale}</p>}
                {suggestion.stopRationale && <p className="text-[9px] text-orange-400/80"><span className="font-bold">Stop: </span>{suggestion.stopRationale}</p>}
                {suggestion.deviatesFromRules && suggestion.deviationNote && (
                  <p className="text-[9px] text-yellow-400">⚡ {suggestion.deviationNote}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className={`text-[9px] font-bold ${suggestion.confidence === 'HIGH' ? 'text-emerald-400' : suggestion.confidence === 'MEDIUM' ? 'text-yellow-400' : 'text-slate-400'}`}>
                    {suggestion.confidence} confidence
                  </span>
                  <button onClick={applySuggestion} className="text-[9px] px-2.5 py-1 border border-indigo-600 text-indigo-400 rounded hover:bg-indigo-600/20 transition-colors font-bold">
                    Use these values ↓
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Inputs */}
          <div className="space-y-2 mb-3">
            {needsOco && (
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${th.textFaint} w-28 shrink-0`}>GTC target $</span>
                  <input
                    type="number" min={gtcMin} max={gtcMax} step="0.01" value={gtcPrice}
                    onChange={e => setGtcPrice(e.target.value)}
                    className={`flex-1 text-[11px] px-2 py-1.5 rounded border ${
                      gtcError ? 'border-red-500' : th.inputBorder
                    } ${th.input} text-emerald-400 outline-none focus:border-emerald-500`}
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  />
                  {gtcPctDisplay > 0 && <span className={`text-[9px] ${th.textFaint} w-12 shrink-0`}>{gtcPctDisplay}%</span>}
                </div>
                {gtcError && <p className="text-[9px] text-red-400 mt-1 ml-28">{gtcError}</p>}
                {!gtcError && effectiveLiveDisplay != null && (
                  <p className={`text-[9px] ${th.textFaint} mt-0.5 ml-28`}>
                    valid range: ${gtcMin.toFixed(2)} – ${Math.min(gtcMax, effectiveLiveDisplay - 0.01).toFixed(2)}
                  </p>
                )}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${th.textFaint} w-28 shrink-0`}>Stop trigger $</span>
                <input
                  type="number" min={stopMin} max={stopMax} step="0.01" value={stopPrice}
                  onChange={e => setStopPrice(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !hasErrors && !confirming) setConfirming(true); if (e.key === 'Escape') setOpen(false); }}
                  autoFocus={!needsOco}
                  className={`flex-1 text-[11px] px-2 py-1.5 rounded border ${
                    stopError ? 'border-red-500' : th.inputBorder
                  } ${th.input} text-orange-400 outline-none focus:border-orange-500`}
                  style={{ fontFamily: "'DM Mono', monospace" }}
                />
                {stopParsed > 0 && <span className={`text-[9px] ${th.textFaint} w-12 shrink-0`}>{stopMultipleDisplay}×</span>}
              </div>
              {stopError && <p className="text-[9px] text-red-400 mt-1 ml-28">{stopError}</p>}
              {!stopError && effectiveLiveDisplay != null && (
                <p className={`text-[9px] ${th.textFaint} mt-0.5 ml-28`}>
                  valid range: ${Math.max(stopMin, effectiveLiveDisplay + 0.01).toFixed(2)} – ${stopMax.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* Confirmation step for OCO — destructive, show summary before committing */}
          {confirming && !hasErrors && (
            <div className="mb-3 p-3 rounded-lg border border-orange-600/50 bg-orange-500/5 space-y-2">
              <p className="text-[10px] text-orange-300 font-bold">Confirm order</p>
              {needsOco && (
                <p className="text-[10px] text-yellow-300">
                  1. Cancel existing GTC #{pos.gtcOrderId} (${existingGtcPrice.toFixed(2)})
                </p>
              )}
              <p className="text-[10px] text-orange-300">
                {needsOco ? '2.' : '1.'} Place {needsOco ? 'OCO' : 'Stop Limit GTC'}:
                {needsOco && ` profit target $${gtcParsed.toFixed(2)} (${gtcPctDisplay}%)`}
                {needsOco && ' /'} stop trigger ${stopParsed.toFixed(2)} ({stopMultipleDisplay}× credit)
              </p>
              {effectiveLiveDisplay != null && (
                <p className={`text-[9px] ${th.textFaint}`}>
                  Live spread: ${effectiveLiveDisplay.toFixed(2)} | Credit: ${creditPerContract.toFixed(2)} | Qty: {qty}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={submit}
                  disabled={loading}
                  className={`flex-1 py-2 text-white text-[10px] font-bold rounded-lg transition-colors disabled:opacity-50 ${
                    needsOco ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-orange-600 hover:bg-orange-500'
                  }`}>
                  {loading ? (phase || 'Submitting...') : 'Confirm & Submit'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                  className={`px-4 py-2 border ${th.border} ${th.textFaint} rounded-lg text-[10px] hover:border-white/30 transition-colors disabled:opacity-50`}>
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Primary action button — leads to confirm step, not direct submit */}
          {!confirming && (
            <button
              disabled={hasErrors || livePriceLoading}
              onClick={() => setConfirming(true)}
              className={`w-full py-2 text-white text-[10px] font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                needsOco ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-orange-600 hover:bg-orange-500'
              }`}>
              {livePriceLoading
                ? 'Fetching live price...'
                : hasErrors
                ? 'Fix errors above to continue'
                : needsOco
                ? `Review OCO — profit $${gtcParsed.toFixed(2)} / stop $${stopParsed.toFixed(2)}`
                : `Review Stop @ $${stopParsed.toFixed(2)}`}
            </button>
          )}

          {result === 'error' && <p className="text-[9px] text-red-400 mt-2 leading-relaxed whitespace-pre-line">{resultMsg}</p>}
          <button onClick={() => { setOpen(false); setConfirming(false); }} className={`w-full mt-2 text-[9px] ${th.textFaint} hover:${th.text} text-center`}>
            Cancel
          </button>
        </div>
      )}

      {result === 'success' && resultMsg && (
        <p className="absolute bottom-full mb-1 left-0 text-[9px] text-emerald-400 whitespace-nowrap bg-black/80 px-2 py-1 rounded border border-emerald-700 max-w-xs truncate" title={resultMsg}>
          {resultMsg}
        </p>
      )}
    </div>
  );
}
// ── Greek Value Display + Tint Helpers ─────────────────────────────────────
// These convert raw option Greeks into trader-readable values and color-code
// the risk/benefit for short-premium positions.

function fmtThetaDisplay(theta: number | null): string {
  if (theta == null) return '—';
  const dollarsPerDay = theta * 100;
  const sign = dollarsPerDay >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(dollarsPerDay).toFixed(0)}/d`;
}

function fmtDeltaDisplay(delta: number | null): string {
  if (delta == null) return '—';
  const pct = delta * 100;
  const sign = pct >= 0 ? '+' : '-';
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

function fmtGammaDisplay(gamma: number | null): string {
  if (gamma == null) return '—';
  return Math.abs(gamma).toFixed(3);
}

function fmtVegaDisplay(vega: number | null): string {
  if (vega == null) return '—';
  const sign = vega >= 0 ? '+' : '-';
  return `${sign}${Math.abs(vega).toFixed(2)}`;
}

function thetaTint(theta: number | null): string {
  if (theta == null) return '';
  if (theta >= 0.10) return 'bg-emerald-500/10 rounded px-1.5';
  if (theta >= 0.05) return 'bg-emerald-500/8 rounded px-1.5';
  if (theta >= 0.01) return 'bg-yellow-500/8 rounded px-1.5';
  if (theta < 0)     return 'bg-red-500/10 rounded px-1.5';
  return '';
}

function thetaTextColor(theta: number | null, fallback: string): string {
  if (theta == null) return fallback;
  if (theta >= 0.05) return 'text-emerald-400';
  if (theta >= 0.01) return 'text-yellow-400';
  return 'text-red-400';
}

function thetaLabel(theta: number | null): string {
  if (theta == null) return '';
  if (theta >= 0.10) return '★ Strong Decay';
  if (theta >= 0.05) return '✓ Good Decay';
  if (theta >= 0.01) return '~ Light Decay';
  return '✗ Paying Theta';
}

function deltaTint(delta: number | null): string {
  if (delta == null) return '';
  const abs = Math.abs(delta);
  if (abs <= 0.15) return 'bg-emerald-500/10 rounded px-1.5';
  if (abs <= 0.35) return 'bg-yellow-500/8 rounded px-1.5';
  if (abs <= 0.60) return 'bg-orange-500/10 rounded px-1.5';
  return 'bg-red-500/10 rounded px-1.5';
}

function deltaTextColor(delta: number | null, fallback: string): string {
  if (delta == null) return fallback;
  const abs = Math.abs(delta);
  if (abs <= 0.15) return 'text-emerald-400';
  if (abs <= 0.35) return 'text-yellow-400';
  if (abs <= 0.60) return 'text-orange-400';
  return 'text-red-400';
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return '';
  const abs = Math.abs(delta);
  if (abs <= 0.15) return '✓ Low Exposure';
  if (abs <= 0.35) return '~ Moderate';
  if (abs <= 0.60) return '⚠ Elevated';
  return '✗ High Exposure';
}

function gammaTint(gamma: number | null): string {
  if (gamma == null) return '';
  const abs = Math.abs(gamma);
  if (abs < 0.030) return 'bg-emerald-500/10 rounded px-1.5';
  if (abs < 0.080) return 'bg-yellow-500/8 rounded px-1.5';
  if (abs < 0.150) return 'bg-orange-500/10 rounded px-1.5';
  return 'bg-red-500/10 rounded px-1.5';
}

function gammaTextColor(gamma: number | null, fallback: string): string {
  if (gamma == null) return fallback;
  const abs = Math.abs(gamma);
  if (abs < 0.030) return 'text-emerald-400';
  if (abs < 0.080) return 'text-yellow-400';
  if (abs < 0.150) return 'text-orange-400';
  return 'text-red-400';
}

function gammaLabel(gamma: number | null): string {
  if (gamma == null) return '';
  const abs = Math.abs(gamma);
  if (abs < 0.030) return '✓ Low Gamma';
  if (abs < 0.080) return '~ Moderate';
  if (abs < 0.150) return '⚠ Elevated';
  return '✗ High Gamma';
}

function vegaTint(vega: number | null): string {
  if (vega == null) return '';
  const abs = Math.abs(vega);
  if (abs <= 0.30) return 'bg-emerald-500/10 rounded px-1.5';
  if (abs <= 0.75) return 'bg-yellow-500/8 rounded px-1.5';
  if (abs <= 1.50) return 'bg-orange-500/10 rounded px-1.5';
  return 'bg-red-500/10 rounded px-1.5';
}

function vegaTextColor(vega: number | null, fallback: string): string {
  if (vega == null) return fallback;
  const abs = Math.abs(vega);
  if (abs <= 0.30) return 'text-emerald-400';
  if (abs <= 0.75) return 'text-yellow-400';
  if (abs <= 1.50) return 'text-orange-400';
  return 'text-red-400';
}

function vegaLabel(vega: number | null): string {
  if (vega == null) return '';
  const abs = Math.abs(vega);
  if (abs <= 0.30) return '✓ Low Vol Risk';
  if (abs <= 0.75) return '~ Moderate Vol';
  if (abs <= 1.50) return '⚠ Elevated Vol';
  return '✗ High Vol Risk';
}

function premiumEdgeValue(iv: number | null, hv30: number | null): number | null {
  if (iv == null || hv30 == null) return null;
  return Math.round(iv - hv30);
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
const TRADING_DAYS = 252;

function netEdgeFrom(
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

function netEdgeLive(pos: Position): number | null {
  return netEdgeFrom(pos.theta, pos.gamma, pos.iv, pos.stockPrice);
}

// Net edge over this position's snapshot history, oldest-first, nulls dropped.
function netEdgeSeries(pos: Position): { date: string; value: number }[] {
  const hist = pos.snapshotHistory ?? [];
  const out: { date: string; value: number }[] = [];
  for (const s of hist) {
    const v = netEdgeFrom(s.theta, s.gamma, s.iv, s.stockPrice);
    if (v != null) out.push({ date: s.date, value: v });
  }
  return out;
}

// Peak net edge this position has ever reached (history + today's live value).
function netEdgePeak(pos: Position): number | null {
  const series = netEdgeSeries(pos).map(p => p.value);
  const live = netEdgeLive(pos);
  if (live != null) series.push(live);
  if (series.length === 0) return null;
  return Math.max(...series);
}

// Yesterday's (most recent prior snapshot) net edge, for the day-over-day delta.
function netEdgePrior(pos: Position): number | null {
  const series = netEdgeSeries(pos);
  if (series.length === 0) return null;
  return series[series.length - 1].value;
}

// Percent change today vs prior snapshot. null if no prior or prior ~ 0.
function netEdgeDayChangePct(pos: Position): number | null {
  const live = netEdgeLive(pos);
  const prior = netEdgePrior(pos);
  if (live == null || prior == null || Math.abs(prior) < 0.01) return null;
  return ((live - prior) / Math.abs(prior)) * 100;
}

// Net-edge color, keyed off this position's own peak (your approved bands):
//  - green  : within 15% of peak (at/near peak efficiency)
//  - amber  : fallen >15% off peak but still positive
//  - red    : at or below $0 (gamma winning)
function netEdgeColor(pos: Position, fallback: string): string {
  const live = netEdgeLive(pos);
  if (live == null) return fallback;
  if (live <= 0) return 'text-red-400';
  const peak = netEdgePeak(pos);
  if (peak == null || peak <= 0) return 'text-emerald-400';
  const offPeak = (live - peak) / peak; // <= 0
  if (offPeak >= -0.15) return 'text-emerald-400';
  return 'text-amber-400';
}

// Number of distinct days of snapshot history backing this position's peak.
// Low counts mean the peak is not yet trustworthy.
function netEdgeDaysTracked(pos: Position): number {
  return netEdgeSeries(pos).length;
}

// True the first time today's live edge prints below the prior peak-of-history,
// i.e. the position has rolled OVER from its peak — gamma starting to win.
// Requires at least 2 tracked days so a brand-new position can't false-trigger.
function netEdgeRolledOver(pos: Position): boolean {
  const series = netEdgeSeries(pos);
  if (series.length < 2) return false;
  const histPeak = Math.max(...series.map(s => s.value));
  const live = netEdgeLive(pos);
  if (live == null) return false;
  return live < histPeak;
}

function premiumEdgeColor(pos: Position, fallback: string): string {
  const edge = premiumEdgeValue(pos.iv, pos.hv30);

  if (edge != null) {
    if (edge >= 10) return 'text-emerald-400';
    if (edge >= 0) return 'text-yellow-400';
    return 'text-red-400';
  }

  return ivrTextColor(pos.ivr, fallback);
}

function premiumEdgeLabel(pos: Position): string {
  const edge = premiumEdgeValue(pos.iv, pos.hv30);

  if (edge != null) {
    if (edge >= 10) return '✓ Rich Premium';
    if (edge >= 0) return '~ Fair Premium';
    return '✗ Cheap Premium';
  }

  if (pos.ivr != null) return ivrLabel(pos.ivr);
  return 'No vol signal';
}

function premiumEdgeDisplay(pos: Position): string {
  const edge = premiumEdgeValue(pos.iv, pos.hv30);
  if (edge != null) return `${edge >= 0 ? '+' : ''}${edge}%`;
  if (pos.ivr != null) return `IVR ${pos.ivr}`;
  if (pos.iv != null) return `IV ${pos.iv}%`;
  return '—';
}

function ivrTextColor(ivr: number | null, fallback: string): string {
  if (ivr == null) return fallback;
  if (ivr < 20) return 'text-red-400';
  if (ivr < 40) return 'text-yellow-400';
  if (ivr <= 70) return 'text-emerald-400';
  return 'text-emerald-300';
}

function ivTextColor(iv: number | null, hv30: number | null, fallback: string): string {
  if (iv == null) return fallback;
  if (hv30 == null) return 'text-sky-400';

  const spread = iv - hv30;
  if (spread >= 10) return 'text-emerald-400';
  if (spread >= 0) return 'text-yellow-400';
  return 'text-red-400';
}

function ivHvLabel(iv: number | null, hv30: number | null): string {
  if (iv == null) return '';
  if (hv30 == null) return 'IV live';

  const spread = iv - hv30;
  if (spread >= 10) return '✓ Rich Premium';
  if (spread >= 0) return '~ Fair Premium';
  return '✗ IV < HV';
}

function fmtIvHv(iv: number | null, hv30: number | null): string {
  if (iv == null && hv30 == null) return '—';
  if (iv != null && hv30 != null) return `IV ${iv}% / HV ${hv30}%`;
  if (iv != null) return `IV ${iv}%`;
  return `HV ${hv30}%`;
}

function ivrLabel(ivr: number | null): string {
  if (ivr == null) return '';
  if (ivr < 20) return '✗ Poor Premium';
  if (ivr < 40) return '~ Fair Premium';
  if (ivr <= 70) return '✓ Good Premium';
  return '★ Excellent Premium';
}


function entrySnapshotAgeLabel(pos: Position): string {
  if (!pos.entrySnapshotCreatedAt) return 'entry snapshot not captured';
  const days = Math.max(0, Math.round((Date.now() - new Date(pos.entrySnapshotCreatedAt).getTime()) / 86400000));
  return days === 0 ? 'captured today' : `captured ${days}d ago`;
}

// ── Buffer Color Helpers ──────────────────────────────────────────────────
function bufferColor(buffer: number | null, dte: number): string {
  if (buffer == null) return 'text-[#808080]';

  // Breached or effectively at the short strike is the only true red condition.
  if (buffer <= 0) return 'text-red-400';

  // DTE-aware coloring: the same buffer is less dangerous with fewer days remaining.
  // Short-dated positions should warn, not panic, unless the strike is breached.
  if (dte <= 7) {
    if (buffer < 1) return 'text-orange-400';
    if (buffer < 2) return 'text-yellow-400';
    return 'text-emerald-400';
  }
  if (dte <= 21) {
    if (buffer < 1) return 'text-orange-400';
    if (buffer < 2) return 'text-yellow-400';
    if (buffer < 3) return 'text-yellow-400';
    return 'text-emerald-400';
  }
  if (dte <= 30) {
    if (buffer < 1) return 'text-red-400';
    if (buffer < 2) return 'text-orange-400';
    if (buffer < 3) return 'text-yellow-400';
    if (buffer < 5) return 'text-yellow-400';
    return 'text-emerald-400';
  }

  // Longer-dated positions need a wider cushion because there is more time to move.
  if (buffer < 1) return 'text-red-400';
  if (buffer < 2) return 'text-orange-400';
  if (buffer < 5) return 'text-yellow-400';
  return 'text-emerald-400';
}

// Highlights the active row in the tooltip table
function isBufferRow(buffer: number, label: string): boolean {
  if (label === '> 8%')  return buffer >= 8;
  if (label === '5-8%')  return buffer >= 5 && buffer < 8;
  if (label === '3-5%')  return buffer >= 3 && buffer < 5;
  if (label === '2-3%')  return buffer >= 2 && buffer < 3;
  if (label === '< 2%')  return buffer < 2;
  return false;
}

// Highlights the active DTE column in the tooltip table (col index 0-4)
function isDteCol(dte: number, col: number): boolean {
  if (col === 0) return dte > 30;
  if (col === 1) return dte >= 21 && dte <= 30;
  if (col === 2) return dte >= 14 && dte < 21;
  if (col === 3) return dte >= 7 && dte < 14;
  if (col === 4) return dte < 7;
  return false;
}

function PositionCard({ pos, th, checked, onToggle, onProfitTargetChange, onIntentChange, onExecute }: {
  pos: Position;
  th: typeof THEMES[Theme];
  checked: boolean;
  onToggle: (key: string) => void;
  onProfitTargetChange: (key: string, value: number) => void;
  onIntentChange: (key: string, intent: PositionIntent) => void;
  onExecute: (pos: Position, action: ActionType) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState(String(Math.round(pos.profitTarget * 100)));
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [sparkData, setSparkData] = useState(null as number[] | null);
  const [sparkLoading, setSparkLoading] = useState(false);
  const chartPopupRef = useRef(null as HTMLDivElement | null);
  const chartButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef(null as HTMLDivElement | null);
  const [chartPopupPos, setChartPopupPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    if (!showChart) return;
    const reposition = () => {
      if (!cardRef.current) return;
      const r = cardRef.current.getBoundingClientRect();
      const popupW = 280;
      let left = r.left;
      // keep within viewport horizontally
      left = Math.min(left, window.innerWidth - popupW - 8);
      left = Math.max(8, left);
      setChartPopupPos({ bottom: window.innerHeight - r.bottom, left });
    };
    reposition();
    const handler = (e: MouseEvent) => {
      if (
        chartPopupRef.current && !chartPopupRef.current.contains(e.target as Node) &&
        chartButtonRef.current && !chartButtonRef.current.contains(e.target as Node)
      ) {
        setShowChart(false);
      }
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [showChart]);

  const handleAnalyze = async () => {
    if (analysis) return; // already have it — button handles show/hide
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const result = await analyzePosition(pos, trend);
      setAnalysis(result);
      setShowAnalysis(true);
    } catch (e: any) {
      setAnalysisError(e.message ?? 'Analysis failed');
      setShowAnalysis(true);
    } finally {
      setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    const shortPutStrike = pos.legs.find(l => l.direction === 'Short' && l.optionType === 'P')?.strikePrice ?? null;
    getTrend(pos.symbol, shortPutStrike).then(t => setTrend(t)).catch(() => {});
  }, [pos.symbol, pos.legs]);

  const rec = getRecommendation(pos, trend);

  // ── 50%-target projection (theta-only, all-else-equal) ──
  // pos.theta is per-share net theta with contract qty ALREADY applied (see assembly).
  // $/d = pos.theta * 100. Do NOT multiply by qty again.
  const projection = (() => {
    if (pos.theta == null || pos.theta <= 0) return null;
    if (pos.currentValue == null) return null;
    const dailyDecay = pos.theta * 100;                 // $/d buyback erosion
    const distToTarget = pos.currentValue - pos.targetPrice; // $ left to fall
    if (distToTarget <= 0) {
      return { dailyDecay, status: 'hit' as const, dateLabel: null as string | null };
    }
    const rawDays = distToTarget / dailyDecay;
    const proj = new Date();
    proj.setDate(proj.getDate() + Math.round(rawDays));
    // 21-DTE management line
    const dte21 = new Date(`${pos.expDate}T00:00:00`);
    dte21.setDate(dte21.getDate() - 21);
    const fmt = (d: Date) => `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
    if (proj > dte21) {
      return { dailyDecay, status: 'unlikely' as const, dateLabel: fmt(dte21) };
    }
    return { dailyDecay, status: 'ontrack' as const, dateLabel: fmt(proj) };
  })();

  const shortPuts  = pos.legs.filter(l => l.optionType === 'P' && l.direction === 'Short');
  const longPuts   = pos.legs.filter(l => l.optionType === 'P' && l.direction === 'Long');
  const shortCalls = pos.legs.filter(l => l.optionType === 'C' && l.direction === 'Short');
  const longCalls  = pos.legs.filter(l => l.optionType === 'C' && l.direction === 'Long');

  const lifecycle = classifyPositionLifecycle(pos);

  const shortPut = shortPuts[0] ?? null;
  const cspStrike = shortPut?.strikePrice ?? null;
  const cspPremium = shortPut?.avgOpenPrice ?? pos.creditReceived ?? 0;
  const cspEffectiveBuyPrice = cspStrike != null ? cspStrike - cspPremium : null;
  const cspCashRequired = cspStrike != null ? cspStrike * 100 * lifecycle.contracts : null;
  const cspAssignmentBuffer =
    cspStrike != null && pos.stockPrice != null && pos.stockPrice > 0
      ? ((pos.stockPrice - cspStrike) / pos.stockPrice) * 100
      : null;

  const strikesSummary = () => {
    if (pos.strategy === 'BPS' && shortPuts[0] && longPuts[0]) return `${shortPuts[0].strikePrice}P / ${longPuts[0].strikePrice}P`;
    if (pos.strategy === 'BCS' && shortCalls[0] && longCalls[0]) return `${shortCalls[0].strikePrice}C / ${longCalls[0].strikePrice}C`;
    if (pos.strategy === 'IC') return `${shortPuts[0]?.strikePrice}P/${longPuts[0]?.strikePrice}P · ${shortCalls[0]?.strikePrice}C/${longCalls[0]?.strikePrice}C`;
    return pos.legs.map(l => `${l.strikePrice}${l.optionType}`).join(' / ');
  };

  const handleTargetSave = () => {
    const val = Math.min(100, Math.max(10, parseInt(targetInput) || 50)) / 100;
    setEditingTarget(false);
    onProfitTargetChange(pos.key, val);
  };

  const _bannerNetEdge = netEdgeLive(pos);
  const _reviewNotClose = pos.needsClose && _bannerNetEdge != null && _bannerNetEdge > 0;
  const borderClass = checked
    ? 'border-blue-500/60'
    : pos.needsClose ? (_reviewNotClose ? 'border-amber-500/60' : 'border-red-500/60')
    : pos.hitTarget ? 'border-emerald-500/60'
    : th.border;

  return (
    <div ref={cardRef} className={`border ${borderClass} ${th.card} rounded-lg transition-all`}>
      {pos.needsClose && (() => {
        // Net-edge-aware banner: past the 21-DTE rule, but if net edge is still
        // healthy and positive, this is a REVIEW (amber), not a CLOSE NOW (red).
        // Negative or unknown net edge keeps the red CLOSE NOW.
        const ne = netEdgeLive(pos);
        const healthy = ne != null && ne > 0;
        return healthy ? (
          <div className="bg-amber-500/10 border-b border-amber-500/40 px-4 py-1.5 flex items-center gap-2">
            <span className="text-amber-400 text-xs">⚠</span>
            <span className="text-xs text-amber-400 font-bold tracking-wider">REVIEW — {pos.dte} DTE · past 21-DTE rule, net edge still +${ne.toFixed(0)}/d</span>
          </div>
        ) : (
          <div className="bg-red-500/10 border-b border-red-500/40 px-4 py-1.5 flex items-center gap-2">
            <span className="text-red-400 text-xs">⚠</span>
            <span className="text-xs text-red-400 font-bold tracking-wider">CLOSE NOW — {pos.dte} DTE{ne != null ? ` · net edge ${ne >= 0 ? '+' : ''}$${ne.toFixed(0)}/d` : ''}</span>
          </div>
        );
      })()}
      {!pos.needsClose && isShortDateEntry(pos) && (
        <div className="bg-purple-500/10 border-b border-purple-500/30 px-4 py-1.5 flex items-center gap-2">
          <span className="text-purple-400 text-xs">⚡</span>
          <span className="text-xs text-purple-300 font-bold tracking-wider">SHORT-DATED ENTRY — {pos.entryDte}d at entry · {pos.dte} DTE left · maximize profit fast</span>
        </div>
      )}
      {pos.hitTarget && !pos.needsClose && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/40 px-4 py-1.5 flex items-center gap-2">
          <span className="text-emerald-400 text-xs">✓</span>
          <span className="text-xs text-emerald-400 font-bold tracking-wider">{Math.round(pos.profitTarget * 100)}% PROFIT TARGET HIT</span>
        </div>
      )}
      {!pos.needsClose && (() => {
        // CSP past the 21-DTE mark gets an intent-aware banner instead of CLOSE NOW.
        const puts = pos.legs.filter(l => l.optionType === 'P');
        const calls = pos.legs.filter(l => l.optionType === 'C');
        const isCsp = puts.some(l => l.direction === 'Short') && puts.filter(l => l.direction === 'Long').length === 0 && calls.length === 0;
        if (!isCsp || pos.dte > 21 || pos.entryDte <= 21) return null;
        if (pos.intent === 'acquisition') {
          return (
            <div className="bg-blue-500/10 border-b border-blue-500/30 px-4 py-1.5 flex items-center gap-2">
              <span className="text-blue-400 text-xs">◆</span>
              <span className="text-xs text-blue-300 font-bold tracking-wider">CSP · ACQUIRE — {pos.dte} DTE · assignment is the goal, not a close trigger</span>
            </div>
          );
        }
        return (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 flex items-center gap-2">
            <span className="text-amber-400 text-xs">⚠</span>
            <span className="text-xs text-amber-400 font-bold tracking-wider">CSP — {pos.dte} DTE · evaluate roll for premium or take assignment; not an auto-close</span>
          </div>
        );
      })()}

      <div className="flex items-stretch">
        {/* Checkbox */}
        <div className="flex items-center px-3 border-r border-inherit shrink-0 cursor-pointer" onClick={e => { e.stopPropagation(); onToggle(pos.key); }}>
          <input type="checkbox" checked={checked} onChange={() => onToggle(pos.key)}
            className="w-4 h-4 accent-blue-500 cursor-pointer" onClick={e => e.stopPropagation()} />
        </div>

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className={`px-3 flex items-center border-r ${th.borderLight} ${th.textFaint} hover:${th.textMuted} transition-colors shrink-0`}>
          <span className="text-[10px]">{expanded ? '▲' : '▼'}</span>
        </button>

        {/* Data columns */}
        <div className="overflow-x-auto flex-1" style={{ minWidth: 0 }}>
          <div className="grid px-4 py-3" style={{ gridTemplateColumns: '72px 120px 80px 70px 110px 80px 80px 90px 70px 50px 45px 45px 45px 55px 60px 120px 80px 90px 150px', gap: '0 12px', alignItems: 'start', minWidth: '1710px' }}>

            {/* ── POSITION ───────────────────────────── */}
            <div className="border-t-2 border-slate-600/60 pt-1">
              <p className={`font-bold ${th.text} text-sm leading-tight`} style={{ fontFamily: "'DM Mono', monospace" }}>{pos.symbol}</p>
              <span className={`text-[10px] px-1.5 py-0.5 border rounded font-bold ${stratColor(pos.strategy)}`}>{pos.strategy}</span>
              {/* Chart button */}
              <div className="relative mt-1">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (!showChart) {
                      setShowChart(true);
                      if (!sparkData) {
                        setSparkLoading(true);
                        const chartSymbol =
                        INDEX_CHART_SYMBOLS[pos.symbol.toUpperCase() as keyof typeof INDEX_CHART_SYMBOLS] ??
                        pos.symbol;
                      
                        fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`)
                          .then(r => r.json())
                          .then(d => {
                            const closes = (d?.bars ?? []).map((b: any) => b?.c).filter((v: any) => v != null).slice(-90);
                            setSparkData(closes);
                          })
                          .catch(() => setSparkData([]))
                          .finally(() => setSparkLoading(false));
                      }
                    } else { setShowChart(false); }
                  }}
                  ref={chartButtonRef}
                className={`inline-flex items-center gap-0.5 text-[9px] transition-colors ${showChart ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'}`}
                  title="Quick chart"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  <span className="tracking-wide">chart</span>
                </button>

                {showChart && (
                  <div
                    ref={chartPopupRef}
                    className={`fixed z-[9999] ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-3`}
                    style={{
                      width: '280px',
                      bottom: chartPopupPos ? `${chartPopupPos.bottom}px` : '0px',
                      left: chartPopupPos ? `${chartPopupPos.left}px` : '0px',
                      visibility: chartPopupPos ? 'visible' : 'hidden',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-bold ${th.textFaint} tracking-widest`}>{pos.symbol}</span>
                      <button onClick={() => setShowChart(false)} className="text-slate-500 hover:text-white transition-colors text-sm leading-none">✕</button>
                    </div>
                      {sparkLoading && (
                        <div className="flex items-center justify-center h-16">
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
                        const min = Math.min(...sparkData);
                        const max = Math.max(...sparkData);
                        const range = max - min || 1;
                        const w = 256, h = 56;
                        const pts = sparkData.map((v, i) => {
                          const x = (i / (sparkData.length - 1)) * w;
                          const y = h - ((v - min) / range) * h;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        }).join(' ');
                        const isUp = sparkData[sparkData.length - 1] >= sparkData[0];
                        const color = isUp ? '#10b981' : '#ef4444';
                        const lastPrice = sparkData[sparkData.length - 1];
                        const changePct = ((lastPrice - sparkData[0]) / sparkData[0] * 100).toFixed(1);
                        return (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-[10px] font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{pos.symbol}</span>
                              <span className="text-[10px] font-bold" style={{ color }}>
                                ${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span>
                              </span>
                            </div>
                            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '56px' }}>
                              <defs>
                                <linearGradient id={`grad-${pos.symbol}-${pos.key}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                                </linearGradient>
                              </defs>
                              <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                              <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-${pos.symbol}-${pos.key})`} />
                            </svg>
                          </div>
                        );
                      })()}
                      {!sparkLoading && sparkData && sparkData.length === 0 && (
                        <p className={`text-[9px] ${th.textFaint} text-center py-3`}>Chart data unavailable</p>
                      )}
                    <a
                      href={`https://www.tradingview.com/chart/?symbol=${pos.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[10px] text-blue-400 font-bold tracking-wider transition-colors border border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/10"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Open in TradingView
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t-2 border-slate-600/60 pt-1 border-r border-r-slate-700/40 pr-2">
              <p className={`text-[9px] ${th.textFaint}`}>Entry / Expiry / DTE</p>
              <p className="text-xs leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                {pos.entryDate && <span className={`block text-[10px] ${th.textFaint}`}>{pos.entryDate}</span>}
                <span className={`block font-bold ${th.text}`}>{pos.expDate}</span>
                <span className={`block ${dteColor(pos.dte)}`}>({pos.dte}d){Number.isFinite(pos.entryDte) ? <span className={`text-[9px] ${th.textFaint}`}> ← {pos.entryDte}d entry</span> : null}</span>
              </p>
            </div>

            {/* ── MARKET ─────────────────────────────── */}
            <div className="border-t-2 border-sky-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Stock</p>
              <p className={`text-xs ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{pos.stockPrice != null ? `$${pos.stockPrice.toFixed(2)}` : '—'}</p>
            </div>

            <div className="relative group border-t-2 border-sky-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>OTM %</p>
              <p className={`text-xs font-bold ${bufferColor(pos.buffer, pos.dte)}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {pos.buffer != null ? `${pos.buffer.toFixed(1)}%` : '—'}
              </p>
              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 z-50 hidden group-hover:block w-72 pointer-events-none">
                <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-3 shadow-2xl text-[10px]">
                  <p className="text-white font-bold mb-2 tracking-wide">BUFFER RISK GUIDE</p>
                  <p className="text-[#888] mb-2">Color adjusts based on buffer % <span className="text-white">and</span> DTE remaining. Same buffer is safer with less time left.</p>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-[#666] pb-1 pr-2 font-normal">Buffer</th>
                        <th className="text-center text-[#666] pb-1 px-1 font-normal">&gt;30d</th>
                        <th className="text-center text-[#666] pb-1 px-1 font-normal">21-30d</th>
                        <th className="text-center text-[#666] pb-1 px-1 font-normal">14-21d</th>
                        <th className="text-center text-[#666] pb-1 px-1 font-normal">7-14d</th>
                        <th className="text-center text-[#666] pb-1 px-1 font-normal">&lt;7d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: '> 8%',  cols: ['🟢','🟢','🟢','🟢','🟢'] },
                        { label: '5-8%',  cols: ['🟢','🟢','🟢','🟡','🟢'] },
                        { label: '3-5%',  cols: ['🟡','🟡','🟢','🟢','🟢'] },
                        { label: '2-3%',  cols: ['🟠','🟠','🟡','🟡','🟢'] },
                        { label: '< 2%',  cols: ['🔴','🔴','🟠','🟡','🟡'] },
                      ].map(row => (
                        <tr key={row.label} className={pos.buffer != null && isBufferRow(pos.buffer, row.label) ? 'bg-white/5 rounded' : ''}>
                          <td className="text-[#aaa] pr-2 py-0.5 font-mono">{row.label}</td>
                          {row.cols.map((c, i) => (
                            <td key={i} className={`text-center px-1 py-0.5 ${pos.dte != null && isDteCol(pos.dte, i) ? 'bg-white/10 rounded' : ''}`}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[#555] mt-2 leading-tight">Your position: <span className="text-white">{pos.buffer?.toFixed(1) ?? '—'}% buffer</span> at <span className="text-white">{pos.dte}d DTE</span></p>
                </div>
              </div>
            </div>

            <div className="border-t-2 border-sky-600/50 pt-1 border-r border-r-slate-700/40 pr-2">
              <p className={`text-[9px] ${th.textFaint}`}>
                {lifecycle.type === 'CSP' ? 'Eff Buy / Strike' : 'Strikes'}
              </p>
              <p className={`text-xs ${th.text}`} style={{ fontFamily: '"DM Mono", monospace' }}>
                {lifecycle.type === 'CSP' && cspEffectiveBuyPrice != null && cspStrike != null
                  ? `$${cspEffectiveBuyPrice.toFixed(2)} ← ${cspStrike}P`
                  : strikesSummary()}
              </p>
            </div>

            {/* ── P&L ────────────────────────────────── */}
            {/* Max Risk — already computed in calculateMaxRisk (net of credit received).
                CSP already shows its own capital requirement via Cash Req next to it, so
                this risk column is spread-only. Positioned right after Strikes so downside
                is established before Buyback/Credit, ahead of the value columns. */}
            {lifecycle.type !== 'CSP' ? (
              <div className="border-t-2 border-emerald-600/50 pt-1">
                <p className={`text-[9px] ${th.textFaint}`}>Max Risk</p>
                <p className="text-xs font-bold text-red-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${pos.maxRisk.toLocaleString()}
                </p>
              </div>
            ) : (
              <div className="border-t-2 border-emerald-600/50 pt-1" />
            )}

            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>
                {lifecycle.type === 'CSP' ? 'Cash Req' : 'Buyback'}
              </p>
              <p className={`text-xs font-bold ${lifecycle.type === 'CSP' ? 'text-amber-400' : th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {lifecycle.type === 'CSP' && cspCashRequired != null
                  ? `$${cspCashRequired.toLocaleString()}`
                  : pos.currentValue != null
                  ? `$${pos.currentValue.toFixed(2)}`
                  : '—'}
              </p>
            </div>

            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Credit</p>
              <p className="text-xs font-bold text-emerald-400" style={{ fontFamily: "'DM Mono', monospace" }}>${pos.creditReceived.toFixed(2)}</p>
            </div>

            <div onClick={e => e.stopPropagation()} className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>{Math.round(pos.profitTarget * 100)}% Target</p>
              {editingTarget ? (
                <div className="flex items-center gap-1">
                  <input type="number" min="10" max="100" value={targetInput}
                    onChange={e => setTargetInput(e.target.value)}
                    onBlur={handleTargetSave}
                    onKeyDown={e => { if (e.key === 'Enter') handleTargetSave(); if (e.key === 'Escape') setEditingTarget(false); }}
                    autoFocus className="text-xs w-12 bg-transparent border-b border-blue-500 outline-none text-blue-400"
                    style={{ fontFamily: "'DM Mono', monospace" }} />
                  <span className="text-[9px] text-blue-400">%</span>
                </div>
              ) : (
                <div className="cursor-pointer" onClick={() => { setTargetInput(String(Math.round(pos.profitTarget * 100))); setEditingTarget(true); }}>
                  <p className={`text-xs ac-hover-text transition-colors ${pos.hitTarget ? 'text-emerald-400 font-bold' : th.textFaint}`}
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                    ${pos.targetPrice.toFixed(2)}{pos.hitTarget && ' ✓'}
                  </p>
                </div>
              )}
              {!editingTarget && projection != null && projection.status === 'ontrack' && (
                <p className="text-[9px] text-emerald-400">~by {projection.dateLabel}</p>
              )}
              {!editingTarget && projection != null && projection.status === 'unlikely' && (
                <p className="text-[9px] text-yellow-400">50% unlikely before 21-DTE</p>
              )}
            </div>

            <div className="border-t-2 border-emerald-600/50 pt-1 border-r border-r-slate-700/40 pr-2">
              <p className={`text-[9px] ${th.textFaint}`}>P/L Open</p>
              {(() => {
                // Prefer pnl (live mid from market-data) over plOpen (EOD marks)
                const displayPnl = pos.pnl ?? pos.plOpen;
                const isStale = pos.pnl == null && pos.plOpen != null;
                if (displayPnl == null) return <p className={`text-xs ${th.textFaint}`}>—</p>;
                return (
                  <>
                    <p className={`text-xs font-bold ${displayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                      {displayPnl >= 0 ? '+' : ''}${displayPnl.toFixed(0)}{isStale && <span className="text-[8px] opacity-50 ml-0.5">~</span>}
                    </p>
                    {pos.creditReceived !== 0 && (
                      <p className={`font-normal text-[10px] ${displayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                        ({displayPnl >= 0 ? '+' : ''}{(displayPnl / Math.abs(pos.creditReceived) * 100).toFixed(1)}%)
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* ── GREEKS ─────────────────────────────── */}
            <div
              className="relative group border-t-2 border-purple-600/50 pt-1"
              title={`Premium edge uses IV - HV30 when HV30 exists; otherwise it falls back to IVR. IV=${pos.iv ?? '—'}%, HV30=${pos.hv30 ?? '—'}%, IVR=${pos.ivr ?? '—'}`}
            >
              <p className={`text-[9px] ${th.textFaint}`}>Net Edge <span className="text-[7px] opacity-60">~est</span></p>

              {/* 1. Net-edge dollar number, peak-relative color */}
              <p className={`text-xs font-bold leading-tight ${netEdgeColor(pos, th.textFaint)}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {(() => { const v = netEdgeLive(pos); return v == null ? '—' : `${v >= 0 ? '+' : ''}$${v.toFixed(0)}/d`; })()}
              </p>

              {/* 2. Day-over-day change + 4. rollover alarm */}
              {(() => {
                const chg = netEdgeDayChangePct(pos);
                const rolled = netEdgeRolledOver(pos);
                return (
                  <p className="text-[8px] mt-0.5 font-semibold">
                    {chg != null && (
                      <span className={chg >= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                        {chg >= 0 ? '↑' : '↓'} {Math.abs(chg).toFixed(0)}%
                      </span>
                    )}
                    {rolled && <span className="text-red-400">{chg != null ? ' · ' : ''}▼ off peak</span>}
                    {chg == null && !rolled && <span className={th.textFaint}>new</span>}
                  </p>
                );
              })()}

              {/* 3. Peak readout with days-tracked confidence */}
              {(() => {
                const peak = netEdgePeak(pos);
                const days = netEdgeDaysTracked(pos);
                if (peak == null) return null;
                return (
                  <p className={`text-[8px] leading-tight ${th.textFaint}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                    peak ${peak.toFixed(0)} · {days}d
                  </p>
                );
              })()}

              <div className="absolute bottom-full left-0 mb-2 z-50 hidden group-hover:block w-72 pointer-events-none">
                <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-3 shadow-2xl text-[10px]">
                  <p className="text-white font-bold mb-2 tracking-wide">NET DAILY EDGE</p>
                  <p className="text-[#aaa] mb-1">Theta (collecting): {pos.theta != null ? `$${pos.theta.toFixed(0)}/d` : '—'}</p>
                  <p className="text-[#aaa] mb-1">Gamma drag (est): {(() => { const t = pos.theta, n = netEdgeLive(pos); return (t != null && n != null) ? `$${(t - n).toFixed(0)}/d` : '—'; })()}</p>
                  <p className="text-[#aaa] mb-1">Net edge: {(() => { const v = netEdgeLive(pos); return v == null ? '—' : `${v >= 0 ? '+' : ''}$${v.toFixed(0)}/d`; })()}</p>
                  <p className="text-[#aaa] mb-1">Peak: {(() => { const p = netEdgePeak(pos); return p == null ? '—' : `$${p.toFixed(0)}`; })()} · tracked {netEdgeDaysTracked(pos)}d</p>
                  <p className="text-[#888] mt-2">
                    Theta you collect daily minus the expected daily cost of gamma (price movement). Approaching $0 means gamma is catching up — consider closing. Directional estimate; gets more reliable as snapshot history grows.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t-2 border-purple-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Theta</p>
              <p className={`text-xs font-bold inline-block ${thetaTint(pos.theta)} ${thetaTextColor(pos.theta, th.textFaint)}`} style={{ fontFamily: "'DM Mono', monospace" }} title={pos.theta != null ? `Raw theta: ${pos.theta.toFixed(4)}` : undefined}>
                {fmtThetaDisplay(pos.theta)}
              </p>
              <p className={`text-[8px] mt-0.5 font-semibold ${thetaTextColor(pos.theta, th.textFaint)}`}>
                {thetaLabel(pos.theta)}
              </p>
            </div>

            <div className="border-t-2 border-purple-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Gamma</p>
              <p className={`text-xs font-bold inline-block ${gammaTint(pos.gamma)} ${gammaTextColor(pos.gamma, th.textFaint)}`} style={{ fontFamily: "'DM Mono', monospace" }} title={pos.gamma != null ? `Raw gamma: ${pos.gamma.toFixed(4)}` : undefined}>
                {fmtGammaDisplay(pos.gamma)}
              </p>
              <p className={`text-[8px] mt-0.5 font-semibold ${gammaTextColor(pos.gamma, th.textFaint)}`}>
                {gammaLabel(pos.gamma)}
              </p>
            </div>

            <div className="border-t-2 border-purple-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Vega</p>
              <p className={`text-xs font-bold inline-block ${vegaTint(pos.netVega)} ${vegaTextColor(pos.netVega, th.textFaint)}`} style={{ fontFamily: "'DM Mono', monospace" }} title={pos.netVega != null ? `Raw vega: ${pos.netVega.toFixed(4)}` : undefined}>
                {fmtVegaDisplay(pos.netVega)}
              </p>
              <p className={`text-[8px] mt-0.5 font-semibold ${vegaTextColor(pos.netVega, th.textFaint)}`}>
                {vegaLabel(pos.netVega)}
              </p>
            </div>

            <div className="border-t-2 border-purple-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>IVR</p>
              <p className={`text-xs font-bold ${ivrTextColor(pos.ivr, th.textFaint)}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {pos.ivr ?? '—'}
              </p>
              <p className={`text-[8px] mt-0.5 font-semibold ${ivrTextColor(pos.ivr, th.textFaint)}`}>
                {ivrLabel(pos.ivr)}
              </p>
            </div>

            <div className="border-t-2 border-cyan-600/50 pt-1 border-r border-r-slate-700/40 pr-2" title={`Entry snapshot ${entrySnapshotAgeLabel(pos)}. Existing positions are captured from the first time this feature sees them.`}>
              <p className={`text-[9px] ${th.textFaint}`}>Entry → Now</p>
              <p className="text-[9px] leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                <span className={entryChangeColor(pos.ivAtEntry, pos.iv, true, th.textFaint)}>IV {fmtEntryNowPct(pos.ivAtEntry, pos.iv, 0)}</span>
              </p>
              <p className="text-[9px] leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                <span className={entryChangeColor(pos.deltaAtEntry, pos.netDelta, true, th.textFaint)}>Δ {fmtEntryNowDelta(pos.deltaAtEntry, pos.netDelta)}</span>
              </p>
              <p className="text-[9px] leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                <span className={entryChangeColor(pos.thetaAtEntry, pos.theta, false, th.textFaint)}>Θ {fmtEntryNowTheta(pos.thetaAtEntry, pos.theta)}</span>
              </p>
              <p className="text-[9px] leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>
                <span className={entryChangeColor(pos.otmAtEntry, pos.buffer, false, th.textFaint)}>OTM {fmtEntryNowPct(pos.otmAtEntry, pos.buffer, 1)}</span>
              </p>
              <p className={`text-[8px] mt-0.5 ${th.textFaint}`}>DTE {fmtEntryNowDte(pos.dteAtEntry ?? pos.entryDte, pos.dte)}</p>
            </div>

            {/* ── ORDERS ─────────────────────────────── */}
            <div className="border-t-2 border-amber-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>GTC</p>
              <p className={`text-xs font-bold ${pos.hasGtc ? 'text-emerald-400' : 'text-red-400'}`}>{pos.hasGtc ? '✓ Live' : '✕ None'}</p>
            </div>

            <div className="border-t-2 border-amber-600/50 pt-1 border-r border-r-slate-700/40 pr-2">
              <p className={`text-[9px] ${th.textFaint}`}>Stop Loss</p>
              {(() => {
                const cfg =
                  pos.stopLossStatus === 'live'  ? { icon: '✓', label: 'Stop',  cls: 'text-emerald-400' } :
                  pos.stopLossStatus === 'loose' ? { icon: '⚠', label: 'Loose', cls: 'text-yellow-400'  } :
                  pos.stopLossStatus === 'none'  ? { icon: '✕', label: 'None',  cls: 'text-red-400'     } :
                                                   { icon: '—', label: '?',     cls: th.textFaint        };
                return (
                  <p className={`text-xs font-bold ${cfg.cls}`}>
                    {cfg.icon} {cfg.label}
                    {pos.stopLossPrice != null && (
                      <span className={`ml-1 ${th.textFaint} text-[10px] font-normal`}>${pos.stopLossPrice.toFixed(2)}</span>
                    )}
                  </p>
                );
              })()}
            </div>

            {/* ── ACTION ─────────────────────────────── */}
            <div className="border-t-2 border-slate-500/40 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Suggested</p>
              <span className={`text-[10px] font-bold whitespace-nowrap ${ACTION_META[rec.action].color}`}>{ACTION_META[rec.action].label}</span>
              <p className={`text-[9px] ${th.textFaint} mt-0.5 leading-tight`}>{rec.detail}</p>
              {(() => { const sig = getExtendSignal(pos); return sig ? <p className="text-[9px] text-blue-400 mt-0.5 leading-tight">{sig}</p> : null; })()}
            </div>
          </div>
        </div>
      </div>

      {/* Action + Analyze row */}
      <div className={`flex items-center justify-between px-4 py-2 border-t ${th.borderLight}`}>
        {/* Quick action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['TAKE_PROFIT', 'CUT_LOSSES', 'CLOSE_ROLL', 'PLACE_GTC'] as ActionType[]).map(action => {
            const meta = ACTION_META[action];
            if (!isActionRelevant(pos, action)) return null;
            return (
              <button key={action}
                onClick={e => { e.stopPropagation(); onExecute(pos, action); }}
                className={`text-[9px] px-2.5 py-1 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
                {meta.label}
              </button>
            );
          })}
          {/* Extend Profit — only show when profit ≥50% AND DTE ≥ 14 */}
          {(() => {
            const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : null;
            const canExtend = pnlPct != null && pnlPct >= 50 && pos.dte >= 14;
            return canExtend ? <ExtendProfitButton pos={pos} th={th} /> : null;
          })()}
          <SetStopLossButton pos={pos} th={th} />
          {/* Intent — reference point for AI analysis (assignment = goal vs avoid) */}
          <select
            value={pos.intent}
            onClick={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); onIntentChange(pos.key, e.target.value as PositionIntent); }}
            title="Trade intent — tells the AI whether assignment is the goal"
            className={`text-[9px] px-1.5 py-1 border rounded bg-transparent outline-none cursor-pointer ${th.borderLight} ${th.textFaint} ac-hover-text`}
            style={{ fontFamily: "'DM Mono', monospace" }}>
            <option value="income">Intent: Income</option>
            <option value="acquisition">Intent: Acquire</option>
            <option value="neutral">Intent: Neutral</option>
          </select>
          {(['TAKE_PROFIT', 'CUT_LOSSES', 'CLOSE_ROLL', 'PLACE_GTC'] as ActionType[]).includes(rec.action) && (
            <span className={`text-[9px] ${th.textFaint} ml-1`}>← suggested</span>
          )}
        </div>

        <button
          onClick={e => { e.stopPropagation(); if (analysis || analysisLoading) { setShowAnalysis(v => !v); } else { handleAnalyze(); } }}
          className={`text-[10px] px-3 py-1 border rounded-lg transition-colors font-bold flex items-center gap-1.5 ${
            showAnalysis && analysis
              ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
              : analysis
              ? 'border-indigo-600 text-indigo-400 hover:bg-indigo-500/10'
              : 'border-indigo-800 text-indigo-500 hover:border-indigo-600 hover:text-indigo-400'
          }`}>
          <span>◈</span>
          <span>{analysisLoading ? 'Analyzing...' : showAnalysis && analysis ? 'Hide Analysis' : analysis ? 'Show Analysis' : 'Analyze with AI'}</span>
        </button>
      </div>

      {/* Expanded legs */}
      {expanded && (
        <div className={`border-t ${th.border} px-4 py-3`}>
          <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-2`}>Legs</p>
          <div className="space-y-1.5">
            {pos.legs.map((leg, i) => (
              <div key={i} className="flex items-center gap-4 flex-wrap">
                <span className={`text-[10px] w-10 font-bold ${leg.direction === 'Short' ? 'text-red-400' : 'text-emerald-400'}`}>{leg.direction}</span>
                <span className={`text-[10px] ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{leg.quantity}x {leg.strikePrice} {leg.optionType === 'P' ? 'Put' : 'Call'}</span>
                <span className={`text-[10px] ${th.textFaint}`}>Avg open: <span className={th.text}>${leg.avgOpenPrice.toFixed(2)}</span></span>
                {leg.currentPrice != null && <span className={`text-[10px] ${th.textFaint}`}>Current: <span className={th.text}>${leg.currentPrice.toFixed(2)}</span></span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI analysis panel */}
      {showAnalysis && (
        <>
          {analysisLoading && (
            <div className={`border-t ${th.border} px-4 py-4 flex items-center gap-3`} style={{ background: 'rgba(99,102,241,0.04)' }}>
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className={`text-xs ${th.textFaint}`}>Analyzing position with AI...</p>
              <button onClick={() => setShowAnalysis(false)} className={`ml-auto text-[10px] ${th.textFaint} hover:${th.text}`}>✕</button>
            </div>
          )}
          {analysisError && (
            <div className={`border-t ${th.border} px-4 py-3 flex items-center gap-2`}>
              <p className="text-[10px] text-red-400">Analysis failed: {analysisError}</p>
              <button onClick={() => { setAnalysisError(null); handleAnalyze(); }} className="text-[10px] text-blue-400 hover:underline">Retry</button>
              <button onClick={() => setShowAnalysis(false)} className={`ml-auto text-[10px] ${th.textFaint}`}>✕</button>
            </div>
          )}
          {analysis && !analysisLoading && (
            <div className="relative">
              <button onClick={() => setShowAnalysis(false)} className={`absolute top-3 right-3 text-[10px] ${th.textFaint} hover:${th.text} z-10`}>✕</button>
              <AnalysisPanel analysis={analysis} pos={pos} th={th} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Draggable Section Wrapper ───────────────────────────────────────────────
function DraggableSection({ sectionId, index, total, th, onMove, onDragStart, onDragOver, onDrop, isDragging, children }: {
  sectionId: string; index: number; total: number; th: typeof THEMES[Theme];
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (id: string) => void;
  isDragging: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(sectionId)}
      onDragOver={e => onDragOver(e, sectionId)}
      onDrop={() => onDrop(sectionId)}
      className={`transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex items-center gap-2 mb-1 group">
        <span
          className={`text-sm ${th.textFaint} cursor-grab active:cursor-grabbing select-none opacity-40 group-hover:opacity-90 transition-opacity`}
          title="Drag to reorder"
        >⠿</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-90 transition-opacity">
          <button
            onClick={() => onMove(sectionId, 'up')}
            disabled={index === 0}
            className={`text-[10px] px-1 ${th.textFaint} hover:${th.textMuted} disabled:opacity-30 transition-colors`}
            title="Move up"
          >▲</button>
          <button
            onClick={() => onMove(sectionId, 'down')}
            disabled={index === total - 1}
            className={`text-[10px] px-1 ${th.textFaint} hover:${th.textMuted} disabled:opacity-30 transition-colors`}
            title="Move down"
          >▼</button>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Pending Order Card ──────────────────────────────────────────────────────
function PendingOrderCard({ order, th, cancelling, onCancel }: {
  order: PendingOrder; th: typeof THEMES[Theme];
  cancelling: boolean; onCancel: (order: PendingOrder) => void;
}) {
  const strategyColor = order.strategy === 'BPS'
    ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
    : order.strategy === 'BCS'
    ? 'border-red-600 text-red-400 bg-red-500/10'
    : order.strategy === 'IC'
    ? 'border-blue-600 text-blue-400 bg-blue-500/10'
    : 'border-slate-600 text-slate-400 bg-slate-500/10';

  const putLegs = order.legs.filter(l => l.optionType === 'P').sort((a, b) => b.strikePrice - a.strikePrice);
  const callLegs = order.legs.filter(l => l.optionType === 'C').sort((a, b) => a.strikePrice - b.strikePrice);
  const strikesDisplay = order.strategy === 'IC' && putLegs.length >= 2 && callLegs.length >= 2
    ? `${putLegs[0].strikePrice}P/${putLegs[1].strikePrice}P · ${callLegs[0].strikePrice}C/${callLegs[1].strikePrice}C`
    : putLegs.length >= 2
      ? `${putLegs[0].strikePrice}P/${putLegs[1].strikePrice}P`
      : callLegs.length >= 2
        ? `${callLegs[0].strikePrice}C/${callLegs[1].strikePrice}C`
        : order.legs.map(l => `${l.strikePrice}${l.optionType ?? ''}`).join('/');

  const submittedDisplay = order.createdAt
    ? new Date(order.createdAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;

  return (
    <div className={`border border-yellow-700/60 ${th.card} rounded-lg p-4`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{order.symbol}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 border rounded ${strategyColor}`}>{order.strategy}</span>
          <span className={`text-xs ${th.textMuted}`}>{strikesDisplay}</span>
          {order.expDate && <span className={`text-[10px] ${th.textFaint}`}>exp {order.expDate}</span>}
          <span className={`text-[10px] font-bold px-2 py-0.5 border rounded border-yellow-600 text-yellow-400 bg-yellow-500/10`}>
            {order.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {order.limitPrice != null && (
            <span className={`text-xs font-bold ${order.priceEffect === 'Credit' ? 'text-emerald-400' : 'text-red-400'}`}>
              ${order.limitPrice.toFixed(2)} {order.priceEffect ?? ''}
            </span>
          )}
          <button
            onClick={() => onCancel(order)}
            disabled={cancelling}
            className="text-[10px] px-3 py-1.5 border border-red-700 text-red-400 rounded hover:bg-red-600/20 transition-colors font-bold disabled:opacity-40"
          >
            {cancelling ? 'CANCELLING...' : 'CANCEL'}
          </button>
        </div>
      </div>
      {submittedDisplay && (
        <p className={`text-[9px] ${th.textFaint} mt-1.5`}>Submitted {submittedDisplay}</p>
      )}
    </div>
  );
}

// ── Pending Orders Section ──────────────────────────────────────────────────
function PendingOrdersSection({ orders, th, cancellingOrderIds, onCancel }: {
  orders: PendingOrder[]; th: typeof THEMES[Theme];
  cancellingOrderIds: Set<string>; onCancel: (order: PendingOrder) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-yellow-400 tracking-widest font-bold uppercase">
          ⏳ Pending Orders — {orders.length}
        </p>
      </div>
      <div className="space-y-2">
        {orders.map(order => (
          <PendingOrderCard
            key={order.id}
            order={order}
            th={th}
            cancelling={cancellingOrderIds.has(order.id)}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}

// ── Position Section with group-action header ──────────────────────────────
function PositionSection({ title, titleColor, positions, th, checked, onToggle, onToggleAll, onProfitTargetChange, onIntentChange, groupAction, onGroupAction, onExecute }: {
  title: string; titleColor: string; positions: Position[];
  th: typeof THEMES[Theme]; checked: Set<string>;
  onToggle: (key: string) => void; onToggleAll: (keys: string[], select: boolean) => void;
  onProfitTargetChange: (key: string, value: number) => void;
  onIntentChange: (key: string, intent: PositionIntent) => void;
  groupAction: ActionType; onGroupAction: (positions: Position[], action: ActionType) => void;
  onExecute: (pos: Position, action: ActionType) => void;
}) {
  const lifecycleRank: Record<string, number> = {
    CSP: 1,
    ASSIGNED_STOCK: 2,
    COVERED_CALL: 3,
    SPREAD: 4,
    PMCC: 5,
    UNKNOWN: 9,
  };

  const sortedPositions = [...positions].sort((a, b) => {
    const aType = classifyPositionLifecycle(a).type;
    const bType = classifyPositionLifecycle(b).type;
    return (lifecycleRank[aType] ?? 9) - (lifecycleRank[bType] ?? 9);
  });

  const keys = sortedPositions.map(p => p.key);
  const allChecked = keys.length > 0 && keys.every(k => checked.has(k));
  const someChecked = keys.some(k => checked.has(k));
  const meta = ACTION_META[groupAction];
  const checkboxRef = (el: HTMLInputElement | null) => { if (el) el.indeterminate = someChecked && !allChecked; };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <input type="checkbox" ref={checkboxRef} checked={allChecked}
            onChange={() => onToggleAll(keys, !allChecked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer" />
          <p className={`text-[10px] ${titleColor} tracking-widest font-bold uppercase`}>{title} — {positions.length}</p>
        </div>
        {groupAction !== 'HOLD' && (
          <button onClick={() => onGroupAction(positions, groupAction)}
            className={`text-[10px] px-3 py-1.5 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
            {meta.label} All
          </button>
        )}
      </div>
      <div className="space-y-2">
        {sortedPositions.map(p => (
          <PositionCard key={p.key} pos={p} th={th} checked={checked.has(p.key)} onToggle={onToggle} onProfitTargetChange={onProfitTargetChange} onIntentChange={onIntentChange} onExecute={onExecute} />
        ))}
      </div>
    </div>
  );
}

// ── Sticky Bulk Action Bar ─────────────────────────────────────────────────
function BulkActionBar({ selectedKeys, positions, onExecute, onClear, th }: {
  selectedKeys: Set<string>; positions: Position[];
  onExecute: (items: { pos: Position; action: ActionType }[]) => void;
  onClear: () => void; th: typeof THEMES[Theme];
}) {
  if (selectedKeys.size === 0) return null;
  const selected = positions.filter(p => selectedKeys.has(p.key));
  // Context-aware: only offer a batch action if it applies to at least one
  // selected position (same relevance gate the per-card buttons use). When
  // applied, it only runs on the positions it's actually relevant for.
  const allActions: ActionType[] = ['TAKE_PROFIT', 'CUT_LOSSES', 'CLOSE_ROLL', 'PLACE_GTC'];
  const actions = allActions.filter(action => selected.some(pos => isActionRelevant(pos, action)));

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-7xl px-6 pb-4">
        <div className={`${th.sidebar} border ${th.border} rounded-xl px-5 py-3 flex items-center gap-4 shadow-2xl`}>
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">{selectedKeys.size}</span>
            <span className={`text-xs font-bold ${th.text}`}>Apply to selected:</span>
          </div>
          <div className={`w-px h-6 ${th.border} border-l`} />
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {actions.length === 0 && (
              <span className={`text-[10px] ${th.textFaint}`}>No batch actions apply to the selected positions</span>
            )}
            {actions.map(action => {
              const meta = ACTION_META[action];
              // Only run the action on positions it's actually relevant for.
              const targets = selected.filter(pos => isActionRelevant(pos, action));
              return (
                <button key={action}
                  onClick={() => onExecute(targets.map(pos => ({ pos, action })))}
                  className={`text-[10px] px-3 py-1.5 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
                  {meta.label} ({targets.length})
                </button>
              );
            })}
          </div>
          <button onClick={onClear} className={`text-[10px] ${th.textFaint} hover:${th.text} shrink-0 transition-colors`}>
            ✕ Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

// ── Performance Panel ──────────────────────────────────────────────────────
function PerformancePanel({ onClose, th }: { onClose: () => void; th: typeof THEMES[Theme] }) {
  const auditLog: AuditEntry[] = (() => {
    try { return JSON.parse(localStorage.getItem('hunter-audit-log') ?? '[]'); } catch { return []; }
  })();

  const closed = auditLog.filter(e => e.status === 'submitted' && e.estPnl != null &&
    (e.action === 'TAKE_PROFIT' || e.action === 'CUT_LOSSES' || e.action === 'CLOSE_ROLL'));

  const winners = closed.filter(e => (e.estPnl ?? 0) > 0);
  const losers  = closed.filter(e => (e.estPnl ?? 0) <= 0);
  const winRate    = closed.length > 0 ? (winners.length / closed.length * 100) : 0;
  const avgWin     = winners.length > 0 ? winners.reduce((s, e) => s + (e.estPnl ?? 0), 0) / winners.length : 0;
  const avgLoss    = losers.length  > 0 ? Math.abs(losers.reduce((s, e) => s + (e.estPnl ?? 0), 0) / losers.length) : 0;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;
  const totalPnl   = closed.reduce((s, e) => s + (e.estPnl ?? 0), 0);

  // Monthly bucketing
  const byMonth: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const e of closed) {
    const month = e.timestamp.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { pnl: 0, trades: 0, wins: 0 };
    byMonth[month].pnl    += e.estPnl ?? 0;
    byMonth[month].trades += 1;
    if ((e.estPnl ?? 0) > 0) byMonth[month].wins += 1;
  }
  const months       = Object.keys(byMonth).sort();
  const last3Months  = months.slice(-3);
  const last12Months = months.slice(-12);
  const qPnl = last3Months.reduce((s, m)  => s + byMonth[m].pnl, 0);
  const yPnl = last12Months.reduce((s, m) => s + byMonth[m].pnl, 0);
  const mPnl = months.length > 0 ? byMonth[months[months.length - 1]].pnl : 0;

  // By symbol
  const bySymbol: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const e of closed) {
    if (!bySymbol[e.symbol]) bySymbol[e.symbol] = { pnl: 0, trades: 0, wins: 0 };
    bySymbol[e.symbol].pnl    += e.estPnl ?? 0;
    bySymbol[e.symbol].trades += 1;
    if ((e.estPnl ?? 0) > 0) bySymbol[e.symbol].wins += 1;
  }
  const symbolRows  = Object.entries(bySymbol).sort((a, b) => b[1].pnl - a[1].pnl);
  const maxSymbolPnl = Math.max(...symbolRows.map(r => Math.abs(r[1].pnl)), 1);
  const maxBarPnl    = Math.max(...months.map(m => Math.abs(byMonth[m].pnl)), 1);

  const kpis = [
    { label: 'Win Rate',    value: `${winRate.toFixed(0)}%`,                              sub: `${winners.length}W / ${losers.length}L`,     color: winRate >= 70 ? 'text-emerald-400' : winRate >= 50 ? 'text-yellow-400' : 'text-red-400' },
    { label: 'Expectancy', value: `${expectancy >= 0 ? '+' : ''}$${expectancy.toFixed(0)}`, sub: 'per trade avg',                             color: expectancy >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Total P&L',  value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`,    sub: 'all closed trades',                         color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Avg Win',    value: `+$${avgWin.toFixed(0)}`,                                sub: `avg loss: -$${avgLoss.toFixed(0)}`,          color: 'text-emerald-400' },
  ];

  const periods = [
    { label: 'This Month',   value: mPnl, sub: 'current month' },
    { label: 'Last Quarter', value: qPnl, sub: 'last 3 months' },
    { label: 'Last 12 Mo',   value: yPnl, sub: 'rolling annual' },
  ];

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col`}>

        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${th.border} shrink-0`}>
          <div>
            <h2 className={`text-sm font-bold ${th.text} tracking-wider`}>PERFORMANCE</h2>
            <p className={`text-[10px] ${th.textFaint}`}>{closed.length} closed trades · estimated P&L from audit log</p>
          </div>
          <button onClick={onClose} className={`${th.textFaint} hover:text-white text-lg leading-none`}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {closed.length === 0 ? (
            <div className={`text-center py-16 ${th.textFaint}`}>
              <p className="text-3xl mb-3">📊</p>
              <p className="text-sm">No closed trades in audit log yet.</p>
              <p className="text-[11px] mt-1 opacity-60">Trades appear here after you submit Take Profit, Cut Losses, or Close/Roll orders.</p>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-4 gap-3">
                {kpis.map(k => (
                  <div key={k.label} className={`${th.card} border ${th.border} rounded-xl p-4`}>
                    <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-1`}>{k.label}</p>
                    <p className={`text-xl font-bold ${k.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>{k.value}</p>
                    <p className={`text-[9px] ${th.textFaint} mt-0.5`}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Period P&L */}
              <div className="grid grid-cols-3 gap-3">
                {periods.map(p => (
                  <div key={p.label} className={`${th.card} border ${th.border} rounded-xl p-4`}>
                    <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-1`}>{p.label}</p>
                    <p className={`text-xl font-bold ${p.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                      {p.value >= 0 ? '+' : ''}${p.value.toFixed(0)}
                    </p>
                    <p className={`text-[9px] ${th.textFaint} mt-0.5`}>{p.sub}</p>
                  </div>
                ))}
              </div>

              {/* Monthly bar chart */}
              {months.length > 0 && (
                <div className={`${th.card} border ${th.border} rounded-xl p-4`}>
                  <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-4`}>Monthly P&L</p>
                  <div className="flex items-end gap-2" style={{ height: '120px' }}>
                    {months.slice(-12).map(m => {
                      const d = byMonth[m];
                      const pct = Math.abs(d.pnl) / maxBarPnl;
                      const h = Math.max(pct * 90, 4);
                      return (
                        <div key={m} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: '120px' }}>
                          <p className={`text-[8px] ${th.textFaint} text-center`}>{d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(0)}</p>
                          <div
                            className={`w-full rounded-t transition-all ${d.pnl >= 0 ? 'bg-emerald-500/60 hover:bg-emerald-500/80' : 'bg-red-500/60 hover:bg-red-500/80'}`}
                            style={{ height: `${h}px` }}
                            title={`${m}: ${d.trades} trades, ${d.wins} wins`}
                          />
                          <p className={`text-[8px] ${th.textFaint} text-center`}>{m.slice(5)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By Symbol */}
              {symbolRows.length > 0 && (
                <div className={`${th.card} border ${th.border} rounded-xl p-4`}>
                  <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-3`}>By Symbol</p>
                  <div className="space-y-2">
                    {symbolRows.map(([sym, d]) => (
                      <div key={sym} className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold ${th.text} w-16 shrink-0`}>{sym}</span>
                        <span className={`text-[9px] ${th.textFaint} w-16 shrink-0`}>{d.trades} trade{d.trades !== 1 ? 's' : ''}</span>
                        <span className={`text-[9px] w-14 shrink-0 ${d.wins / d.trades >= 0.7 ? 'text-emerald-400' : d.wins / d.trades >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {(d.wins / d.trades * 100).toFixed(0)}% win
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${d.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(Math.abs(d.pnl) / maxSymbolPnl * 100, 100)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-bold w-16 text-right shrink-0 ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                          {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trade log */}
              <div className={`${th.card} border ${th.border} rounded-xl p-4`}>
                <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-3`}>Trade History</p>
                <div className="space-y-0 max-h-64 overflow-y-auto">
                  {[...closed].reverse().map(e => (
                    <div key={e.id} className={`flex items-center gap-3 py-2 border-b ${th.borderLight} last:border-0`}>
                      <span className={`text-[9px] ${th.textFaint} w-20 shrink-0`}>{e.timestamp.slice(0, 10)}</span>
                      <span className={`text-[10px] font-bold ${th.text} w-14 shrink-0`}>{e.symbol}</span>
                      <span className={`text-[9px] ${th.textFaint} w-10 shrink-0`}>{e.strategy}</span>
                      <span className={`text-[9px] w-24 shrink-0 ${
                        e.action === 'TAKE_PROFIT' ? 'text-emerald-400' :
                        e.action === 'CUT_LOSSES'  ? 'text-red-400'     : 'text-blue-400'
                      }`}>{e.action.replace(/_/g, ' ')}</span>
                      <span className={`text-[10px] font-bold ml-auto ${(e.estPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                        {(e.estPnl ?? 0) >= 0 ? '+' : ''}${(e.estPnl ?? 0).toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className={`text-[9px] ${th.textFaint} text-center pb-2`}>
                ⚠ P&L figures are estimates from order submission. Actual fills may differ. Reconcile with TastyTrade for accurate accounting.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const th = THEMES[theme];
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { injectAccentStyle(); applyAccent(getSavedAccent()); }, []);

  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showClearSnapshotConfirm, setShowClearSnapshotConfirm] = useState(false);
  const [clearingSnapshots, setClearingSnapshots] = useState(false);
  const [batchItems, setBatchItems] = useState<{ pos: Position; action: ActionType }[] | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [dryRunMode, setDryRunMode] = useState<boolean>(isDryRun);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [portfolioAnalysisLoading, setPortfolioAnalysisLoading] = useState(false);

  // Trigger weekly behavior summarization silently on load
  useEffect(() => { summarizeBehaviorProfile().catch(() => {}); }, []);

  const handleAnalyzePortfolio = async () => {
    if (positions.length === 0) return;
    setPortfolioAnalysisLoading(true);
    try {
      const result = await analyzePortfolio(positions);
      setPortfolioAnalysis(result);
    } catch (e: any) {
      setPortfolioAnalysis({ loading: false, error: e.message, netDelta: null, dominantRisk: '', sectorConcentration: [], thetaYield: '', topRisks: [], priorityActions: [], marketContext: '', summary: '', generatedAt: new Date().toISOString() });
    } finally {
      setPortfolioAnalysisLoading(false);
    }
  };

  const marketStatus = getMarketStatus();

  const fetchPositions = async () => {
    setLoading(true); setError(''); setChecked(new Set());
    try {
      const { positions: data, pendingOrders: pendingData } = await loadPositions();
      setPositions(data);
      setPendingOrders(pendingData);
      setLastRefresh(new Date());
      captureSnapshotsIfNeeded(data); // fire-and-forget; doesn't block the UI
      // Load snapshot history and attach it to positions (non-blocking; if it
      // fails the cards simply render without peak/trend context).
      fetchSnapshotStore()
        .then(store => setPositions(prev => attachSnapshotHistory(prev, store)))
        .catch(e => console.error('Snapshot history fetch failed (non-blocking):', e));
    } catch (e: any) {
      if (e.message === 'Not authenticated' || e.message === 'Session expired') { window.location.href = '/login'; return; }
      setError(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPositions(); }, []);

  const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_SECTION_ORDER);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_SECTION_ORDER);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const missing = DEFAULT_SECTION_ORDER.filter(id => !parsed.includes(id));
        setSectionOrder([...parsed.filter(id => DEFAULT_SECTION_ORDER.includes(id)), ...missing]);
      }
    } catch {}
  }, []);

  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);

  const persistSectionOrder = (order: string[]) => {
    setSectionOrder(order);
    try { localStorage.setItem(LS_SECTION_ORDER, JSON.stringify(order)); } catch {}
  };

  const moveSectionWithArrow = (id: string, direction: 'up' | 'down') => {
    const idx = sectionOrder.indexOf(id);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sectionOrder.length) return;
    const next = [...sectionOrder];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    persistSectionOrder(next);
  };

  const handleSectionDragStart = (id: string) => setDraggedSectionId(id);
  const handleSectionDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!draggedSectionId || draggedSectionId === overId) return;
    const fromIdx = sectionOrder.indexOf(draggedSectionId);
    const toIdx = sectionOrder.indexOf(overId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...sectionOrder];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedSectionId);
    setSectionOrder(next);
  };
  const handleSectionDrop = (_id: string) => {
    if (draggedSectionId) persistSectionOrder(sectionOrder);
    setDraggedSectionId(null);
  };

  // Pending orders are always complex-order-sourced (Phase 1 extraction
  // reads PendingOrder.id from the parent OTOCO/OCO complex order's own
  // id, never the trigger/nested sub-order ids) -- so cancelling one
  // only ever needs the complex-orders endpoint, no branching required.
  const cancelPendingOrder = async (order: PendingOrder) => {
    setCancellingOrderIds(prev => new Set(prev).add(order.id));
    setError('');
    try {
      const token = await getAccessToken();
      await ttDelete(`/accounts/${order.accountNumber}/complex-orders/${order.id}`, token);
      await fetchPositions(); // refetch so pendingOrders/positions reflect the cancellation
    } catch (e: any) {
      setError(`Could not cancel order: ${e.message ?? 'unknown error'}`);
    } finally {
      setCancellingOrderIds(prev => { const next = new Set(prev); next.delete(order.id); return next; });
    }
  };

  const handleIntentChange = (key: string, intent: PositionIntent) => {
    setPositions(prev => prev.map(p => (p.key === key ? { ...p, intent } : p)));
    fetch('/api/position-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionKey: key, intent }),
    }).catch(e => console.error('Intent save failed (non-blocking):', e));
  };

  const handleProfitTargetChange = (key: string, value: number) => {
    try {
      const targets = JSON.parse(localStorage.getItem(LS_PROFIT_TARGETS) ?? '{}');
      targets[key] = value; localStorage.setItem(LS_PROFIT_TARGETS, JSON.stringify(targets));
    } catch {}
    setPositions(prev => prev.map(p => {
      if (p.key !== key) return p;
      return { ...p, profitTarget: value, targetPrice: p.creditReceived * value, hitTarget: p.pnl != null && p.pnl >= p.creditReceived * value };
    }));
  };

  const onToggle = (key: string) => setChecked(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const onToggleAll = (keys: string[], select: boolean) => setChecked(prev => { const n = new Set(prev); keys.forEach(k => select ? n.add(k) : n.delete(k)); return n; });
  const onClear = () => setChecked(new Set());

  const openBatch = (items: { pos: Position; action: ActionType }[]) => { if (items.length > 0) setBatchItems(items); };
  const onGroupAction = (pos: Position[], action: ActionType) => openBatch(pos.map(p => ({ pos: p, action })));
  const onBulkExecute = (items: { pos: Position; action: ActionType }[]) => { openBatch(items); onClear(); };


  return (
    <div className={`min-h-screen ${th.bg} pb-24 transition-colors duration-200`} style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* Header */}
      <div className={`${th.header} border-b ${th.border} px-6 pb-0 pt-3 sticky top-0 z-50 flex flex-col`}>
        <div className="flex items-center justify-between w-full pb-2">
          <div className="flex items-center gap-3">
            <svg width="46" height="46" viewBox="-26 -26 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle r="18" stroke="#00d4aa" strokeWidth="0.8" opacity="0.3"/>
              <circle r="12" stroke="#00d4aa" strokeWidth="0.8" opacity="0.6"/>
              <line x1="-23" y1="0" x2="-14" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="14" y1="0" x2="23" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="0" y1="-23" x2="0" y2="-14" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="0" y1="14" x2="0" y2="23" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="-6" y1="5" x2="-6" y2="-6" stroke="#ff5566" strokeWidth="1.8" strokeLinecap="round" opacity="0.85"/>
              <line x1="-1" y1="3" x2="-1" y2="-9" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="4" y1="1" x2="4" y2="-12" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round"/>
              <circle r="2" fill="#00d4aa"/>
            </svg>
            <div>
              <h1 className="text-lg font-bold tracking-widest text-white leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>TRADE<span style={{ color: '#00d4aa' }}>EDGE</span></h1>
              <p className="text-[9px] font-bold tracking-widest leading-tight" style={{ fontFamily: "'DM Mono', monospace", color: '#00d4aa', opacity: 0.75 }}>OPTIONS TRADING PLATFORM</p>
            </div>
          </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-bold ${marketStatus.open ? 'text-emerald-400' : 'text-yellow-400'}`}>{marketStatus.label}</span>
          {lastRefresh && <span className="text-[10px] text-white/30">Updated {lastRefresh.toLocaleTimeString()}</span>}
          {/* Dry Run toggle — always visible */}
          <button
            onClick={() => { const next = !dryRunMode; setDryRunMode(next); setDryRun(next); }}
            className={`text-[10px] px-3 py-1.5 border rounded font-bold transition-colors tracking-wider ${
              dryRunMode
                ? 'border-amber-500 text-amber-300 bg-amber-500/15'
                : 'border-white/10 text-white/30 hover:border-amber-700 hover:text-amber-500'
            }`}>
            ⚗ {dryRunMode ? 'Dry Run ON' : 'Dry Run'}
          </button>
          <button onClick={() => setShowAuditLog(true)}
            className="text-[10px] px-3 py-1.5 border border-white/20 text-white/60 rounded hover:border-white/40 hover:text-white/80 transition-colors tracking-wider">
            📋 Audit Log
          </button>
          <button onClick={() => setShowMemory(true)}
            className="text-[10px] px-3 py-1.5 border border-purple-800 text-purple-400 rounded hover:border-purple-600 hover:text-purple-300 transition-colors tracking-wider">
            ◆ Memory
          </button>
          {positions.length > 0 && (
            <button onClick={handleAnalyzePortfolio} disabled={portfolioAnalysisLoading}
              className="text-[10px] px-3 py-1.5 border border-indigo-700 text-indigo-400 rounded hover:border-indigo-500 hover:text-indigo-300 transition-colors tracking-wider disabled:opacity-50 font-bold">
              {portfolioAnalysisLoading ? '◈ Analyzing...' : '◈ Analyze Portfolio'}
            </button>
          )}
          <a href="https://my.tastytrade.com" target="_blank" rel="noopener noreferrer"
            className="text-[10px] px-3 py-1.5 border border-white/20 text-white/60 rounded hover:border-white/40 hover:text-white/80 transition-colors tracking-wider">
            TastyTrade ↗
          </a>
          <button onClick={fetchPositions} disabled={loading}
            className="text-[10px] px-3 py-1.5 border border-white/20 text-white/60 rounded hover:border-white/40 hover:text-white/80 transition-colors tracking-wider disabled:opacity-40">
            {loading ? 'LOADING...' : '↻ REFRESH'}
          </button>
          <button onClick={() => { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; }}
            className="text-[10px] px-3 py-1.5 border border-white/10 text-white/30 rounded hover:border-white/30 hover:text-white/60 transition-colors tracking-wider">
            SIGN OUT
          </button>
          <ThemeToggle theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
          </div>
        </div>
        <div className="flex items-center gap-0 w-full border-t border-white/10">
          <Link href="/"              className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HOME</Link>
          <span                       className="text-[10px] font-bold px-3 py-2 tracking-wider" style={{ color: '#00d4aa', borderBottom: '2px solid #00d4aa' }}>PORTFOLIO</span>
          <Link href="/screener"      className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">SCREENER</Link>
          <Link href="/engine"        className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">INCOME ENGINE</Link>
          <Link href="/rinse-repeat"  className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">REPEAT STRATEGIES</Link>
          <Link href="/trade-log"     className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">TRADE LOG</Link>
          <Link href="/performance"   className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PERFORMANCE</Link>
          <Link href="/help"          className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HELP</Link>
        </div>
      </div>

      {/* Dry run mode banner */}
      {dryRunMode && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-amber-400 text-lg font-bold">⚗</span>
            <div>
              <p className="text-amber-300 text-xs font-bold tracking-wider">DRY RUN MODE IS ACTIVE</p>
              <p className="text-amber-500 text-[10px]">All order actions will be simulated — nothing will be sent to TastyTrade</p>
            </div>
          </div>
          <button
            onClick={() => { setDryRunMode(false); setDryRun(false); }}
            className="text-[10px] px-3 py-1.5 border border-amber-600 text-amber-400 rounded hover:bg-amber-500/20 transition-colors font-bold">
            Turn Off Dry Run
          </button>
        </div>
      )}

      {error && <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-400 text-sm">{error}</div>}

      {loading && positions.length === 0 && pendingOrders.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <div className={`text-sm ${th.textFaint} tracking-widest`}>FETCHING POSITIONS...</div>
        </div>
      )}

      {!loading && !error && positions.length === 0 && pendingOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 gap-2">
          <p className={`text-sm ${th.textFaint} tracking-widest`}>NO OPEN POSITIONS FOUND</p>
          <p className={`text-xs ${th.textFaint}`}>Options positions from your TastyTrade account will appear here</p>
        </div>
      )}

      {(positions.length > 0 || pendingOrders.length > 0) && (
        <>
          <div className="overflow-x-auto">
            <div className="p-6 space-y-8" style={{ minWidth: '1600px' }}>
              <PortfolioGreeksDashboard positions={positions} th={th} />

              {(() => {
                // Flat list: no section grouping (does not generalize to PMCC/LEAPS).
                // Per-card banners convey each position's status. PositionSection
                // sorts by lifecycle (CSP/stock/CC/spread/PMCC) internally.
                return (
                  <>
                    {pendingOrders.length > 0 && (
                      <PendingOrdersSection
                        orders={pendingOrders} th={th}
                        cancellingOrderIds={cancellingOrderIds}
                        onCancel={cancelPendingOrder}
                      />
                    )}
                    {positions.length > 0 && (
                      <PositionSection
                        title="Positions" titleColor={th.textFaint}
                        positions={positions} th={th} checked={checked}
                        onToggle={onToggle} onToggleAll={onToggleAll}
                        onProfitTargetChange={handleProfitTargetChange} onIntentChange={handleIntentChange}
                        groupAction="HOLD" onGroupAction={onGroupAction}
                        onExecute={(pos, action) => openBatch([{ pos, action }])}
                      />
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      <BulkActionBar
        selectedKeys={checked} positions={positions}
        onExecute={onBulkExecute} onClear={onClear} th={th}
      />

      {batchItems && (
        <BatchConfirmModal
          items={batchItems}
          dryRun={dryRunMode}
          onClose={() => setBatchItems(null)}
          onSuccess={fetchPositions}
          th={th}
        />
      )}

      {showAuditLog && <AuditLogPanel onClose={() => setShowAuditLog(false)} th={th} />}
      {showPerformance && <PerformancePanel onClose={() => setShowPerformance(false)} th={th} />}
      {showMemory && <MemoryPanel onClose={() => setShowMemory(false)} th={th} />}

      {portfolioAnalysis && !portfolioAnalysis.error && (
        <PortfolioAnalysisPanel analysis={portfolioAnalysis} positions={positions} onClose={() => setPortfolioAnalysis(null)} th={th} />
      )}      
      
      {portfolioAnalysis?.error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-red-900/80 border border-red-500 rounded-lg px-4 py-3 text-xs text-red-300 flex items-center gap-3">
          Portfolio analysis failed: {portfolioAnalysis.error}
          <button onClick={() => setPortfolioAnalysis(null)} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
    </div>
  );
}
