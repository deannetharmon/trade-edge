// lib/discovery/normalized/sec/secFundamentals.ts

// LEAPS-QV-0001 Gate 2b -- SEC EDGAR companyfacts -> normalized fundamentals. Pure: facts, price and clock come in as
// arguments; nothing is fetched here (see lib/fundamentals/ for the rate-limited, cached client).
//
// Everything is evaluated at ONE anchor: the latest fiscal-year-to-date period in the data. There is no fallback to an
// older period, so a metric is never assembled from mismatched dates. Each logical item ends in a status:
//   OK / MISSING (not reported -> UNAVAILABLE) / AMBIGUOUS or INCONSISTENT (-> INVALID, never guessed).
// Metrics only. No thresholds, scores, classifications or lifecycle decisions.

import { invalidMetric, staleMetric, unavailableMetric, validMetric } from '../../metrics';
import type { MetricSet, NormalizedMetric } from '../../metrics';
import { buildFundamentalMetrics, createFundamentalResult, FUNDAMENTAL_METRIC_IDS } from '../fundamentals';
import type { FundamentalsInput } from '../fundamentals';
import { epochDayOfIso } from '../dates';
import type { DailyBar } from '../technicals';
import { MARKET_CAP_SHARES_TOLERANCE, SEC_CONCEPT_MAP_VERSION, SEC_ITEMS } from './conceptMap';
import { buildFactIndex, provenanceOf, resolveDebt, resolveInstantNear, resolveItemAt } from './facts';
import type { FactIndex, Resolved } from './facts';
import {
  BALANCE_SHEET_YEAR_AGO_TOLERANCE_DAYS,
  consecutiveFiscalYears,
  dayOf,
  findAnchors,
  findFiscalYears,
  priorYearAnchor,
  shiftDate,
  ttmAt,
} from './periods';
import type { Anchor, FiscalYear, Ttm } from './periods';
import { buildPeHistoryMetrics, buildPeObservations, PE_HISTORY_METRIC_IDS } from './valuationHistory';
import type { ExcludedObservation, PeObservation } from './valuationHistory';
import type { CompactFacts, SecItemStatus, SecProvenance, SecSubmissionsInfo } from './types';

export const SEC_PROVIDER = 'sec-edgar';

export const SEC_METRIC_IDS: readonly string[] = [
  'eps_cagr_5y_pct',
  'eps_growth_yoy_ttm_pct',
  'revenue_growth_yoy_ttm_pct',
  'operating_margin_trend_5y_pp',
  'operating_margin_change_yoy_pp',
  'total_debt',
  'net_debt',
  'current_ratio',
  'interest_coverage',
  'ev_to_ebitda_ttm',
  'price_to_fcf',
  'sector_classification',
  ...PE_HISTORY_METRIC_IDS,
];

/** Every metric id a SEC result carries (the eight base fundamentals plus the SEC-backed ones). */
export const SEC_RESULT_METRIC_IDS: readonly string[] = [...FUNDAMENTAL_METRIC_IDS, ...SEC_METRIC_IDS];

const SIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SecBuildContext {
  /** Evaluation time (ISO-8601). */
  readonly now: string;
  /** Latest close as a normalized metric (e.g. technicals' price_last_close); null when there is none. */
  readonly price: NormalizedMetric | null;
  /** Completed daily closes, oldest first, covering at least the longest valuation window; null when absent. */
  readonly closes: readonly DailyBar[] | null;
  readonly submissions: SecSubmissionsInfo | null;
}

export interface AnnualPoint {
  readonly fiscalYearStart: string;
  readonly fiscalYearEnd: string;
  readonly revenue: number | null;
  readonly operatingIncome: number | null;
  readonly dilutedEps: number | null;
  readonly operatingCashFlow: number | null;
  readonly capitalExpenditure: number | null;
  readonly freeCashFlow: number | null;
  /** Items that could not be resolved for this year, e.g. "MISSING:capex", "AMBIGUOUS:revenue". */
  readonly issues: readonly string[];
}

export interface SecDiagnostics {
  readonly conceptMapVersion: string;
  readonly anchor: { readonly start: string; readonly end: string; readonly bucket: string } | null;
  /** Items that did not resolve cleanly at the anchor, with the reason. */
  readonly itemIssues: Readonly<Record<string, SecItemStatus>>;
  readonly restatedPieces: number;
  readonly droppedFacts: Readonly<Record<string, number>>;
  readonly observationCount: number;
  readonly excludedObservations: readonly ExcludedObservation[];
}

export interface SecFundamentalsResult {
  readonly status: 'OK' | 'INSUFFICIENT_FACTS';
  readonly metrics: MetricSet;
  /** For each non-UNAVAILABLE metric, the SEC facts it was derived from. */
  readonly provenance: Readonly<Record<string, readonly SecProvenance[]>>;
  /** Per-fiscal-year figures so Gate 3 can define consistency / stability / trend without re-reading SEC data. */
  readonly annualSeries: readonly AnnualPoint[];
  readonly observations: readonly PeObservation[];
  readonly diagnostics: SecDiagnostics;
}

/** Every SEC-result metric UNAVAILABLE with one reason (not covered, provider failure, no facts, ...). */
export function unavailableSecFundamentals(reason: string): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  SEC_RESULT_METRIC_IDS.forEach((id) => {
    out[id] = unavailableMetric(id, reason, { provider: SEC_PROVIDER });
  });
  return out;
}

function emptyResult(reason: string, compact: CompactFacts): SecFundamentalsResult {
  return {
    status: 'INSUFFICIENT_FACTS',
    metrics: unavailableSecFundamentals(reason),
    provenance: {},
    annualSeries: [],
    observations: [],
    diagnostics: {
      conceptMapVersion: SEC_CONCEPT_MAP_VERSION,
      anchor: null,
      itemIssues: { revenue: { status: 'MISSING', reason } },
      restatedPieces: 0,
      droppedFacts: compact.dropped,
      observationCount: 0,
      excludedObservations: [],
    },
  };
}

// Which item keys each metric depends on (a blocker in any of them blocks the metric).
const METRIC_DEPS: Readonly<Record<string, readonly string[]>> = {
  operating_margin_ttm_pct: ['operatingIncome', 'revenue'],
  fcf_ttm: ['operatingCashFlow', 'capex'],
  fcf_margin_ttm_pct: ['operatingCashFlow', 'capex', 'revenue'],
  fcf_yield_pct: ['operatingCashFlow', 'capex', 'marketCap'],
  roic_v1_pct: ['operatingIncome', 'pretaxIncome', 'incomeTax', 'totalEquityEnd', 'debtEnd', 'cashEnd', 'totalEquityStart', 'debtStart', 'cashStart'],
  net_debt_to_ebitda: ['ebitda', 'debtEnd', 'cashEnd'],
  pe_ttm: ['dilutedEps', 'price'],
  revenue_cagr_5y_pct: ['annualRevenue'],
  eps_cagr_5y_pct: ['annualEps'],
  eps_growth_yoy_ttm_pct: ['dilutedEps', 'dilutedEpsPrior'],
  revenue_growth_yoy_ttm_pct: ['revenue', 'revenuePrior'],
  operating_margin_trend_5y_pp: ['annualRevenue', 'annualOperatingIncome'],
  operating_margin_change_yoy_pp: ['operatingIncome', 'revenue', 'operatingIncomePrior', 'revenuePrior'],
  total_debt: ['debtEnd'],
  net_debt: ['debtEnd', 'cashEnd'],
  current_ratio: ['currentAssets', 'currentLiabilities'],
  interest_coverage: ['operatingIncome', 'interestExpense'],
  ev_to_ebitda_ttm: ['marketCap', 'debtEnd', 'cashEnd', 'ebitda'],
  price_to_fcf: ['marketCap', 'operatingCashFlow', 'capex'],
};

function statusOfResolved(item: string, r: Resolved): SecItemStatus {
  if (r.status === 'OK') return { status: 'OK', reason: '' };
  if (r.status === 'MISSING') return { status: 'MISSING', reason: `SEC_ITEM_NOT_REPORTED:${item}` };
  return { status: 'AMBIGUOUS', reason: `AMBIGUOUS_CONCEPT:${item}` };
}

function statusOfTtm(item: string, t: Ttm): SecItemStatus {
  if (t.status === 'OK') return { status: 'OK', reason: '' };
  if (t.status === 'MISSING') return { status: 'MISSING', reason: `SEC_ITEM_NOT_REPORTED:${item}:${t.reason}` };
  return { status: 'AMBIGUOUS', reason: `AMBIGUOUS_CONCEPT:${item}:${t.reason}` };
}

const OK_STATUS: SecItemStatus = { status: 'OK', reason: '' };

export function buildSecFundamentals(compact: CompactFacts, ctx: SecBuildContext): SecFundamentalsResult {
  const index: FactIndex = buildFactIndex(compact.facts);
  const fiscalYears = findFiscalYears(index);
  const anchors = findAnchors(index, fiscalYears);
  if (anchors.length === 0) return emptyResult('REVENUE_PERIODS_NOT_FOUND', compact);
  const anchor = anchors[anchors.length - 1];

  const status: Record<string, SecItemStatus> = {};
  const itemProv: Record<string, SecProvenance[]> = {};
  const values: Record<string, number> = {};
  let restatedPieces = 0;
  let filedMax = '';
  const noteFiled = (filed: string): void => {
    if (filed > filedMax) filedMax = filed;
  };
  const recordResolved = (key: string, role: string, r: Resolved): void => {
    const p = provenanceOf(r, role);
    if (p) {
      (itemProv[key] = itemProv[key] || []).push(p);
      noteFiled(p.filed);
      if (p.restated) restatedPieces += 1;
    }
  };
  const recordTtm = (key: string, t: Ttm): void => {
    if (t.status !== 'OK') return;
    t.pieces.forEach((piece) => recordResolved(key, piece.role, piece.resolved));
  };

  // ---- flows (TTM at the anchor) and their prior-year counterparts ----
  const prior = priorYearAnchor(anchors, anchor);
  const flowKeys = ['revenue', 'operatingIncome', 'pretaxIncome', 'incomeTax', 'dilutedEps', 'operatingCashFlow', 'capex', 'depreciationAmortization', 'interestExpense'];
  flowKeys.forEach((key) => {
    const t = ttmAt(index, SEC_ITEMS[key], anchor, anchors);
    status[key] = statusOfTtm(key, t);
    if (t.status === 'OK') {
      values[key] = t.value;
      recordTtm(key, t);
    }
  });
  ['revenue', 'operatingIncome', 'dilutedEps'].forEach((key) => {
    const priorKey = `${key}Prior`;
    if (!prior) {
      status[priorKey] = { status: 'MISSING', reason: `SEC_ITEM_NOT_REPORTED:${key}:PRIOR_YEAR_PERIOD_NOT_FOUND` };
      return;
    }
    const t = ttmAt(index, SEC_ITEMS[key], prior, anchors);
    status[priorKey] = statusOfTtm(`${key}Prior`, t);
    if (t.status === 'OK') {
      values[priorKey] = t.value;
      recordTtm(priorKey, t);
    }
  });
  // EBITDA-v1 = operating income + depreciation and amortization
  if (status.operatingIncome.status === 'OK' && status.depreciationAmortization.status === 'OK') {
    status.ebitda = OK_STATUS;
    values.ebitda = values.operatingIncome + values.depreciationAmortization;
    itemProv.ebitda = [...(itemProv.operatingIncome || []), ...(itemProv.depreciationAmortization || [])];
  } else {
    const blocker = [status.operatingIncome, status.depreciationAmortization].find((s) => s.status !== 'MISSING' && s.status !== 'OK') ||
      [status.operatingIncome, status.depreciationAmortization].find((s) => s.status === 'MISSING') as SecItemStatus;
    status.ebitda = blocker;
  }

  // ---- balance sheet at the anchor and one year earlier ----
  const instant = (key: string, itemId: string, end: string): void => {
    const r = resolveItemAt(index, SEC_ITEMS[itemId], null, end);
    status[key] = statusOfResolved(key, r);
    if (r.status === 'OK') {
      values[key] = r.value;
      recordResolved(key, 'BALANCE_SHEET', r);
    }
  };
  const debtAt = (key: string, end: string): void => {
    const d = resolveDebt(index, end);
    if (d.status === 'OK') {
      status[key] = OK_STATUS;
      values[key] = d.value as number;
      d.components.forEach((c) => recordResolved(key, `DEBT_${d.recipe}`, c));
    } else {
      status[key] = d.status === 'AMBIGUOUS' ? { status: 'AMBIGUOUS', reason: d.reason } : { status: 'MISSING', reason: `SEC_ITEM_NOT_REPORTED:${key}:${d.reason}` };
    }
  };
  instant('cashEnd', 'cash', anchor.end);
  instant('totalEquityEnd', 'totalEquity', anchor.end);
  instant('currentAssets', 'currentAssets', anchor.end);
  instant('currentLiabilities', 'currentLiabilities', anchor.end);
  debtAt('debtEnd', anchor.end);

  const startBalance = resolveInstantNear(index, SEC_ITEMS.totalEquity, dayOf(anchor.end) - 365, BALANCE_SHEET_YEAR_AGO_TOLERANCE_DAYS, dayOf);
  if (startBalance.status === 'OK') {
    const startEnd = startBalance.fact.end;
    status.totalEquityStart = OK_STATUS;
    values.totalEquityStart = startBalance.value;
    recordResolved('totalEquityStart', 'BALANCE_SHEET_YEAR_AGO', startBalance);
    instant('cashStart', 'cash', startEnd);
    debtAt('debtStart', startEnd);
  } else {
    const s = statusOfResolved('totalEquityStart', startBalance);
    status.totalEquityStart = s;
    status.cashStart = s;
    status.debtStart = s;
  }

  // ---- shares and market cap (marketCap-v1) ----
  const priceMetric = ctx.price;
  const priceOk = priceMetric !== null && priceMetric.validity === 'VALID';
  status.price = priceOk
    ? OK_STATUS
    : priceMetric !== null && priceMetric.validity === 'INVALID'
      ? { status: 'INVALID', reason: 'INPUT_INVALID:price_last_close' }
      : { status: 'MISSING', reason: `INPUT_${priceMetric === null ? 'UNAVAILABLE' : priceMetric.validity}:price_last_close` };
  const shareFacts = index.get('dei:EntityCommonStockSharesOutstanding') || [];
  const latestShareEnd = shareFacts.reduce((max, f) => (f.end > max ? f.end : max), '');
  if (latestShareEnd === '') {
    status.sharesOutstanding = { status: 'MISSING', reason: 'SEC_ITEM_NOT_REPORTED:sharesOutstanding' };
  } else if (latestShareEnd < anchor.end) {
    status.sharesOutstanding = { status: 'MISSING', reason: 'SEC_ITEM_NOT_REPORTED:sharesOutstanding:COVER_DATE_BEFORE_PERIOD_END' };
  } else {
    const r = resolveItemAt(index, SEC_ITEMS.sharesOutstanding, null, latestShareEnd);
    status.sharesOutstanding = statusOfResolved('sharesOutstanding', r);
    if (r.status === 'OK') {
      values.sharesOutstanding = r.value;
      recordResolved('sharesOutstanding', 'COVER_PAGE', r);
    }
  }
  const weighted = resolveItemAt(index, SEC_ITEMS.dilutedShares, anchor.start, anchor.end);
  if (status.price.status !== 'OK') {
    status.marketCap = status.price;
  } else if (status.sharesOutstanding.status !== 'OK') {
    status.marketCap = status.sharesOutstanding;
  } else if (weighted.status !== 'OK' || !(weighted.value > 0)) {
    status.marketCap = { status: 'MISSING', reason: 'SHARES_CROSSCHECK_UNAVAILABLE' };
  } else if (Math.abs(values.sharesOutstanding / weighted.value - 1) > MARKET_CAP_SHARES_TOLERANCE) {
    status.marketCap = { status: 'INCONSISTENT', reason: 'SHARES_INCONSISTENT' };
  } else {
    status.marketCap = OK_STATUS;
    values.marketCap = (priceMetric as { value: number }).value * values.sharesOutstanding; // priceOk guarantees a VALID numeric price here
    recordResolved('marketCap', 'WEIGHTED_AVERAGE_DILUTED_SHARES_CROSSCHECK', weighted);
    itemProv.marketCap = [...(itemProv.marketCap || []), ...(itemProv.sharesOutstanding || [])];
  }

  // ---- annual series (also feeds the 5-year metrics) ----
  const annualSeries = buildAnnualSeries(index, fiscalYears, noteFiled);
  const six = consecutiveFiscalYears(fiscalYears, 6);
  const annualStatus = (itemId: string, key: string): SecItemStatus => {
    if (!six) return { status: 'MISSING', reason: `SEC_ITEM_NOT_REPORTED:${key}:INSUFFICIENT_HISTORY` };
    let missing: SecItemStatus | null = null;
    for (const fy of six) {
      const r = resolveItemAt(index, SEC_ITEMS[itemId], fy.start, fy.end);
      if (r.status === 'AMBIGUOUS') return statusOfResolved(key, r);
      if (r.status === 'MISSING') missing = missing || statusOfResolved(key, r);
      else recordResolved(key, `FY_${fy.end}`, r);
    }
    return missing || OK_STATUS;
  };
  status.annualRevenue = annualStatus('revenue', 'annualRevenue');
  status.annualEps = annualStatus('dilutedEps', 'annualEps');
  status.annualOperatingIncome = annualStatus('operatingIncome', 'annualOperatingIncome');
  const annualValue = (itemId: string, fy: FiscalYear): number => (resolveItemAt(index, SEC_ITEMS[itemId], fy.start, fy.end) as { value: number }).value;

  // ---- base metrics via the Gate 2 builder ----
  const asOfIso = filedMax === '' ? null : `${filedMax}T00:00:00.000Z`;
  const num = (key: string): number | null => (status[key] && status[key].status === 'OK' ? values[key] : null);
  const input: FundamentalsInput = {
    asOf: asOfIso,
    provider: SEC_PROVIDER,
    price: priceOk ? (priceMetric as { value: number }).value : null,
    marketCap: num('marketCap'),
    ttm: {
      revenue: num('revenue'),
      operatingIncome: num('operatingIncome'),
      pretaxIncome: num('pretaxIncome'),
      incomeTaxExpense: num('incomeTax'),
      operatingCashFlow: num('operatingCashFlow'),
      capitalExpenditure: num('capex'),
      ebitda: num('ebitda'),
      dilutedEps: num('dilutedEps'),
    },
    balanceSheetStart: { totalDebt: num('debtStart'), totalEquity: num('totalEquityStart'), cashAndEquivalents: num('cashStart') },
    balanceSheetEnd: { totalDebt: num('debtEnd'), totalEquity: num('totalEquityEnd'), cashAndEquivalents: num('cashEnd') },
    annualRevenue: status.annualRevenue.status === 'OK' && six ? six.map((fy) => ({ fiscalYearEnd: fy.end, revenue: annualValue('revenue', fy) })) : null,
  };
  const base = buildFundamentalMetrics(input, ctx.now);
  const out: Record<string, NormalizedMetric> = {};
  const provenance = { provider: SEC_PROVIDER };

  const blockerOf = (id: string): SecItemStatus | null => {
    const deps = METRIC_DEPS[id] || [];
    const states = deps.map((d) => status[d]).filter((s): s is SecItemStatus => !!s);
    const hard = states.find((s) => s.status === 'AMBIGUOUS' || s.status === 'INCONSISTENT' || s.status === 'INVALID');
    if (hard) return hard;
    return states.find((s) => s.status === 'MISSING') || null;
  };
  const withBlocker = (id: string, metric: NormalizedMetric): NormalizedMetric => {
    const blocker = blockerOf(id);
    if (!blocker) return metric;
    if (blocker.status !== 'MISSING') return invalidMetric(id, 'n/a', blocker.reason, provenance);
    return metric.validity === 'UNAVAILABLE' ? unavailableMetric(id, blocker.reason, provenance) : metric;
  };
  FUNDAMENTAL_METRIC_IDS.forEach((id) => {
    out[id] = withBlocker(id, base[id]);
  });

  // ---- SEC-backed metrics ----
  const result = createFundamentalResult(SEC_PROVIDER, asOfIso, ctx.now);
  const derive = (id: string, compute: () => number | { invalid: string } | { missing: string }): void => {
    const blocker = blockerOf(id);
    if (blocker) {
      out[id] = blocker.status === 'MISSING' ? unavailableMetric(id, blocker.reason, provenance) : invalidMetric(id, 'n/a', blocker.reason, provenance);
      return;
    }
    const v = compute();
    if (typeof v === 'number') out[id] = result(id, Number.isFinite(v) ? v : null, 'NON_FINITE_RESULT');
    else if ('invalid' in v) out[id] = result(id, null, '', v.invalid);
    else out[id] = result(id, null, v.missing);
  };
  const cagr = (first: number, last: number): number => (Math.pow(last / first, 1 / 5) - 1) * 100;

  derive('eps_cagr_5y_pct', () => {
    const first = annualValue('dilutedEps', (six as FiscalYear[])[0]);
    const last = annualValue('dilutedEps', (six as FiscalYear[])[5]);
    return first > 0 && last > 0 ? cagr(first, last) : { invalid: 'NON_POSITIVE_EARNINGS_BASE' };
  });
  derive('eps_growth_yoy_ttm_pct', () =>
    values.dilutedEpsPrior > 0 && values.dilutedEps > 0 ? (values.dilutedEps / values.dilutedEpsPrior - 1) * 100 : { invalid: 'NON_POSITIVE_EARNINGS' },
  );
  derive('revenue_growth_yoy_ttm_pct', () =>
    values.revenuePrior > 0 && values.revenue > 0 ? (values.revenue / values.revenuePrior - 1) * 100 : { invalid: 'NON_POSITIVE_REVENUE' },
  );
  derive('operating_margin_trend_5y_pp', () => {
    const years = six as FiscalYear[];
    const revFirst = annualValue('revenue', years[0]);
    const revLast = annualValue('revenue', years[5]);
    if (!(revFirst > 0) || !(revLast > 0)) return { invalid: 'NON_POSITIVE_REVENUE' };
    return (annualValue('operatingIncome', years[5]) / revLast - annualValue('operatingIncome', years[0]) / revFirst) * 100;
  });
  derive('operating_margin_change_yoy_pp', () =>
    values.revenue > 0 && values.revenuePrior > 0
      ? (values.operatingIncome / values.revenue - values.operatingIncomePrior / values.revenuePrior) * 100
      : { invalid: 'NON_POSITIVE_REVENUE' },
  );
  derive('total_debt', () => values.debtEnd);
  derive('net_debt', () => values.debtEnd - values.cashEnd);
  derive('current_ratio', () => (values.currentLiabilities > 0 ? values.currentAssets / values.currentLiabilities : { invalid: 'NON_POSITIVE_CURRENT_LIABILITIES' }));
  derive('interest_coverage', () => (values.interestExpense > 0 ? values.operatingIncome / values.interestExpense : { missing: 'INTEREST_EXPENSE_NOT_POSITIVE' }));
  derive('ev_to_ebitda_ttm', () => (values.ebitda > 0 ? (values.marketCap + values.debtEnd - values.cashEnd) / values.ebitda : { invalid: 'NON_POSITIVE_EBITDA' }));
  derive('price_to_fcf', () => {
    const fcf = values.operatingCashFlow - values.capex;
    return fcf > 0 ? values.marketCap / fcf : { invalid: 'NON_POSITIVE_FCF' };
  });

  // sector classification (SIC) from the submissions payload
  out.sector_classification = sectorMetric(ctx.submissions, ctx.now);

  // ---- P/E history ----
  const obs = buildPeObservations(index, anchors, (a, b) => dayOf(b) - dayOf(a));
  Object.assign(out, buildPeHistoryMetrics({ observations: obs.observations, closes: ctx.closes, peNow: out.pe_ttm, now: ctx.now }));

  // ---- provenance for every metric that carries a number ----
  const metricProvenance: Record<string, SecProvenance[]> = {};
  Object.keys(out).forEach((id) => {
    const m = out[id];
    if (m.validity !== 'VALID' && m.validity !== 'STALE') return;
    const deps = METRIC_DEPS[id];
    if (!deps) return;
    const list: SecProvenance[] = [];
    deps.forEach((d) => (itemProv[d] || []).forEach((p) => list.push(p)));
    if (list.length > 0) metricProvenance[id] = list;
  });
  const itemIssues: Record<string, SecItemStatus> = {};
  Object.keys(status).forEach((key) => {
    if (status[key].status !== 'OK') itemIssues[key] = status[key];
  });

  return {
    status: 'OK',
    metrics: Object.freeze(out),
    provenance: metricProvenance,
    annualSeries,
    observations: obs.observations,
    diagnostics: {
      conceptMapVersion: SEC_CONCEPT_MAP_VERSION,
      anchor: { start: anchor.start, end: anchor.end, bucket: anchor.bucket },
      itemIssues,
      restatedPieces,
      droppedFacts: compact.dropped,
      observationCount: obs.observations.length,
      excludedObservations: obs.excluded,
    },
  };
}

function sectorMetric(submissions: SecSubmissionsInfo | null, now: string): NormalizedMetric {
  const id = 'sector_classification';
  const provenance = { provider: SEC_PROVIDER, field: 'submissions.sic' };
  if (!submissions) return unavailableMetric(id, 'NO_SUBMISSIONS_PAYLOAD', provenance);
  if (submissions.sic === null || !/^\d{3,4}$/.test(submissions.sic)) return unavailableMetric(id, 'NO_SIC_IN_SUBMISSIONS', provenance);
  const nowDay = epochDayOfIso(now);
  const fetchedDay = epochDayOfIso(submissions.fetchedAt);
  if (nowDay === null || fetchedDay === null || Date.parse(submissions.fetchedAt) > Date.parse(now)) {
    return invalidMetric(id, submissions.fetchedAt, 'SUBMISSIONS_AS_OF_INVALID', provenance);
  }
  const age = Date.parse(now) - Date.parse(submissions.fetchedAt);
  if (age > SIC_MAX_AGE_MS) return staleMetric(id, submissions.sic, submissions.fetchedAt, age, SIC_MAX_AGE_MS, provenance);
  return validMetric(id, submissions.sic, submissions.fetchedAt, provenance);
}

function buildAnnualSeries(index: FactIndex, fiscalYears: readonly FiscalYear[], noteFiled: (filed: string) => void): AnnualPoint[] {
  void noteFiled;
  const years = fiscalYears.slice(Math.max(0, fiscalYears.length - 10));
  return years.map((fy) => {
    const issues: string[] = [];
    const get = (itemId: string): number | null => {
      const r = resolveItemAt(index, SEC_ITEMS[itemId], fy.start, fy.end);
      if (r.status === 'OK') return r.value;
      issues.push(`${r.status}:${itemId}`);
      return null;
    };
    const revenue = get('revenue');
    const operatingIncome = get('operatingIncome');
    const dilutedEps = get('dilutedEps');
    const operatingCashFlow = get('operatingCashFlow');
    const capitalExpenditure = get('capex');
    return {
      fiscalYearStart: fy.start,
      fiscalYearEnd: fy.end,
      revenue,
      operatingIncome,
      dilutedEps,
      operatingCashFlow,
      capitalExpenditure,
      freeCashFlow: operatingCashFlow !== null && capitalExpenditure !== null ? operatingCashFlow - capitalExpenditure : null,
      issues,
    };
  });
}
