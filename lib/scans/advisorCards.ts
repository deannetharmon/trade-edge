// lib/scans/advisorCards.ts
//
// LEAPS-DASH-0004 -- tiles and callouts for the Covered Call and PMCC advisor pick cards. Pure and rule-based: every number is read from
// the scan result itself and every callout is arithmetic on it; the advisor's AI text only chose the picks and explains them.
// (The LEAPS advisor's equivalent is buildLeapsPickSummary in lib/leaps-analysis/dashboard.ts.)

import { LEAPS_DASHBOARD_POLICY, money, pct, type DashboardCallout, type DashboardTile, type DashboardTone, type LeapsPickSummary } from '@/lib/leaps-analysis/dashboard';

export const ADVISOR_CARD_POLICY = {
  /** A strike within this % of the stock is called out as close to it (same band as the Positions cycle card). */
  nearStrikePct: 3,
  /** A short-call spread above this % is called out (same threshold as the LEAPS dashboard). */
  spreadWatchPct: LEAPS_DASHBOARD_POLICY.spreadWatchPct,
} as const;

const TONE_RANK: Record<DashboardTone, number> = { bad: 0, watch: 1, good: 2, neutral: 3 };
const tile = (id: string, label: string, value: string, tone: DashboardTone = 'neutral'): DashboardTile => ({ id, label, value, tone, parts: [] });
const sorted = (callouts: DashboardCallout[]) => callouts.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

export interface CcPickInput {
  strike: number; dte: number; delta: number | null;
  premiumPerContract: number | null; annualizedYieldPct: number | null;
  /** % the strike sits above the stock (positive = out of the money). */
  strikeVsStockPct: number | null;
  /** % the strike sits above your cost basis (negative = below it). */
  strikeVsCostBasisPct: number | null;
}

export function buildCcPickSummary(c: CcPickInput): LeapsPickSummary {
  const room = c.strikeVsStockPct;
  const tiles: DashboardTile[] = [
    tile('premium', 'Premium', c.premiumPerContract == null ? '—' : money(c.premiumPerContract)),
    tile('yield', 'Yield / yr', c.annualizedYieldPct == null ? '—' : pct(c.annualizedYieldPct)),
    tile('delta', 'Delta', c.delta == null ? '—' : c.delta.toFixed(2)),
    tile('dte', 'DTE', String(c.dte)),
    tile('room', 'Room to strike', room == null ? '—' : `${room >= 0 ? '+' : '-'}${pct(Math.abs(room))}`, room == null ? 'neutral' : room <= 0 ? 'bad' : room < ADVISOR_CARD_POLICY.nearStrikePct ? 'watch' : 'neutral'),
  ];
  const callouts: DashboardCallout[] = [];
  if (c.strikeVsCostBasisPct != null) {
    callouts.push(c.strikeVsCostBasisPct >= 0
      ? { id: 'cost-basis', tone: 'good', text: `Strike is ${pct(c.strikeVsCostBasisPct)} above your cost basis.` }
      : { id: 'cost-basis', tone: 'bad', text: `Strike is ${pct(Math.abs(c.strikeVsCostBasisPct))} below your cost basis: an assignment would lock in a loss.` });
  }
  if (room != null && room <= 0) callouts.push({ id: 'room', tone: 'bad', text: 'Strike is at or below the stock: the call is in the money.' });
  else if (room != null && room < ADVISOR_CARD_POLICY.nearStrikePct) callouts.push({ id: 'room', tone: 'watch', text: `Stock is only ${pct(room)} below the strike.` });
  return { tiles, callouts: sorted(callouts) };
}

export interface PmccPickInput {
  shortStrike: number; shortDte: number; shortDelta: number;
  /** Executable credit per share for the short call. */
  shortCredit: number;
  shortSpreadPct: number | null;
  underlyingPrice: number | null;
  netDebitPerShare: number | null;
  strikeWidth: number | null;
  widthMinusDebitPerShare: number | null;
}

export function buildPmccPickSummary(c: PmccPickInput): LeapsPickSummary {
  const debitOfWidth = c.netDebitPerShare != null && c.strikeWidth != null && c.strikeWidth > 0 ? (c.netDebitPerShare / c.strikeWidth) * 100 : null;
  const spreadTone: DashboardTone = c.shortSpreadPct == null ? 'neutral' : c.shortSpreadPct > ADVISOR_CARD_POLICY.spreadWatchPct ? 'watch' : 'neutral';
  const tiles: DashboardTile[] = [
    tile('credit', 'Credit', money(Math.round(c.shortCredit * 100 * 100) / 100)),
    tile('delta', 'Short Δ', c.shortDelta.toFixed(2)),
    tile('dte', 'Short DTE', String(c.shortDte)),
    tile('debit-width', 'Debit / width', debitOfWidth == null ? '—' : `${debitOfWidth.toFixed(0)}%`),
    tile('spread', 'Spread', c.shortSpreadPct == null ? '—' : pct(c.shortSpreadPct), spreadTone),
  ];
  const callouts: DashboardCallout[] = [];
  if (c.widthMinusDebitPerShare != null) {
    const maxProfit = c.widthMinusDebitPerShare * 100;
    callouts.push(maxProfit > 0
      ? { id: 'max-profit', tone: 'good', text: `Max profit at the short strike is ${money(Math.round(maxProfit * 100) / 100)} a contract (strike width less net debit).` }
      : { id: 'max-profit', tone: 'bad', text: 'Net debit is at or above the strike width: there is no profit at the short strike.' });
  }
  if (c.shortSpreadPct != null && c.shortSpreadPct > ADVISOR_CARD_POLICY.spreadWatchPct) callouts.push({ id: 'spread', tone: 'watch', text: `Short-call spread is ${pct(c.shortSpreadPct)}: wider than usual to cross.` });
  if (c.underlyingPrice != null && c.underlyingPrice > 0) {
    const room = (c.shortStrike / c.underlyingPrice - 1) * 100;
    if (room <= 0) callouts.push({ id: 'room', tone: 'bad', text: 'Short strike is at or below the stock: the call is in the money.' });
    else if (room < ADVISOR_CARD_POLICY.nearStrikePct) callouts.push({ id: 'room', tone: 'watch', text: `Stock is only ${pct(room)} below the short strike.` });
  }
  return { tiles, callouts: sorted(callouts) };
}
