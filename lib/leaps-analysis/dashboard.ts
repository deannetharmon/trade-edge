// lib/leaps-analysis/dashboard.ts
//
// LEAPS-DASH-0001 -- the dashboard view of "Analyze with AI": six number tiles and short callouts, all computed
// here by rule from the server-resolved snapshot. No AI is involved, so the dashboard reads the same whether or
// not the model ran or was available; the AI explanation, when present, sits behind "Read full analysis".
//
// Thresholds are Ian's (2026-09-20) and live in LEAPS_DASHBOARD_POLICY so they can be tuned in one place.
// Every callout says what the number means; none recommends an action.

import type { PmccStartPrice } from '@/lib/scans/pmccStartPrice';

export type DashboardTone = 'good' | 'watch' | 'bad' | 'neutral';

export interface DashboardPart { text: string; tone: DashboardTone }
export interface DashboardTile { id: string; label: string; value: string; parts: DashboardPart[]; tone: DashboardTone }
export interface DashboardCallout { id: string; tone: DashboardTone; text: string }
export interface DashboardChip { id: string; text: string; tone: DashboardTone }
export interface LeapsDashboard { chips: DashboardChip[]; ruleLine: string; tiles: DashboardTile[]; callouts: DashboardCallout[] }

export const LEAPS_DASHBOARD_POLICY = {
  /** At or below this extrinsic % of cost the contract is "mostly intrinsic". */
  mostlyIntrinsicMaxExtrinsicPct: 15,
  /** IVR below this: cheap to buy, thin premium to sell calls against (matches the Prosper premium-selling floor). */
  ivrLow: 30,
  /** IVR at or above this: expensive to buy, calls you sell pay well. */
  ivrHigh: 50,
  /** A spread above this % of the option's mid is called out (the hard limit is the scan's own spread gate). */
  spreadWatchPct: 5,
} as const;

/** The parts of the analysis snapshot the dashboard reads (a structural subset of the stored snapshot). */
export interface DashboardSnapshot {
  createdAt: string;
  contract: { delta: number | null; bid: number | null; ask: number | null; multiplier: number; quoteBasis?: 'live' | 'last_session'; optionQuoteTimestamp: string | null };
  criteria: { deltaMin: number; deltaMax: number; dteMin: number; dteMax: number | null; oiMin: number; extrinsicPctMax: number | null; spreadPctMax: number; source: 'scan_filters' | 'server_default' } | null;
  qualification: { status: string; extrinsicPctOfCost: number | null; spreadPct: number | null; gates: Array<{ id: string; status: string; message: string }> };
  mechanics: Record<string, number | null>;
}

export interface LeapsDashboardInput {
  snapshot: DashboardSnapshot;
  /** False when a newer analysis exists for this contract. */
  current: boolean;
  ivRank: number | null;
  ivx: number | null;
  pmccStart: PmccStartPrice;
  /** Formats an ISO time for display (locale-specific, so supplied by the caller). */
  formatTimestamp?: (iso: string) => string;
}

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
const pct = (value: number, digits = 1): string => `${value.toFixed(digits)}%`;
const TONE_RANK: Record<DashboardTone, number> = { bad: 0, watch: 1, good: 2, neutral: 3 };

const STATUS_TONE: Record<string, DashboardTone> = { CONTRACT_QUALIFIED: 'good', REVIEW_REQUIRED: 'watch', NOT_QUALIFIED: 'bad', DATA_UNAVAILABLE: 'watch' };

export function buildLeapsDashboard(input: LeapsDashboardInput): LeapsDashboard {
  const { snapshot, current, ivRank, ivx, pmccStart } = input;
  const formatTimestamp = input.formatTimestamp ?? ((iso: string) => iso);
  const policy = LEAPS_DASHBOARD_POLICY;
  const { contract, criteria, qualification, mechanics } = snapshot;

  // ---- chips and rule line -------------------------------------------------
  const chips: DashboardChip[] = [{ id: 'status', text: qualification.status.replaceAll('_', ' '), tone: STATUS_TONE[qualification.status] ?? 'watch' }];
  if (contract.quoteBasis === 'last_session') chips.push({ id: 'prior-session', text: 'PRIOR-SESSION QUOTES', tone: 'watch' });
  chips.push(current
    ? { id: 'snapshot', text: `Snapshot ${formatTimestamp(snapshot.createdAt)}`, tone: 'neutral' }
    : { id: 'snapshot', text: 'Older saved snapshot', tone: 'watch' });

  const ruleLine = criteria
    ? `${criteria.source === 'scan_filters' ? 'Judged against your scan filters' : 'Judged against default limits'}: Δ ${criteria.deltaMin.toFixed(2)}–${criteria.deltaMax.toFixed(2)} · DTE ${criteria.dteMin}${criteria.dteMax != null ? `–${criteria.dteMax}` : '+'} · OI ≥ ${criteria.oiMin} · ${criteria.extrinsicPctMax == null ? 'no extrinsic ceiling set' : `Extrinsic ≤ ${criteria.extrinsicPctMax}%`}`
    : '';

  // ---- tiles ---------------------------------------------------------------
  const tiles: DashboardTile[] = [];

  const delta = contract.delta;
  const deltaIn = delta != null && criteria ? delta >= criteria.deltaMin && delta <= criteria.deltaMax : null;
  const deltaTone: DashboardTone = deltaIn == null ? 'neutral' : deltaIn ? 'good' : 'bad';
  tiles.push({
    id: 'delta', label: 'Delta', value: delta == null ? '—' : delta.toFixed(2), tone: deltaTone,
    parts: criteria && delta != null ? [{ text: `${deltaIn ? 'in' : 'outside'} your ${criteria.deltaMin.toFixed(2)}–${criteria.deltaMax.toFixed(2)}`, tone: deltaTone }] : [],
  });

  const extrinsicPct = qualification.extrinsicPctOfCost;
  const extrinsicPerShare = mechanics.extrinsicPerShare;
  const cap = criteria?.extrinsicPctMax ?? null;
  const extrinsicTone: DashboardTone = extrinsicPct == null ? 'neutral' : cap == null ? 'neutral' : extrinsicPct > cap ? 'bad' : 'good';
  tiles.push({
    id: 'extrinsic', label: 'Extrinsic', value: extrinsicPct == null ? '—' : pct(extrinsicPct), tone: extrinsicTone,
    parts: extrinsicPct == null ? [] : [{ text: `${extrinsicPerShare != null ? `${money(extrinsicPerShare)} · ` : ''}${cap == null ? 'no cap set' : `${extrinsicPct > cap ? 'over' : 'under'} your ${cap}% cap`}`, tone: extrinsicTone }],
  });

  const spreadPct = qualification.spreadPct;
  const spreadDollars = contract.bid != null && contract.ask != null ? (contract.ask - contract.bid) * contract.multiplier : null;
  const spreadLimit = criteria?.spreadPctMax ?? null;
  const spreadTone: DashboardTone = spreadPct == null ? 'neutral' : spreadLimit != null && spreadPct > spreadLimit ? 'bad' : 'good';
  tiles.push({
    id: 'spread', label: 'Spread', value: spreadPct == null ? '—' : pct(spreadPct), tone: spreadTone,
    parts: spreadPct == null ? [] : [{ text: `${spreadDollars != null ? `${money(Math.round(spreadDollars * 100) / 100)} / contract` : ''}${spreadLimit != null ? `${spreadDollars != null ? ' · ' : ''}${spreadPct > spreadLimit ? 'over' : 'under'} ${spreadLimit}% limit` : ''}`, tone: spreadTone }],
  });

  const breakeven = mechanics.breakeven;
  const breakevenPct = mechanics.breakevenPctAboveSpot;
  const breakevenTone: DashboardTone = breakevenPct == null ? 'neutral' : breakevenPct > 0 ? 'watch' : 'good';
  tiles.push({
    id: 'breakeven', label: 'Breakeven at expiry', value: breakeven == null ? '—' : money(breakeven), tone: breakevenTone,
    parts: breakevenPct == null ? [] : [{ text: breakevenPct > 0 ? `+${pct(breakevenPct)} above price` : `${pct(Math.abs(breakevenPct))} below price`, tone: breakevenTone }],
  });

  const pmccTone: DashboardTone = pmccStart.status === 'above' ? 'good' : pmccStart.status === 'below' ? 'watch' : 'neutral';
  tiles.push({
    id: 'pmcc-start', label: 'PMCC start ≥', value: pmccStart.startPrice == null ? '—' : money(pmccStart.startPrice), tone: pmccTone,
    parts: pmccStart.status === 'above' ? [{ text: 'stock above · est.', tone: 'good' }]
      : pmccStart.status === 'below' ? [{ text: `needs +${pct(pmccStart.pctToStart ?? 0)} · est.`, tone: 'watch' }]
      : [{ text: 'needs IVx', tone: 'neutral' }],
  });

  const ivrParts: DashboardPart[] = ivRank == null ? [] : ivRank < policy.ivrLow
    ? [{ text: 'cheap to buy', tone: 'good' }, { text: 'thin to sell', tone: 'watch' }]
    : ivRank >= policy.ivrHigh
      ? [{ text: 'pricey to buy', tone: 'watch' }, { text: 'rich to sell', tone: 'good' }]
      : [{ text: ivx != null ? `IVx ${pct(ivx)}` : 'mid range', tone: 'neutral' }];
  tiles.push({ id: 'ivr', label: 'IVR', value: ivRank == null ? '—' : `${ivRank.toFixed(0)}%`, tone: ivRank == null ? 'neutral' : ivRank < policy.ivrLow || ivRank >= policy.ivrHigh ? 'watch' : 'neutral', parts: ivrParts });

  // ---- callouts ------------------------------------------------------------
  const callouts: DashboardCallout[] = [];
  for (const gate of qualification.gates) {
    if (gate.status === 'fail') callouts.push({ id: `gate-${gate.id}`, tone: 'bad', text: gate.message });
    else if (gate.status === 'unavailable') callouts.push({ id: `gate-${gate.id}`, tone: 'watch', text: gate.message });
  }
  if (qualification.status === 'REVIEW_REQUIRED') {
    callouts.push({ id: 'discovery', tone: 'watch', text: 'Extrinsic ceiling not set: explaining mechanics only, contract not fully qualified. Set an extrinsic ceiling to fully qualify.' });
  }
  if (contract.quoteBasis === 'last_session') {
    callouts.push({ id: 'prior-session', tone: 'watch', text: `Quotes are from the prior session${contract.optionQuoteTimestamp ? ` (option quote ${formatTimestamp(contract.optionQuoteTimestamp)})` : ''}. Re-check pricing after the market opens.` });
  }
  if (extrinsicPct != null) {
    callouts.push(extrinsicPct <= policy.mostlyIntrinsicMaxExtrinsicPct
      ? { id: 'extrinsic', tone: 'good', text: 'Mostly intrinsic value: little extrinsic value at risk.' }
      : { id: 'extrinsic', tone: 'watch', text: `Extrinsic value is ${pct(extrinsicPct)} of cost: some time value at risk.` });
  }
  if (breakevenPct != null) {
    callouts.push(breakevenPct > 0
      ? { id: 'breakeven', tone: 'watch', text: `Stock needs to rise ${pct(breakevenPct)} to break even at expiration.` }
      : { id: 'breakeven', tone: 'good', text: `Stock is already ${pct(Math.abs(breakevenPct))} above breakeven at expiration.` });
  }
  if (ivRank != null && ivRank < policy.ivrLow) callouts.push({ id: 'ivr', tone: 'watch', text: `IVR ${ivRank.toFixed(0)}%: cheap to buy, but thin premium to sell calls against it.` });
  if (ivRank != null && ivRank >= policy.ivrHigh) callouts.push({ id: 'ivr', tone: 'watch', text: `IVR ${ivRank.toFixed(0)}%: expensive to buy, but calls you sell against it pay well.` });
  if (pmccStart.status === 'below') callouts.push({ id: 'pmcc-start', tone: 'watch', text: `Stock is ${pct(pmccStart.pctToStart ?? 0)} below its PMCC start price (estimate).` });
  if (pmccStart.status === 'above') callouts.push({ id: 'pmcc-start', tone: 'good', text: 'Stock is above its PMCC start price (estimate): a first call can clear breakeven.' });
  if (spreadPct != null && spreadPct > policy.spreadWatchPct && !(spreadLimit != null && spreadPct > spreadLimit)) {
    callouts.push({ id: 'spread', tone: 'watch', text: `Spread is ${pct(spreadPct)}${spreadDollars != null ? `: about ${money(Math.round(spreadDollars))} per contract to cross` : ''}.` });
  }

  callouts.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]); // stable: failures first, then watch, then good
  return { chips, ruleLine, tiles, callouts };
}
