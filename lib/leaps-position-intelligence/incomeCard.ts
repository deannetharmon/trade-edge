// lib/leaps-position-intelligence/incomeCard.ts
//
// LEAPS-POS-0001 -- the numbers and callouts for the Positions "PMCC income" card on a held LEAPS. Pure and rule-based:
// every value is arithmetic on the position's own facts and the live short-call candidate; there is no model, no forecast
// and no recommendation. Anything that cannot be computed is a dash, never a guess.
//
// Ian's rules (2026-09-20): breakeven is the floor for a short strike; "if assigned" is the strike width less the net debit;
// credit is compared to the LEAPS's extrinsic per month as a displayed fact; event data that is not checked is said plainly.

import { money, pct, type DashboardCallout, type DashboardTile, type DashboardTone } from '@/lib/leaps-analysis/dashboard';
import { EXISTING_LEAPS_REVIEW_DTE } from './policy';

export interface IncomeCardLongCall {
  strike: number; dte: number; quantity: number;
  /** Original entry premium per share (broker average open price). */
  entryDebitPerShare: number | null;
  /** Current mark per share. */
  markPerShare: number | null;
  delta: number | null;
  /** Underlying price from the portfolio snapshot. */
  stockPrice: number | null;
}
export interface IncomeCardCandidate { strike: number; dte: number; delta: number; /** Executable credit per share. */ credit: number; spreadPct: number | null; openInterest: number }
export interface IncomeCard { longTiles: DashboardTile[]; candidateTiles: DashboardTile[]; callouts: DashboardCallout[] }

const TONE_RANK: Record<DashboardTone, number> = { bad: 0, watch: 1, good: 2, neutral: 3 };
const SHARES = 100;
const tile = (id: string, label: string, value: string, tone: DashboardTone, parts: Array<{ text: string; tone: DashboardTone }> = []): DashboardTile => ({ id, label, value, tone, parts });
export const signedMoney = (value: number) => `${value < 0 ? '-' : '+'}${money(Math.abs(Math.round(value * 100) / 100))}`;

/** "Value (mark)" for the held LEAPS: current mark against what was paid. Shared by the income card and the cycle card. */
export function longValueTile(l: IncomeCardLongCall): DashboardTile {
  const mark = l.markPerShare;
  const entry = l.entryDebitPerShare;
  if (mark != null && entry != null) {
    const value = mark * SHARES * l.quantity;
    const paid = entry * SHARES * l.quantity;
    const change = value - paid;
    const tone: DashboardTone = change >= 0 ? 'good' : 'watch';
    return tile('value', 'Value (mark)', money(Math.round(value * 100) / 100), 'neutral', [{ text: `${signedMoney(change)}${paid > 0 ? ` · ${change >= 0 ? '+' : '-'}${pct(Math.abs(change / paid) * 100)}` : ''} vs paid`, tone }]);
  }
  return tile('value', 'Value (mark)', mark != null ? money(Math.round(mark * SHARES * l.quantity * 100) / 100) : '—', 'neutral', [{ text: 'entry cost unavailable', tone: 'neutral' }]);
}

/** "Breakeven at expiry": LEAPS strike plus entry cost, against the stock. */
export function longBreakevenTile(l: IncomeCardLongCall): DashboardTile {
  const entry = l.entryDebitPerShare;
  if (entry == null) return tile('breakeven', 'Breakeven at expiry', '—', 'neutral', [{ text: 'needs your entry cost', tone: 'neutral' }]);
  const breakeven = l.strike + entry;
  const above = l.stockPrice != null && l.stockPrice > 0 ? (breakeven / l.stockPrice - 1) * 100 : null;
  const tone: DashboardTone = above == null ? 'neutral' : above > 0 ? 'watch' : 'good';
  return tile('breakeven', 'Breakeven at expiry', money(Math.round(breakeven * 100) / 100), tone, above == null ? [{ text: 'stock price unavailable', tone: 'neutral' }] : [{ text: above > 0 ? `+${pct(above)} above stock` : `${pct(Math.abs(above))} below stock`, tone }]);
}

/**
 * `events`: callouts from buildEventCallouts (LEAPS-EVENTS-0001). When omitted the card keeps its standing "not checked yet" note.
 */
export function buildIncomeCard(input: { longCall: IncomeCardLongCall; candidate: IncomeCardCandidate | null; reviewDte?: number; events?: DashboardCallout[] }): IncomeCard {
  const { longCall: l, candidate: c } = input;
  const reviewDte = input.reviewDte ?? EXISTING_LEAPS_REVIEW_DTE;
  const contracts = l.quantity;
  const entry = l.entryDebitPerShare;
  const mark = l.markPerShare;
  const breakeven = entry != null ? l.strike + entry : null;

  // ---- the long LEAPS ---------------------------------------------------------------------------------------------
  const longTiles: DashboardTile[] = [longValueTile(l), longBreakevenTile(l)];
  longTiles.push(tile('dte', 'DTE left', String(l.dte), l.dte < reviewDte ? 'watch' : 'neutral', [{ text: `review point ${reviewDte} days`, tone: l.dte < reviewDte ? 'watch' : 'neutral' }]));
  longTiles.push(tile('delta', 'Delta', l.delta == null ? '—' : l.delta.toFixed(2), 'neutral'));

  // ---- the income call under review -------------------------------------------------------------------------------
  const candidateTiles: DashboardTile[] = [];
  const callouts: DashboardCallout[] = [];
  if (c) {
    const creditTotal = c.credit * SHARES * contracts;
    const cost = entry != null ? entry * SHARES * contracts : null;
    candidateTiles.push(tile('credit', 'Credit', money(Math.round(creditTotal * 100) / 100), 'neutral', cost != null && cost > 0 ? [{ text: `${pct((creditTotal / cost) * 100)} of LEAPS cost`, tone: 'neutral' }] : [{ text: 'bid basis', tone: 'neutral' }]));

    const clears = breakeven != null ? c.strike >= breakeven : null;
    const vsBreakeven = breakeven != null && breakeven > 0 ? (c.strike / breakeven - 1) * 100 : null;
    const strikeTone: DashboardTone = clears == null ? 'neutral' : clears ? 'good' : 'bad';
    candidateTiles.push(tile('short-strike', 'Short strike', money(c.strike), strikeTone, vsBreakeven == null ? [{ text: 'breakeven unknown', tone: 'neutral' }] : [{ text: vsBreakeven >= 0 ? `+${pct(vsBreakeven)} above breakeven` : `${pct(Math.abs(vsBreakeven))} below breakeven`, tone: strikeTone }]));

    if (entry != null) {
      const ifAssigned = (c.strike - l.strike - (entry - c.credit)) * SHARES * contracts;
      candidateTiles.push(tile('if-assigned', 'If assigned', signedMoney(ifAssigned), ifAssigned >= 0 ? 'good' : 'bad', [{ text: 'strike width less net debit · before fees', tone: 'neutral' }]));
    } else {
      candidateTiles.push(tile('if-assigned', 'If assigned', '—', 'neutral', [{ text: 'needs your entry cost', tone: 'neutral' }]));
    }
    candidateTiles.push(l.delta != null
      ? tile('delta-kept', 'Delta kept', (l.delta - c.delta).toFixed(2), 'neutral', [{ text: `${l.delta.toFixed(2)} long − ${c.delta.toFixed(2)} short`, tone: 'neutral' }])
      : tile('delta-kept', 'Delta kept', '—', 'neutral'));

    if (clears === true) callouts.push({ id: 'floor', tone: 'good', text: 'Short strike clears your LEAPS breakeven at expiration.' });
    if (clears === false) callouts.push({ id: 'floor', tone: 'bad', text: 'Short strike is below your LEAPS breakeven: an assignment would lock in a loss.' });
    if (mark != null && l.stockPrice != null && l.dte > 0) {
      const extrinsic = Math.max(0, mark - Math.max(l.stockPrice - l.strike, 0));
      const perMonth = extrinsic / (l.dte / 30);
      if (perMonth > 0) {
        const ratio = c.credit / perMonth;
        callouts.push(ratio >= 1
          ? { id: 'extrinsic-carry', tone: 'good', text: `Credit is ${ratio.toFixed(1)}× the LEAPS's extrinsic value per month (if price is flat).` }
          : { id: 'extrinsic-carry', tone: 'watch', text: `Credit is ${ratio.toFixed(1)}× the LEAPS's extrinsic value per month: less than the LEAPS loses in a flat month.` });
      }
    }
    if (input.events === undefined) callouts.push({ id: 'events', tone: 'watch', text: 'Earnings and ex-dividend dates are not checked here yet: check them before selling.' });
    else callouts.push(...input.events);
  }
  if (l.dte < reviewDte) callouts.push({ id: 'dte', tone: 'watch', text: `LEAPS has ${l.dte} days left: past your ${reviewDte}-day review point.` });
  if (entry == null) callouts.push({ id: 'entry', tone: 'watch', text: 'Entry cost is missing, so breakeven and the if-assigned result are unavailable.' });

  callouts.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return { longTiles, candidateTiles, callouts };
}
