// lib/screener/scanConfig/ccRegistry.ts
//
// SCREENER-CONFIG-0001B -- the covered-call criterion registry: the single source of truth for
// every CC scan control (label, unit, lifecycle, quick selects, summary text), used by the
// configuration modal, the scan summary, and the result receipt.
//
// Every lifecycle below was checked against the engine code, not against comments:
//   DTE range          lib/scans/covered-call-finder.ts selectAllEligibleCcContracts -- an expiration
//                      outside the window is skipped (fetch boundary).
//   Delta range        isEligibleCcLeg -- a call outside the window is never a candidate. UNLIKE CSP
//                      (where delta is a preference) and PMCC (where short delta guides rank).
//   Max bid/ask width  isEligibleCcLeg -- `ask - bid > BID_ASK_MAX` excludes the call. An absolute
//                      dollar width per share, honored (unlike CSP's fixed relative policy).
//   Minimum strike     findBestCoveredCall -- strike below max(stock price, cost basis) is excluded;
//                      only the known values apply; an unknown cost basis is flagged, not enforced.
//   Quote validity     isEligibleCcLeg -- two-sided, uncrossed, finite.
//   Earnings           isEarningsSafeForDte -- a call whose expiration is on or after the earnings date
//                      is excluded individually; no earnings date on file means the check cannot apply.
//   Open interest      buildCcSpreadCandidate -- advisory warning (OI-LIQUIDITY-CHOICE-0001 removed OI
//                      from the gate). UNLIKE PMCC, whose short-leg OI minimum still rejects.
//   Share capacity     findBestCoveredCall -- no available covered contracts means no candidate; the
//                      quantity never exceeds it. Read-only context.

import type { CcRulesType } from '@/lib/scans/constants';
import { oiPresets } from './presets';
import { buildReceiptGroups } from './receipt';
import type { Lifecycle, RangePreset, ReceiptGroup, ScalarPreset, SummaryGroup } from './types';

export type CcRuleKey = keyof CcRulesType;

/** What a CC scan was, or is about to be, configured with. */
export interface CcConfigValues {
  rules: CcRulesType;
  /** Eligible positions selected for this scan, when known (the modal knows; a stored receipt does not). */
  positionsSelected?: number | null;
  /** Covered contracts available across those positions, when known. */
  contractsAvailable?: number | null;
}

export type CcCard = 'holdings' | 'search' | 'advisory' | 'always';

export const CC_CARD_ORDER: readonly CcCard[] = ['search', 'advisory', 'always'];

export const CC_CARD_TITLE: Record<CcCard, string> = {
  holdings: 'Eligible positions',
  search: 'Search range',
  advisory: 'Open interest',
  always: 'Always applied',
};

export type CcControl =
  | { kind: 'range'; minKey: CcRuleKey; maxKey: CcRuleKey; minLabel: string; maxLabel: string; minTitle: string; maxTitle: string; step: string; presets: RangePreset[] }
  | { kind: 'rule'; key: CcRuleKey; label: string; title: string; step: string; presets: ScalarPreset[]; unit: string }
  | { kind: 'info' };

export interface CcCriterion {
  id: string;
  label: string;
  unit: string;
  lifecycle: Lifecycle;
  /** True when the trader cannot change it. */
  fixed: boolean;
  /** True when changing it needs a new scan. */
  rescan: boolean;
  card: CcCard;
  summaryGroup: SummaryGroup;
  hint: string;
  control: CcControl;
  summary: (values: CcConfigValues) => string | null;
}

const num = (n: number) => String(n);
const dollars = (n: number) => `$${n.toFixed(2)}`;

export const CC_CRITERIA: readonly CcCriterion[] = [
  {
    id: 'dte',
    label: 'DTE range',
    unit: 'days',
    lifecycle: 'fetch',
    fixed: false,
    rescan: true,
    card: 'search',
    summaryGroup: 'search',
    hint: 'Expirations outside this range are never fetched. Changing it needs a new scan.',
    control: {
      kind: 'range', minKey: 'DTE_MIN', maxKey: 'DTE_MAX', minLabel: 'Min DTE', maxLabel: 'Max DTE',
      minTitle: 'Earliest expiration to include', maxTitle: 'Latest expiration to include', step: '1',
      presets: [
        { label: '14–21', min: 14, max: 21 },
        { label: '21–45', min: 21, max: 45 },
        { label: '30–45', min: 30, max: 45 },
        { label: '45–60', min: 45, max: 60 },
      ],
    },
    summary: (v) => `${num(v.rules.DTE_MIN)}–${num(v.rules.DTE_MAX)} DTE`,
  },
  {
    id: 'delta',
    label: 'Delta range',
    unit: 'absolute delta',
    lifecycle: 'fetch',
    fixed: false,
    rescan: true,
    card: 'search',
    summaryGroup: 'search',
    hint: 'A hard limit for covered calls: a call outside the range is never a candidate. (For cash-secured puts, delta is only a preference.)',
    control: {
      kind: 'range', minKey: 'DELTA_MIN', maxKey: 'DELTA_MAX', minLabel: 'Min Δ', maxLabel: 'Max Δ',
      minTitle: 'Lower edge of the call delta range', maxTitle: 'Upper edge of the call delta range', step: '0.01',
      presets: [
        { label: 'Δ .10–.20', min: 0.1, max: 0.2 },
        { label: 'Δ .20–.35', min: 0.2, max: 0.35 },
        { label: 'Δ .30–.40', min: 0.3, max: 0.4 },
      ],
    },
    summary: (v) => `Δ ${v.rules.DELTA_MIN.toFixed(2)}–${v.rules.DELTA_MAX.toFixed(2)}`,
  },
  {
    id: 'width',
    label: 'Max bid/ask width',
    unit: '$ per share',
    lifecycle: 'fetch',
    fixed: false,
    rescan: true,
    card: 'search',
    summaryGroup: 'search',
    hint: 'A call whose bid/ask is wider than this is never a candidate. A dollar width per share, not a percentage.',
    control: {
      kind: 'rule', key: 'BID_ASK_MAX', label: 'Max width', title: 'Widest bid/ask spread, in dollars per share', step: '0.01', unit: '$ per share',
      presets: [{ label: '$0.10', value: 0.1 }, { label: '$0.20', value: 0.2 }, { label: '$0.30', value: 0.3 }],
    },
    summary: (v) => `width ≤ ${dollars(v.rules.BID_ASK_MAX)}`,
  },
  {
    id: 'oi',
    label: 'OI min',
    unit: 'contracts',
    lifecycle: 'advisory',
    fixed: false,
    rescan: true,
    card: 'advisory',
    summaryGroup: 'advisory',
    hint: 'Lower open interest is kept and shown with a warning. The results view shows every call by default (Call OI: Any).',
    control: { kind: 'rule', key: 'OI_MIN', label: 'OI min', title: 'Preferred minimum open interest', step: '1', unit: 'contracts', presets: oiPresets() },
    summary: (v) => `OI ${num(v.rules.OI_MIN)}`,
  },
  {
    id: 'minStrike',
    label: 'Minimum strike',
    unit: '',
    lifecycle: 'fetch',
    fixed: true,
    rescan: true,
    card: 'always',
    summaryGroup: 'always',
    hint: 'Calls must sit at or above the stock price, and at or above your cost basis when it is known. If your cost basis is unavailable, the call is kept and flagged.',
    control: { kind: 'info' },
    summary: () => 'strike ≥ stock price (and cost basis when known)',
  },
  {
    id: 'quoteValidity',
    label: 'Quote validity',
    unit: '',
    lifecycle: 'fetch',
    fixed: true,
    rescan: true,
    card: 'always',
    summaryGroup: 'always',
    hint: 'A call needs a two-sided, uncrossed bid and ask.',
    control: { kind: 'info' },
    summary: () => 'two-sided quotes',
  },
  {
    id: 'earnings',
    label: 'Earnings',
    unit: '',
    lifecycle: 'fetch',
    fixed: true,
    rescan: true,
    card: 'always',
    summaryGroup: 'always',
    hint: 'A call that expires on or after the earnings date is excluded, so only calls expiring before earnings qualify. If no earnings date is on file, the check cannot apply.',
    control: { kind: 'info' },
    summary: () => 'expires before earnings',
  },
  {
    id: 'capacity',
    label: 'Share capacity',
    unit: '',
    lifecycle: 'read-only',
    fixed: true,
    rescan: false,
    card: 'always',
    summaryGroup: 'capacity',
    hint: 'Quantity is limited to the covered contracts each position has available. A position with none is skipped.',
    control: { kind: 'info' },
    summary: (v) => {
      if (v.positionsSelected == null) return null;
      const positions = `${v.positionsSelected} position${v.positionsSelected === 1 ? '' : 's'} selected`;
      return v.contractsAvailable == null ? positions : `${positions} · up to ${v.contractsAvailable} contract${v.contractsAvailable === 1 ? '' : 's'}`;
    },
  },
  {
    id: 'resultChips',
    label: 'After the scan',
    unit: '',
    lifecycle: 'result-filter',
    fixed: true,
    rescan: false,
    card: 'always',
    summaryGroup: 'adjustable',
    hint: 'Once results return, the POP, OTM, IVR, and Call OI chips and the sort narrow and reorder the fetched calls. No rescan.',
    control: { kind: 'info' },
    // The card list omits this one (it is a receipt line, not a control), so it is not in a card.
    summary: () => 'POP · OTM · IVR · Call OI chips · sort',
  },
];

/** The criteria shown as controls or fixed rows in the modal, by card. */
export function ccCriteriaForCard(card: CcCard): CcCriterion[] {
  return CC_CRITERIA.filter((c) => c.card === card && c.id !== 'resultChips');
}

export function getCcCriterion(id: string): CcCriterion {
  const found = CC_CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown CC criterion: ${id}`);
  return found;
}

const CC_GROUP_ORDER: readonly SummaryGroup[] = ['search', 'always', 'advisory', 'adjustable', 'capacity'];

/** Counts shown on the result receipt: a CC scan returns one best call per symbol. */
export interface CcResultCounts {
  symbolsWithCandidate: number;
  symbolsWithNone: number;
}

export interface CcReceipt {
  groups: ReceiptGroup[];
  counts: CcResultCounts | null;
}

/** Builds the scan summary (before a run) or the result receipt (after) from the registry. */
export function buildCcReceipt(values: CcConfigValues, counts: CcResultCounts | null = null): CcReceipt {
  return { groups: buildReceiptGroups(CC_CRITERIA, values, CC_GROUP_ORDER), counts };
}

/** The minimum a result needs for the receipt counts. */
export interface CcCountableResult {
  qualified: boolean;
}

export function summarizeCcResults(results: readonly CcCountableResult[]): CcResultCounts {
  const symbolsWithCandidate = results.filter((r) => r.qualified).length;
  return { symbolsWithCandidate, symbolsWithNone: results.length - symbolsWithCandidate };
}

/** Same validation the CC modal always enforced (holdings are checked separately). */
export function ccFieldErrors(rules: CcRulesType): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  const set = (key: string, message: string) => { if (errors[key] == null) errors[key] = message; };
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isFinite(value)) set(key, 'Enter a number.');
  }
  if (!(rules.DTE_MIN >= 0)) set('DTE_MIN', 'Min DTE must be 0 or more.');
  if (!(rules.DTE_MAX > rules.DTE_MIN)) set('DTE_MAX', 'Max DTE must be above min DTE.');
  if (!(rules.DELTA_MIN >= 0)) set('DELTA_MIN', 'Min delta must be 0 or more.');
  if (!(rules.DELTA_MAX <= 1)) set('DELTA_MAX', 'Max delta must be 1 or less.');
  if (!(rules.DELTA_MAX > rules.DELTA_MIN)) set('DELTA_MAX', 'Max delta must be above min delta.');
  if (!(rules.OI_MIN >= 0)) set('OI_MIN', 'Open interest must be 0 or more.');
  if (!(rules.BID_ASK_MAX >= 0)) set('BID_ASK_MAX', 'Max width must be 0 or more.');
  return errors;
}
