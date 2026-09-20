// lib/leaps-position-intelligence/cycleCard.ts
//
// LEAPS-POS-0002 -- the Positions card for a held LEAPS that has a short call open against it (an "open cycle"): how much of the
// credit is captured, how much time is left, how much room the stock has, and what an assignment would mean. Pure and
// rule-based: arithmetic on the two positions' own facts, no model, no forecast, no recommendation. Whatever cannot be computed
// is a dash.
//
// The three thresholds below are Ian's proposed defaults (2026-09-20) and are meant to be editable rules; they are pinned by tests.

import { money, pct, type DashboardCallout, type DashboardTile, type DashboardTone } from '@/lib/leaps-analysis/dashboard';
import { longBreakevenTile, longValueTile, signedMoney, type IncomeCardLongCall } from './incomeCard';

export const CYCLE_CARD_POLICY = {
  /** At or above this share of the credit captured, the call is at its review point (close or roll is a decision to make). */
  captureReviewPct: 50,
  /** At or below this many days to the short call's expiry, the roll-or-close window is open. */
  rollWindowDte: 21,
  /** A stock within this % below the short strike is called out as close to it. */
  nearStrikePct: 3,
} as const;

export interface CycleShortCall {
  strike: number; dte: number; quantity: number;
  /** Premium received per share when the call was sold. */
  soldPerShare: number | null;
  /** Current price to buy the call back, per share. */
  markPerShare: number | null;
  delta: number | null;
}
export interface CycleCard { shortTiles: DashboardTile[]; longTiles: DashboardTile[]; callouts: DashboardCallout[]; windowOpen: boolean }

const TONE_RANK: Record<DashboardTone, number> = { bad: 0, watch: 1, good: 2, neutral: 3 };
const SHARES = 100;
const tile = (id: string, label: string, value: string, tone: DashboardTone, parts: Array<{ text: string; tone: DashboardTone }> = []): DashboardTile => ({ id, label, value, tone, parts });
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * `events`: callouts from buildEventCallouts (LEAPS-EVENTS-0001). When omitted, the card falls back to the standing note shown only
 * when the stock is close to the strike.
 */
export function buildCycleCard(input: { longCall: IncomeCardLongCall; short: CycleShortCall; events?: DashboardCallout[] }): CycleCard {
  const { longCall: l, short: s } = input;
  const policy = CYCLE_CARD_POLICY;
  const contracts = s.quantity;
  const entry = l.entryDebitPerShare;
  const breakeven = entry != null ? l.strike + entry : null;
  const captured = s.soldPerShare != null && s.soldPerShare > 0 && s.markPerShare != null ? ((s.soldPerShare - s.markPerShare) / s.soldPerShare) * 100 : null;
  const room = l.stockPrice != null && l.stockPrice > 0 ? (s.strike / l.stockPrice - 1) * 100 : null; // > 0: stock below strike
  const windowOpen = s.dte <= policy.rollWindowDte;

  // ---- the short call --------------------------------------------------------------------------------------------
  const capturedTone: DashboardTone = captured == null ? 'neutral' : captured >= policy.captureReviewPct ? 'good' : captured < 0 ? 'watch' : 'neutral';
  const shortTiles: DashboardTile[] = [
    tile('captured', 'Premium captured', captured == null ? '—' : `${captured.toFixed(0)}%`, capturedTone,
      s.soldPerShare != null && s.markPerShare != null ? [{ text: `sold ${money(s.soldPerShare)} · now ${money(s.markPerShare)}`, tone: 'neutral' }] : [{ text: 'needs the sold price', tone: 'neutral' }]),
    tile('dte', 'DTE left', String(s.dte), windowOpen ? 'watch' : 'neutral', [{ text: `roll window opens at ${policy.rollWindowDte} days`, tone: windowOpen ? 'watch' : 'neutral' }]),
  ];
  const stockTone: DashboardTone = room == null ? 'neutral' : room <= 0 ? 'bad' : room < policy.nearStrikePct ? 'watch' : 'good';
  shortTiles.push(tile('room', 'Stock vs strike', room == null ? '—' : pct(Math.abs(room)), stockTone,
    room == null ? [{ text: 'stock price unavailable', tone: 'neutral' }] : [{ text: `${room > 0 ? 'below' : 'at or above'} ${money(s.strike)} strike`, tone: stockTone }]));
  if (entry != null && s.soldPerShare != null) {
    const ifAssigned = (s.strike - l.strike - (entry - s.soldPerShare)) * SHARES * contracts;
    shortTiles.push(tile('if-assigned', 'If assigned', signedMoney(ifAssigned), ifAssigned >= 0 ? 'good' : 'bad', [{ text: 'strike width less net debit · before fees', tone: 'neutral' }]));
  } else {
    shortTiles.push(tile('if-assigned', 'If assigned', '—', 'neutral', [{ text: 'needs your entry cost and the sold price', tone: 'neutral' }]));
  }

  // ---- the long LEAPS --------------------------------------------------------------------------------------------
  const longTiles: DashboardTile[] = [longValueTile(l), longBreakevenTile(l)];
  longTiles.push(l.delta != null && s.delta != null
    ? tile('net-delta', 'Net delta kept', (l.delta - s.delta).toFixed(2), 'neutral', [{ text: `${l.delta.toFixed(2)} long − ${s.delta.toFixed(2)} short`, tone: 'neutral' }])
    : tile('net-delta', 'Net delta kept', '—', 'neutral'));
  if (s.soldPerShare != null && s.markPerShare != null) {
    const income = (s.soldPerShare - s.markPerShare) * SHARES * contracts;
    longTiles.push(tile('income', 'Income so far', signedMoney(round2(income)), income >= 0 ? 'good' : 'watch', [{ text: 'credit less the cost to close now', tone: 'neutral' }]));
  } else {
    longTiles.push(tile('income', 'Income so far', '—', 'neutral'));
  }

  // ---- callouts ---------------------------------------------------------------------------------------------------
  const callouts: DashboardCallout[] = [];
  if (captured != null && captured >= policy.captureReviewPct) callouts.push({ id: 'captured', tone: 'good', text: `${captured.toFixed(0)}% of the credit is captured: past your ${policy.captureReviewPct}% review point.` });
  if (captured != null && captured < 0) callouts.push({ id: 'captured', tone: 'watch', text: `The call is worth ${pct(Math.abs(captured), 0)} more than you sold it for.` });
  if (windowOpen) callouts.push({ id: 'window', tone: 'watch', text: `${s.dte} days left: your roll-or-close window is open.` });
  if (room != null && room <= 0) callouts.push({ id: 'room', tone: 'bad', text: 'Stock is at or above the short strike: the call is in the money and can be assigned.' });
  else if (room != null && room < policy.nearStrikePct) callouts.push({ id: 'room', tone: 'watch', text: `Stock is only ${pct(room)} below the short strike.` });
  if (input.events !== undefined) callouts.push(...input.events);
  else if (room != null && room < policy.nearStrikePct) callouts.push({ id: 'events', tone: 'watch', text: 'Earnings and ex-dividend dates are not checked here yet: an in-the-money call can be assigned early, especially near an ex-dividend date.' });
  if (breakeven != null) {
    const above = (s.strike / breakeven - 1) * 100;
    callouts.push(s.strike >= breakeven
      ? { id: 'floor', tone: 'good', text: `The short strike is still ${pct(above)} above your LEAPS breakeven at expiry.` }
      : { id: 'floor', tone: 'bad', text: 'The short strike is below your LEAPS breakeven: an assignment would lock in a loss.' });
  } else {
    callouts.push({ id: 'entry', tone: 'watch', text: 'Entry cost is missing, so breakeven and the if-assigned result are unavailable.' });
  }
  callouts.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return { shortTiles, longTiles, callouts, windowOpen };
}
