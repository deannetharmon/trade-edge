// lib/discovery/normalized/__tests__/secFixtures.ts

// Synthetic SEC "companyfacts" payloads for the Gate 2b tests. Seven fiscal years plus the first half of the next year.
// Every figure is a simple function of the year index so expected values can be derived by hand.
// Not a real company; no live SEC data (the sandbox cannot reach SEC).

import { dateStringFromEpochDay, epochDayOfDateString } from '../dates';

export type RawRow = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
export type RawFacts = { cik: number; entityName: string; facts: Record<string, Record<string, { label: string; units: Record<string, RawRow[]> }>> };

export const DEC_FY_ENDS = ['2019-12-31', '2020-12-31', '2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'];
export const SEP_FY_ENDS = ['2019-09-30', '2020-09-30', '2021-09-30', '2022-09-30', '2023-09-30', '2024-09-30', '2025-09-30'];
// 52/53-week calendar (year ends the Saturday nearest 30 September).
export const WEEK_FY_ENDS = ['2019-09-28', '2020-10-03', '2021-10-02', '2022-10-01', '2023-09-30', '2024-09-28', '2025-09-27'];

const day = (d: string): number => epochDayOfDateString(d) as number;
export const plusDays = (d: string, n: number): string => dateStringFromEpochDay(day(d) + n);

export interface FixtureOptions {
  fyEnds?: string[];
  /** Include the first-half period of the year after the last fiscal year (the TTM anchor). Default true. */
  currentHalf?: boolean;
}

/** FY value for year index i (0..6), the half-year values, and the current half. */
export const FY = {
  revenue: (i: number): number => 1000 + 100 * i,
  eps: (i: number): number => +(1 + 0.2 * i).toFixed(2),
};
export const CURRENT = { revenue: 880, operatingIncome: 200, eps: 1.3, da: 27, ocf: 220, capex: 44, interest: 6, tax: 0 };

function add(raw: RawFacts, taxonomy: string, tag: string, unit: string, row: RawRow): void {
  const t = (raw.facts[taxonomy] = raw.facts[taxonomy] || {});
  const c = (t[tag] = t[tag] || { label: tag, units: {} });
  (c.units[unit] = c.units[unit] || []).push(row);
}

export function makeCompanyFacts(opts: FixtureOptions = {}): RawFacts {
  const fyEnds = opts.fyEnds || DEC_FY_ENDS;
  const raw: RawFacts = { cik: 1234567, entityName: 'ACME TEST CORP', facts: {} };
  let acc = 0;
  const accn = (): string => `0001234567-26-${String(++acc).padStart(6, '0')}`;

  const periods: Array<{ i: number; start: string; end: string; half: boolean }> = [];
  fyEnds.forEach((end, i) => {
    const start = i === 0 ? plusDays(end, -364) : plusDays(fyEnds[i - 1], 1);
    periods.push({ i, start, end, half: false });
    periods.push({ i, start, end: plusDays(start, 181), half: true });
  });
  const lastEnd = fyEnds[fyEnds.length - 1];
  const curStart = plusDays(lastEnd, 1);
  const curHalfEnd = plusDays(curStart, 181);

  const flow = (tag: string, unit: string, fyVal: (i: number) => number, halfVal: (i: number) => number, curVal: number | null): void => {
    periods.forEach((p) => {
      const val = p.half ? halfVal(p.i) : fyVal(p.i);
      const filed = plusDays(p.end, p.half ? 35 : 45);
      add(raw, 'us-gaap', tag, unit, { start: p.start, end: p.end, val, accn: accn(), fy: p.i, fp: p.half ? 'Q2' : 'FY', form: p.half ? '10-Q' : '10-K', filed });
      // Comparative: the next year's 10-K / 10-Q repeats the value (same number, later filing, different accession).
      if (!p.half && p.i < fyEnds.length - 1) {
        add(raw, 'us-gaap', tag, unit, { start: p.start, end: p.end, val, accn: accn(), fy: p.i + 1, fp: 'FY', form: '10-K', filed: plusDays(fyEnds[p.i + 1], 45) });
      }
    });
    if (opts.currentHalf !== false && curVal !== null) {
      add(raw, 'us-gaap', tag, unit, { start: curStart, end: curHalfEnd, val: curVal, accn: accn(), fy: 7, fp: 'Q2', form: '10-Q', filed: plusDays(curHalfEnd, 35) });
    }
  };
  flow('Revenues', 'USD', FY.revenue, (i) => FY.revenue(i) / 2, CURRENT.revenue);
  flow('OperatingIncomeLoss', 'USD', (i) => FY.revenue(i) * 0.2, (i) => FY.revenue(i) * 0.1, CURRENT.operatingIncome);
  flow('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'USD', (i) => FY.revenue(i) * 0.2 - 10, (i) => FY.revenue(i) * 0.1 - 5, CURRENT.operatingIncome - 6);
  flow('IncomeTaxExpenseBenefit', 'USD', (i) => (FY.revenue(i) * 0.2 - 10) * 0.21, (i) => (FY.revenue(i) * 0.1 - 5) * 0.21, (CURRENT.operatingIncome - 6) * 0.21);
  flow('EarningsPerShareDiluted', 'USD/shares', FY.eps, (i) => FY.eps(i) / 2, CURRENT.eps);
  flow('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', () => 500, () => 500, 500);
  flow('NetCashProvidedByUsedInOperatingActivities', 'USD', (i) => FY.revenue(i) * 0.25, (i) => FY.revenue(i) * 0.125, CURRENT.ocf);
  flow('PaymentsToAcquirePropertyPlantAndEquipment', 'USD', (i) => FY.revenue(i) * 0.05, (i) => FY.revenue(i) * 0.025, CURRENT.capex);
  flow('DepreciationDepletionAndAmortization', 'USD', (i) => FY.revenue(i) * 0.03, (i) => FY.revenue(i) * 0.015, CURRENT.da);
  flow('InterestExpense', 'USD', () => 10, () => 5, CURRENT.interest);

  // Balance sheet instants at every fiscal-year end, every half-year end, and the current half-year end.
  const instants: string[] = [];
  periods.forEach((p) => instants.push(p.end));
  if (opts.currentHalf !== false) instants.push(curHalfEnd);
  const seen = new Set<string>();
  instants.forEach((end) => {
    if (seen.has(end)) return;
    seen.add(end);
    const isFy = fyEnds.indexOf(end) >= 0;
    const row = (val: number): RawRow => ({ end, val, accn: accn(), fy: 0, fp: isFy ? 'FY' : 'Q2', form: isFy ? '10-K' : '10-Q', filed: plusDays(end, isFy ? 45 : 35) });
    add(raw, 'us-gaap', 'CashAndCashEquivalentsAtCarryingValue', 'USD', row(120));
    add(raw, 'us-gaap', 'StockholdersEquity', 'USD', row(2000));
    add(raw, 'us-gaap', 'AssetsCurrent', 'USD', row(600));
    add(raw, 'us-gaap', 'LiabilitiesCurrent', 'USD', row(400));
    add(raw, 'us-gaap', 'LongTermDebt', 'USD', row(300));
    add(raw, 'us-gaap', 'ShortTermBorrowings', 'USD', row(50));
  });
  if (opts.currentHalf !== false) {
    add(raw, 'dei', 'EntityCommonStockSharesOutstanding', 'shares', {
      end: plusDays(curHalfEnd, 25), val: 500, accn: accn(), fy: 7, fp: 'Q2', form: '10-Q', filed: plusDays(curHalfEnd, 35),
    });
  }
  return raw;
}

export function currentHalfEnd(fyEnds: string[] = DEC_FY_ENDS): string {
  return plusDays(plusDays(fyEnds[fyEnds.length - 1], 1), 181);
}

/** Removes every row of a tag (or only rows matching `where`). */
export function dropTag(raw: RawFacts, tag: string, where?: (r: RawRow) => boolean): void {
  const concept = raw.facts['us-gaap'][tag];
  if (!concept) return;
  Object.keys(concept.units).forEach((unit) => {
    concept.units[unit] = where ? concept.units[unit].filter((r) => !where(r)) : [];
  });
}

export function addRow(raw: RawFacts, tag: string, unit: string, row: RawRow, taxonomy = 'us-gaap'): void {
  add(raw, taxonomy, tag, unit, row);
}

export function rowsOf(raw: RawFacts, tag: string, unit = 'USD'): RawRow[] {
  return raw.facts['us-gaap'][tag].units[unit];
}
