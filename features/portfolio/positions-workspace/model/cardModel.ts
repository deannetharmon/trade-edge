// features/portfolio/positions-workspace/model/cardModel.ts
//
// POSITIONS-CARDS-0001: the pure view model behind the Cards view. Display only: it reads facts the table already shows and decides
// nothing about scoring. Verdict bucket comes from the existing recommendation (same mapping the verdict module uses), the sort key is
// defined once here and never shown as a number, and signal chips list exceptions only.

import type { Position } from '@/lib/portfolio-data/types';
import { INTENT_BUCKET, HARD_RULE_BUCKET, type VerdictBucket, type VerdictIntent } from '@/lib/portfolio-facts/verdict';
import { standaloneLongOptionLabel } from '@/lib/portfolio/positionStrategyFilter';
import { buildBreakevenViewModel, priceBufferFor } from './breakeven';
import { buildLongOptionRecovery } from './longOptionRecovery';
import { nextEarningsLine } from './nextEarnings';
import { profitTargetOrderPct } from './orderPercents';
import { buildPositionPnlBases, wideMarketNote } from './pnlBases';
import { buildCapitalViewModel, buildMoneynessViewModel, stopPresentationForPosition } from './presentation';
import { structuralChipOf } from './strategyChips';
import { netEdgeLive } from '@/lib/portfolio-data/acquisition';
import { parseSymbolList } from './filters';

export const LEAP_EARNINGS_WINDOW_DAYS = 30;
const isLeapPosition = (p: Position) => structuralChipOf(p) === 'leap' || standaloneLongOptionLabel(p)?.startsWith('LEAP') === true;

/** Dean's per-position sizing limit, as a percent of net liquidating value (Ian, 2026-10-23). */
export const SIZING_LIMIT_PCT = 10;

export type CardBucket = VerdictBucket | 'Unjudged';
export type CardChipTone = 'bad' | 'warn' | 'ok' | 'info';
export interface CardChip { id: string; label: string; tone: CardChipTone }

/** Most urgent first. Unjudged (no recommendation) sorts last: it is unknown, not calm. */
const BUCKET_RANK: Record<CardBucket, number> = { Close: 0, Roll: 1, Manage: 2, Hold: 3, Unjudged: 4 };

export interface PositionCard {
  key: string;
  position: Position;
  bucket: CardBucket;
  verdictLabel: string;
  reason: string | null;
  pnl: number | null;
  /** Second line under P/L: "if closed now" for credit, "52% of $2,130 left" for a bought option. */
  pnlNote: string;
  /** Whole-position capital at risk, used only for sorting. Never displayed as a risk score. */
  dollarsAtRisk: number | null;
  chips: CardChip[];
  assignment: { shares: number; netPrice: number | null; underwaterNow: number | null } | null;
  itmShortPut: boolean;
  /** Capital at risk as a percent of net liquidating value; null when either is unknown. */
  pctOfAccount: number | null;
  overSizing: boolean;
  /** The expanded detail: label/value pairs, same figures the table shows. */
  stats: Array<{ label: string; value: string }>;
  /** An unverified or wide quote: the P/L above is not trustworthy. Same signal as the Wide market and Verify price chips. */
  unverifiedQuote: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-06" -> "Nov 6". Returns the input unchanged when it is not an ISO date. */
export function shortDate(iso: string | null | undefined): string {
  if (typeof iso !== 'string') return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

/** The verdict bucket. A hard rule only moves a Hold intent (hard rules are never hidden, and never override a stronger intent). */
export function cardBucketOf(position: Pick<Position, 'recommendation'>): CardBucket {
  const rec = position.recommendation;
  if (!rec) return 'Unjudged';
  const intent = rec.managementIntent?.intent as VerdictIntent | 'DEPLOY_IDLE_CASH' | undefined;
  const intentBucket = intent && intent !== 'DEPLOY_IDLE_CASH' ? INTENT_BUCKET[intent] : undefined;
  const ruleBucket = HARD_RULE_BUCKET[rec.kind as string];
  if ((!intentBucket || intentBucket === 'Hold') && ruleBucket) return ruleBucket;
  return intentBucket ?? 'Hold';
}

/** Dollars at risk for sorting; null when the capital figure is a share count or unavailable. */
function dollarsAtRiskOf(p: Position): number | null {
  const capital = buildCapitalViewModel(p);
  return capital.value != null && !capital.suffix ? capital.value : null;
}

function itmShortPutOf(p: Position): boolean {
  if (structuralChipOf(p) !== 'csp') return false;
  const leg = p.legs?.length === 1 ? p.legs[0] : null;
  if (!leg || leg.direction !== 'Short' || leg.optionType !== 'P') return false;
  return buildMoneynessViewModel(p.stockPrice, p.legs)?.state === 'ITM';
}

/** Where a stop is not expected: Wheel and Acquire puts are meant to be assigned. */
export function stopNotExpected(p: Position): boolean {
  return structuralChipOf(p) === 'csp' && (p.intent === 'wheel' || p.intent === 'acquisition');
}

export function buildPositionCard(p: Position, opts: { pctOfTarget: number | null; netLiquidity?: number | null }): PositionCard {
  const bases = buildPositionPnlBases(p);
  const closeNow = p.closeNowPnl ?? bases.closeNow;
  const pnl = closeNow ?? p.pnl ?? null;
  const wide = wideMarketNote(bases, p.currentValue);
  const verifyPricing = p.recommendation?.kind === ('verify-pricing' as string);
  const unverifiedQuote = wide != null || verifyPricing;
  const recovery = buildLongOptionRecovery(p);
  const money0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  const basis = closeNow != null ? 'if closed now' : 'at mid';
  const pnlNote = unverifiedQuote ? 'unverified quote'
    : recovery ? `${recovery.remainingPct.toFixed(0)}% of ${money0(recovery.paid)} ${recovery.atOrAbovePaid ? 'of paid' : 'left'}`
    : opts.pctOfTarget != null ? `${basis} · ${opts.pctOfTarget.toFixed(0)}% of target`
    : basis;

  const chips: CardChip[] = [];
  const moneyness = buildMoneynessViewModel(p.stockPrice, p.legs);
  const breakeven = buildBreakevenViewModel(p);
  const structure = structuralChipOf(p);
  const shortSingle = p.legs?.length === 1 && p.legs[0].direction === 'Short';
  // Every option shows where it sits against its strike (long options too); the tone follows the position's own risk.
  if (moneyness) {
    const tone: CardChipTone = moneyness.tone === 'negative' ? 'bad' : moneyness.tone === 'warning' ? 'warn' : moneyness.tone === 'positive' ? 'ok' : 'info';
    chips.push({ id: 'moneyness', label: moneyness.state === 'ATM' ? 'ATM' : `${moneyness.state} ${moneyness.distancePct.toFixed(1)}%`, tone });
  }
  if (shortSingle && moneyness && moneyness.state !== 'ITM' && structure === 'csp') {
    const buffer = priceBufferFor(breakeven, p.stockPrice);
    if (buffer?.pct != null) chips.push({ id: 'buffer', label: `Buffer ${buffer.pct.toFixed(1)}%`, tone: 'ok' });
  }
  if (p.gtcOrderId != null) {
    const pct = profitTargetOrderPct(p);
    chips.push({ id: 'target', label: `Target ${pct != null ? `${pct}% ` : ''}live`, tone: 'ok' });
  }
  const stop = stopPresentationForPosition(p);
  if (p.stopLossClassification === 'NO_STOP' && stop.label === 'No stop' && !stopNotExpected(p)) chips.push({ id: 'no-stop', label: 'No stop', tone: 'warn' });
  if (wide != null) chips.push({ id: 'wide', label: 'Wide market', tone: 'warn' });
  if (verifyPricing) chips.push({ id: 'verify', label: 'Verify price', tone: 'warn' });
  const earnings = nextEarningsLine(p.nextEarningsDate, p.nextEarningsEstimated, p.expDate, undefined, p.nextEarningsUnderlying);
  // A LEAP is held for months, so earnings only matter when they are close (LEAP_EARNINGS_WINDOW_DAYS).
  if (earnings?.beforeExpiry && p.nextEarningsDate && !(isLeapPosition(p) && earnings.daysAway > LEAP_EARNINGS_WINDOW_DAYS)) {
    const horizon = standaloneLongOptionLabel(p);
    const leap = horizon === 'LEAP' || horizon === 'LEAP PUT';
    chips.push({ id: 'earnings', label: `Earnings ${shortDate(p.nextEarningsDate)} < Exp ${shortDate(p.expDate)}`, tone: leap ? 'info' : 'warn' });
  }
  const edge = netEdgeLive(p);
  if (edge != null && edge < 0) chips.push({ id: 'net-edge', label: 'Net Edge (−)', tone: 'warn' });

  let assignment: PositionCard['assignment'] = null;
  if (structure === 'csp' && p.legs?.length === 1 && p.legs[0].direction === 'Short') {
    const net = breakeven.values.length === 1 ? breakeven.values[0] : null;
    const shares = Math.abs(p.quantity ?? 1) * 100;
    const underwaterNow = net != null && finite(p.stockPrice) && p.stockPrice < net ? Math.round((p.stockPrice - net) * shares) : null;
    assignment = { shares, netPrice: net, underwaterNow };
  }

  const risk = dollarsAtRiskOf(p);
  const net = opts.netLiquidity;
  const pctOfAccount = risk != null && finite(net) && net > 0 ? (risk / net) * 100 : null;
  const dollars = (v: number | null | undefined) => (finite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'Unavailable');
  const debit = p.entryPriceEffect === 'Debit';
  const stats: PositionCard['stats'] = [
    debit ? { label: 'Paid', value: dollars(risk) } : { label: 'Credit', value: dollars(p.entryCredit ?? p.creditReceived) },
    debit ? { label: 'Close now', value: dollars(p.closeValue) } : { label: 'Max risk', value: dollars(risk) },
    { label: 'Break-even', value: breakeven.values.length ? breakeven.values.map(v => `$${v.toFixed(2)}`).join(' / ') : 'Unavailable' },
    { label: 'Opened', value: p.entryDate ? shortDate(p.entryDate) + (p.entryDate.slice(0, 4) !== String(new Date().getFullYear()) ? `, ${p.entryDate.slice(0, 4)}` : '') : 'Unavailable' },
  ];
  if (pctOfAccount != null) stats.push({ label: '% of account', value: `${pctOfAccount.toFixed(1)}%` });

  return {
    key: p.key,
    pctOfAccount,
    overSizing: pctOfAccount != null && pctOfAccount > SIZING_LIMIT_PCT,
    stats,
    position: p,
    bucket: cardBucketOf(p),
    verdictLabel: p.recommendation?.label ?? 'No recommendation',
    reason: p.recommendation?.managementIntent?.reasons?.[0] ?? p.recommendation?.primaryReason ?? null,
    pnl,
    pnlNote,
    dollarsAtRisk: dollarsAtRiskOf(p),
    chips,
    assignment,
    itmShortPut: itmShortPutOf(p),
    unverifiedQuote,
  };
}

/** Verdict bucket, then dollars at risk (largest first, unknown last), then DTE (soonest first). Stable for ties. */
export function compareCards(a: PositionCard, b: PositionCard): number {
  const rank = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  if (rank !== 0) return rank;
  const ar = a.dollarsAtRisk;
  const br = b.dollarsAtRisk;
  if (ar != null || br != null) {
    if (ar == null) return 1;
    if (br == null) return -1;
    if (ar !== br) return br - ar;
  }
  const ad = finite(a.position.dte) ? a.position.dte : Number.POSITIVE_INFINITY;
  const bd = finite(b.position.dte) ? b.position.dte : Number.POSITIVE_INFINITY;
  return ad === bd ? 0 : ad < bd ? -1 : 1;
}

export type CardSort = 'attention' | 'pnl-worst' | 'pnl-best' | 'dte' | 'symbol';
export const CARD_SORTS: ReadonlyArray<{ id: CardSort; label: string }> = [
  { id: 'attention', label: 'Needs attention first' },
  { id: 'pnl-worst', label: 'P/L: worst first' },
  { id: 'pnl-best', label: 'P/L: best first' },
  { id: 'dte', label: 'Expiring soonest' },
  { id: 'symbol', label: 'Symbol A–Z' },
];

export function sortCards(cards: readonly PositionCard[], sort: CardSort): PositionCard[] {
  const nullsLast = (get: (c: PositionCard) => number | null, dir: 1 | -1) => (a: PositionCard, b: PositionCard) => {
    const av = get(a); const bv = get(b);
    if (av == null && bv == null) return compareCards(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av === bv ? compareCards(a, b) : (av - bv) * dir;
  };
  const list = [...cards];
  switch (sort) {
    case 'pnl-worst': return list.sort(nullsLast(c => c.pnl, 1));
    case 'pnl-best': return list.sort(nullsLast(c => c.pnl, -1));
    case 'dte': return list.sort(nullsLast(c => (finite(c.position.dte) ? c.position.dte : null), 1));
    case 'symbol': return list.sort((a, b) => a.position.symbol.localeCompare(b.position.symbol) || compareCards(a, b));
    default: return list.sort(compareCards);
  }
}

/** Symbol search: tickers separated by spaces or commas, matched as a prefix so typing "TQ" finds TQQQ. Empty matches all. */
export function matchesSymbolSearch(symbol: string, query: string): boolean {
  const tokens = parseSymbolList(query);
  if (tokens.length === 0) return true;
  const s = symbol.trim().toUpperCase();
  return tokens.some(token => s.startsWith(token));
}

/** The assignment strip: every ITM Wheel put in the portfolio, regardless of the chip or search in force. */
export function assignmentStrip(positions: readonly Position[]): { count: number; shares: number; symbols: string[] } | null {
  const hits = positions.filter(p => p.intent === 'wheel' && itmShortPutOf(p));
  if (hits.length === 0) return null;
  return { count: hits.length, shares: hits.reduce((sum, p) => sum + Math.abs(p.quantity ?? 1) * 100, 0), symbols: Array.from(new Set(hits.map(p => p.symbol))) };
}

/** "Updated 11:26 AM · 1m ago", amber once older than STALE_AFTER_MS. Null when there is no quote time. */
export const STALE_AFTER_MS = 5 * 60 * 1000;
export function updatedLabel(asOf: string | null | undefined, nowMs: number): { text: string; stale: boolean } | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  const age = Math.max(0, nowMs - t);
  const mins = Math.floor(age / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  const clock = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { text: `Updated ${clock} · ${ago}`, stale: age > STALE_AFTER_MS };
}
