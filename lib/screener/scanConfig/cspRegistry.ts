// lib/screener/scanConfig/cspRegistry.ts
//
// SCREENER-CONFIG-0001A -- the CSP criterion registry. This is the single source
// of truth for every CSP scan control: its trader-facing label, unit, lifecycle,
// off state, quick selects, and summary text. The configuration modal renders from
// it, and the pre-run summary and the result receipt are built from it, so a label
// can never drift between screens.
//
// Every lifecycle below was checked against the engine, not against comments:
//   DTE                  lib/scans/cspSearch.ts  -- an expiration outside the window is skipped
//                                                   (the only fetch boundary).
//   Delta band           cspSearch.ts            -- every quote-valid put in the DTE window is
//                                                   kept; the band sets deltaTargetPassing and the
//                                                   ranking. cspQualification.ts: outside the band
//                                                   cannot be a Best Opportunity.
//   POP / OTM / ROC      page.tsx runCspScan     -- cspModeQualification FAILED (Targeted only);
//                                                   the candidate is kept with its reasons.
//   Bid/ask liquidity    cspQualification.ts     -- classifyCspLiquidity, a FIXED relative policy.
//                                                   `bidAskMax` no longer governs pass/fail.
//   Open interest        csp-finder.ts           -- advisory warning; literal zero OI cannot be a
//                                                   Best Opportunity.
//   IVR cap / floor      lib/scans/cspIvrPolicy.ts -- above the cap disqualifies; an unavailable IVR
//                                                   disqualifies too (CSP-IVR-0001); below the floor
//                                                   ranks lower.
//   Earnings             csp-finder.ts           -- DISQUALIFIED_EARNINGS.
//   Affordable only      page.tsx runCspScan     -- optional display filter on account eligibility.

import type { CspRulesType } from '@/lib/scans/constants';
import type { CspRankSort, CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { isMarketQualified, isModeQualified, type CspMarketQualification, type CspModeQualification } from '@/lib/scans/cspQualification';
import { oiPresets } from './presets';
import {
  SUMMARY_GROUP_LABEL,
  type Lifecycle, type RangePreset, type ReceiptGroup, type ScalarPreset, type SummaryGroup,
} from './types';

export type CspMode = 'rank' | 'targeted';
/** Receipts also describe older cached sessions that ran in the removed Filter mode. */
export type CspReceiptMode = CspMode | 'filter';
export type CspRuleKey = keyof CspRulesType;
export type CspTargetField = 'popMin' | 'otmMin' | 'rocMin';

/** The values a CSP scan was, or is about to be, configured with. */
export interface CspConfigValues {
  mode: CspReceiptMode;
  rules: CspRulesType;
  popMin: number | null;
  otmMin: number | null;
  rocMin: number | null;
  rankSecondary: CspRankSort;
  affordableOnly: boolean;
  capitalLimit: number | null;
}

export type CspCard = 'search' | 'preference' | 'gates' | 'ordering' | 'advisory' | 'always' | 'capital';

export const CSP_CARD_ORDER: readonly CspCard[] = ['search', 'preference', 'gates', 'ordering', 'advisory', 'always', 'capital'];

export const CSP_CARD_TITLE: Record<CspCard, string> = {
  search: 'Search range',
  preference: 'Preferred delta band',
  gates: 'Targeted gates',
  ordering: 'Ordering',
  advisory: 'Open interest',
  always: 'Always applied',
  capital: 'Capital',
};

export type CspControl =
  | { kind: 'range'; minKey: CspRuleKey; maxKey: CspRuleKey; minLabel: string; maxLabel: string; minTitle: string; maxTitle: string; step: string; presets: RangePreset[] }
  | { kind: 'rule'; key: CspRuleKey; label: string; title: string; step: string; presets: ScalarPreset[] }
  | { kind: 'target'; field: CspTargetField; label: string; ariaLabel: string; title: string; step: string; presets: ScalarPreset[] }
  | { kind: 'secondary-sort'; ariaLabel: string; options: Array<{ value: CspRankSort; label: string }> }
  | { kind: 'capital' }
  | { kind: 'info' };

export interface CspCriterion {
  id: string;
  /** Trader-facing name, with the unit or formula made explicit where it matters. */
  label: string;
  unit: string;
  lifecycle: Lifecycle;
  /** True when the trader cannot change it. */
  fixed: boolean;
  modes: readonly CspReceiptMode[];
  /** True when changing it needs a new scan. */
  rescan: boolean;
  card: CspCard;
  summaryGroup: SummaryGroup;
  /** One or two sentences on what the engine actually does with it. */
  hint: string;
  /** Text for the explicit off state ("Any", "None"), or null when there is none. */
  off: string | null;
  control: CspControl;
  /** Summary text for the receipt, or null when nothing applies (off state, other mode). */
  summary: (values: CspConfigValues) => string | null;
}

const ALL: readonly CspReceiptMode[] = ['rank', 'targeted', 'filter'];
const TARGETED: readonly CspReceiptMode[] = ['targeted'];
const RANK_LIKE: readonly CspReceiptMode[] = ['rank', 'filter'];

const num = (n: number) => String(n);

export const CSP_RANK_SORT_LABEL: Record<CspRankSort, string> = {
  score: 'Score',
  creditDollars: 'Credit $',
  rocPct: 'ROC %',
  otmPct: 'OTM %',
  pop: 'POP',
  relevantLegOI: 'Relevant-leg OI',
  dte: 'DTE',
  none: 'None',
};

const targetPresets = (values: Array<number>, suffix = '%'): ScalarPreset[] => [
  { label: 'Any', value: null },
  ...values.map((value) => ({ label: `${value}${suffix}`, value })),
];

export const IVR_UNAVAILABLE_NOTE = 'A symbol with no IV rank is disqualified: the IVR cap cannot be verified.';

export const CSP_CRITERIA: readonly CspCriterion[] = [
  {
    id: 'dte',
    label: 'DTE range',
    unit: 'days',
    lifecycle: 'fetch',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'search',
    summaryGroup: 'search',
    hint: 'Expirations outside this range are never fetched. Changing it needs a new scan.',
    off: null,
    control: {
      kind: 'range', minKey: 'DTE_MIN', maxKey: 'DTE_MAX', minLabel: 'Min DTE', maxLabel: 'Max DTE',
      minTitle: 'Earliest expiration to include', maxTitle: 'Latest expiration to include', step: '1',
      presets: [
        { label: '7–14 DTE', min: 7, max: 14 },
        { label: '15–29 DTE', min: 15, max: 29 },
        { label: '30–45 DTE', min: 30, max: 45 },
        { label: '21–60 DTE', min: 21, max: 60 },
      ],
    },
    summary: (v) => `${num(v.rules.DTE_MIN)}–${num(v.rules.DTE_MAX)} DTE`,
  },
  {
    id: 'delta',
    label: 'Preferred short-put delta',
    unit: 'absolute delta',
    lifecycle: 'rank',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'preference',
    summaryGroup: 'advisory',
    hint: 'A preference, not a filter. Puts outside the band are kept and shown with a warning, but cannot be a Best Opportunity. Puts nearest the band center rank first.',
    off: null,
    control: {
      kind: 'range', minKey: 'DELTA_MIN', maxKey: 'DELTA_MAX', minLabel: 'Min Δ', maxLabel: 'Max Δ',
      minTitle: 'Lower edge of the short-put delta range', maxTitle: 'Upper edge of the short-put delta range', step: '0.01',
      presets: [
        { label: 'Δ .12–.20', min: 0.12, max: 0.2 },
        { label: 'Δ .15–.25', min: 0.15, max: 0.25 },
        { label: 'Δ .20–.30', min: 0.2, max: 0.3 },
      ],
    },
    summary: (v) => `Δ ${v.rules.DELTA_MIN.toFixed(2)}–${v.rules.DELTA_MAX.toFixed(2)} preferred (outside it: not a Best Opportunity)`,
  },
  {
    id: 'pop',
    label: 'POP at least',
    unit: '%',
    lifecycle: 'gate',
    fixed: false,
    modes: TARGETED,
    rescan: true,
    card: 'gates',
    summaryGroup: 'gates',
    hint: 'A fetched put below this is kept as a visible targeted near-miss with its reason.',
    off: 'Any',
    control: {
      kind: 'target', field: 'popMin', label: 'POP Est. min', ariaLabel: 'Minimum estimated POP',
      title: 'Estimated probability of profit minimum', step: '1', presets: targetPresets([65, 70, 80]),
    },
    summary: (v) => (v.popMin == null ? null : `POP ≥ ${num(v.popMin)}%`),
  },
  {
    id: 'otm',
    label: 'OTM at least',
    unit: '%',
    lifecycle: 'gate',
    fixed: false,
    modes: TARGETED,
    rescan: true,
    card: 'gates',
    summaryGroup: 'gates',
    hint: 'Minimum distance below the current stock price. Below it is a visible targeted near-miss.',
    off: 'Any',
    control: {
      kind: 'target', field: 'otmMin', label: 'OTM min', ariaLabel: 'Minimum OTM percentage',
      title: 'Minimum distance below the current stock price', step: '0.1', presets: targetPresets([5, 8, 15]),
    },
    summary: (v) => (v.otmMin == null ? null : `OTM ≥ ${num(v.otmMin)}%`),
  },
  {
    id: 'roc',
    label: 'Minimum period return on collateral (ROC)',
    unit: '% of collateral, over the option period',
    lifecycle: 'gate',
    fixed: false,
    modes: TARGETED,
    rescan: true,
    card: 'gates',
    summaryGroup: 'gates',
    hint: 'Return for this expiration only, not annualized. Below it is a visible targeted near-miss.',
    off: 'Any',
    control: {
      kind: 'target', field: 'rocMin', label: 'Min period ROC', ariaLabel: 'Minimum cash return',
      title: 'Minimum period return on collateral (ROC), for this expiration', step: '0.1', presets: targetPresets([0.8, 1, 1.5, 2]),
    },
    summary: (v) => (v.rocMin == null ? null : `ROC ≥ ${num(v.rocMin)}%`),
  },
  {
    id: 'rankSecondary',
    label: 'Then order by',
    unit: '',
    lifecycle: 'rank',
    fixed: false,
    modes: ['rank'],
    rescan: false,
    card: 'ordering',
    summaryGroup: 'order',
    hint: 'Score is always the primary order. This breaks ties. You can change it after the scan.',
    off: 'None',
    control: {
      kind: 'secondary-sort', ariaLabel: 'CSP secondary sort',
      options: [
        { value: 'none', label: 'None' }, { value: 'creditDollars', label: 'Credit' }, { value: 'rocPct', label: 'ROC' },
        { value: 'otmPct', label: 'OTM %' }, { value: 'pop', label: 'POP' }, { value: 'relevantLegOI', label: 'Relevant-leg OI' },
        { value: 'dte', label: 'DTE' },
      ],
    },
    summary: (v) => (v.mode === 'targeted' ? null : `Score → ${CSP_RANK_SORT_LABEL[v.rankSecondary] ?? v.rankSecondary}`),
  },
  {
    id: 'resultChips',
    label: 'After the scan',
    unit: '',
    lifecycle: 'result-filter',
    fixed: true,
    modes: RANK_LIKE,
    rescan: false,
    card: 'ordering',
    summaryGroup: 'adjustable',
    hint: 'Rank has no POP, OTM, or ROC gates. Once results return, the POP, OTM, DTE, delta, expected-IV, IVR, and put-OI chips narrow the fetched candidates. No rescan.',
    off: null,
    control: { kind: 'info' },
    summary: () => 'POP · OTM · DTE · delta · Exp. IVX · IVR · Put OI chips',
  },
  {
    id: 'oi',
    label: 'OI pref.',
    unit: 'contracts',
    lifecycle: 'advisory',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'advisory',
    summaryGroup: 'advisory',
    hint: 'Lower open interest is kept and shown with a warning, and the results view shows every put by default (Put OI: Any). Zero open interest cannot be a Best Opportunity.',
    off: null,
    control: {
      kind: 'rule', key: 'OI_MIN', label: 'OI pref.', title: 'Preferred minimum open interest', step: '1', presets: oiPresets(),
    },
    summary: (v) => `OI ${num(v.rules.OI_MIN)}`,
  },
  {
    id: 'ivrCap',
    label: 'IVR cap',
    unit: '%',
    lifecycle: 'gate',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'always',
    summaryGroup: 'gates',
    hint: 'A symbol whose IV rank is above the cap is disqualified (undefined risk). A symbol with no IV rank is disqualified too, because the cap cannot be verified.',
    off: null,
    control: { kind: 'rule', key: 'IVR_MAX', label: 'IVR cap', title: 'Maximum underlying IV rank', step: '1', presets: [] },
    summary: (v) => `IVR ≤ ${num(v.rules.IVR_MAX)}%`,
  },
  {
    id: 'ivrFloor',
    label: 'IVR pref.',
    unit: '%',
    lifecycle: 'rank',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'always',
    summaryGroup: 'advisory',
    hint: 'A symbol below the floor ranks lower. Guidance only; it never removes a symbol.',
    off: null,
    control: { kind: 'rule', key: 'IVR_MIN', label: 'IVR pref.', title: 'Preferred underlying IV rank floor', step: '1', presets: [] },
    summary: (v) => `IVR floor ${num(v.rules.IVR_MIN)}%`,
  },
  {
    id: 'liquidity',
    label: 'Bid/ask liquidity',
    unit: 'width vs. midpoint',
    lifecycle: 'gate',
    fixed: true,
    modes: ALL,
    rescan: true,
    card: 'always',
    summaryGroup: 'gates',
    hint: 'A fixed policy, not a setting. Strong: width at or under the larger of $0.10 or 10% of mid. Borderline: up to 15% of mid, kept but excluded from Best Opportunities. Wider fails.',
    off: null,
    control: { kind: 'info' },
    summary: () => 'bid/ask tiers (fixed)',
  },
  {
    id: 'earnings',
    label: 'Earnings buffer after expiry',
    unit: '',
    lifecycle: 'gate',
    fixed: true,
    modes: ALL,
    rescan: true,
    card: 'always',
    summaryGroup: 'gates',
    hint: 'A candidate whose expiration spans an earnings date, or expires within 10 days before it, is disqualified. Earnings dates are estimates that can move earlier.',
    off: null,
    control: { kind: 'info' },
    summary: () => 'earnings buffer after expiry: 10 days',
  },
  {
    id: 'capital',
    label: 'Affordable only',
    unit: 'USD cash per put',
    lifecycle: 'gate',
    fixed: false,
    modes: ALL,
    rescan: true,
    card: 'capital',
    summaryGroup: 'capital',
    hint: 'Optional. When off, every candidate is kept and shows its collateral requirement.',
    off: 'Off',
    control: { kind: 'capital' },
    summary: (v) => (v.affordableOnly
      ? `Affordable only on${v.capitalLimit != null ? ` · cash cap $${num(v.capitalLimit)}` : ''}`
      : 'Affordable only off'),
  },
];

/** The criteria that apply to a mode, in registry order. */
export function criteriaForMode(mode: CspReceiptMode): CspCriterion[] {
  return CSP_CRITERIA.filter((c) => c.modes.includes(mode));
}

/** The criteria of one card for a mode, in registry order. */
export function criteriaForCard(mode: CspReceiptMode, card: CspCard): CspCriterion[] {
  return criteriaForMode(mode).filter((c) => c.card === card);
}

export function getCriterion(id: string): CspCriterion {
  const found = CSP_CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown CSP criterion: ${id}`);
  return found;
}

const GROUP_ORDER: readonly SummaryGroup[] = ['search', 'gates', 'advisory', 'order', 'adjustable', 'capital'];

/** Counts shown on the result receipt. */
export interface CspResultCounts {
  qualified: number;
  targetedNearMisses: number;
  disqualified: number;
  /** Distinct symbols whose IV rank was unavailable, so the IVR cap could not be checked. */
  symbolsIvrUnavailable: number;
}

export interface CspReceipt {
  mode: CspReceiptMode;
  groups: ReceiptGroup[];
  counts: CspResultCounts | null;
  /** Plain-language limits the trader should know about. */
  notes: string[];
}

/** Builds the scan summary (before a run) or the result receipt (after) from the registry. */
export function buildCspReceipt(values: CspConfigValues, counts: CspResultCounts | null = null): CspReceipt {
  const byGroup = new Map<SummaryGroup, { items: string[]; rescan: boolean }>();
  for (const criterion of criteriaForMode(values.mode)) {
    const text = criterion.summary(values);
    if (text == null) continue;
    const entry = byGroup.get(criterion.summaryGroup) ?? { items: [], rescan: false };
    entry.items.push(text);
    entry.rescan = entry.rescan || criterion.rescan;
    byGroup.set(criterion.summaryGroup, entry);
  }
  const groups: ReceiptGroup[] = GROUP_ORDER.flatMap((key) => {
    const entry = byGroup.get(key);
    if (!entry) return [];
    const label = key === 'search' ? `${SUMMARY_GROUP_LABEL[key]} · rescan to change` : SUMMARY_GROUP_LABEL[key];
    return [{ key, label, rescan: entry.rescan, items: entry.items }];
  });
  return { mode: values.mode, groups, counts, notes: [IVR_UNAVAILABLE_NOTE] };
}

/** Rebuilds the configured values from a stored rule snapshot (older sessions may be Filter mode). */
export function valuesFromSnapshot(
  snapshot: CspRuleSnapshot,
  capital: { affordableOnly?: boolean; capitalLimit?: number | null } = {},
): CspConfigValues {
  return {
    mode: snapshot.mode,
    rules: {
      IVR_MIN: snapshot.ivrMin, IVR_MAX: snapshot.ivrMax, DELTA_MIN: snapshot.deltaMin, DELTA_MAX: snapshot.deltaMax,
      DTE_MIN: snapshot.dteMin, DTE_MAX: snapshot.dteMax, OI_MIN: snapshot.oiMin, BID_ASK_MAX: snapshot.bidAskMax,
    },
    popMin: snapshot.popMin,
    otmMin: snapshot.otmMin,
    rocMin: snapshot.rocMin,
    rankSecondary: snapshot.rankSecondary,
    affordableOnly: capital.affordableOnly ?? false,
    capitalLimit: capital.capitalLimit ?? null,
  };
}

/** The minimum a result needs for the receipt counts. */
export interface CspCountableResult {
  symbol: string;
  ivr: number | null;
  qualified: boolean;
  bestCandidate?: {
    cspMarketQualification?: CspMarketQualification;
    cspModeQualification?: CspModeQualification;
  } | null;
}

/**
 * Qualified: passed everything. Targeted near-miss: qualified on market rules and
 * failed only the Targeted POP, OTM, or ROC gate. Disqualified: everything else.
 */
export function summarizeCspResults(results: readonly CspCountableResult[]): CspResultCounts {
  let qualified = 0;
  let targetedNearMisses = 0;
  let disqualified = 0;
  const noIvr = new Set<string>();
  for (const r of results) {
    if (r.ivr == null) noIvr.add(r.symbol);
    if (r.qualified) { qualified++; continue; }
    const c = r.bestCandidate;
    const market = c?.cspMarketQualification;
    const mode = c?.cspModeQualification;
    if (market != null && mode != null && isMarketQualified(market) && !isModeQualified(mode)) targetedNearMisses++;
    else disqualified++;
  }
  return { qualified, targetedNearMisses, disqualified, symbolsIvrUnavailable: noIvr.size };
}
