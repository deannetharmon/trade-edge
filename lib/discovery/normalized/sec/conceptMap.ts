// lib/discovery/normalized/sec/conceptMap.ts

// LEAPS-QV-0001 Gate 2b -- the versioned, deterministic XBRL concept map. The strategy never sees a tag: this table
// is the only place a us-gaap / dei tag is chosen, and a pinned fingerprint test fails if it changes without a
// version bump (Quinn: "version material tag-resolution methodology").
//
// Resolution modes (per logical item and period):
//   EQUIVALENT  every listed tag is a different spelling of the SAME quantity. All tags that report the period must
//               agree exactly; if any two disagree the item is AMBIGUOUS and every dependent metric is INVALID
//               (fail closed -- we never guess which tag the issuer "meant").
//   ORDERED     the tags are documented fall-backs in priority order; the first tag that reports the period wins.
//               Different periods may use different tags (an issuer migrating tags over time).
//
// Definitions fixed here (a change to any of them is a new version):
//   revenue-v1     total revenue as tagged; EQUIVALENT across the four revenue tags.
//   capex-v1       cash paid for property, plant and equipment (productive assets as fall-back). Capitalized software,
//                  acquired intangibles and leases are NOT included.
//   ebitda-v1      operating income + depreciation and amortization (TTM). No add-backs.
//   debt-v1        see DEBT_RECIPES; lease obligations are NOT included; a company that tags no debt at all is
//                  UNAVAILABLE (absence of a tag cannot be told apart from zero).
//   epsTtm-v1      diluted EPS: FY + current YTD - prior-year YTD (sum of reported per-share values).
//   marketCap-v1   last close x cover-page shares outstanding, accepted only if within MARKET_CAP_SHARES_TOLERANCE of
//                  the weighted-average diluted share count (catches multi-class issuers).
//   ev-v1          market cap + total debt - cash and equivalents (no minority interest or preferred).

import { stableStringify } from '../../util';

export const SEC_CONCEPT_MAP_VERSION = 'SECMAP-v1.0';

export type SecUnit = 'USD' | 'USD/shares' | 'shares';
export type SecItemKind = 'DURATION' | 'INSTANT';
export type SecResolutionMode = 'EQUIVALENT' | 'ORDERED';

export interface SecItemDef {
  readonly id: string;
  readonly kind: SecItemKind;
  readonly unit: SecUnit;
  readonly mode: SecResolutionMode;
  readonly taxonomy: 'us-gaap' | 'dei';
  readonly tags: readonly string[];
}

function item(
  id: string,
  kind: SecItemKind,
  unit: SecUnit,
  mode: SecResolutionMode,
  tags: string[],
  taxonomy: 'us-gaap' | 'dei' = 'us-gaap',
): SecItemDef {
  return Object.freeze({ id, kind, unit, mode, taxonomy, tags: Object.freeze(tags) });
}

export const SEC_ITEMS: Readonly<Record<string, SecItemDef>> = Object.freeze({
  revenue: item('revenue', 'DURATION', 'USD', 'EQUIVALENT', [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
  ]),
  operatingIncome: item('operatingIncome', 'DURATION', 'USD', 'EQUIVALENT', ['OperatingIncomeLoss']),
  pretaxIncome: item('pretaxIncome', 'DURATION', 'USD', 'EQUIVALENT', [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
  ]),
  incomeTax: item('incomeTax', 'DURATION', 'USD', 'EQUIVALENT', ['IncomeTaxExpenseBenefit']),
  dilutedEps: item('dilutedEps', 'DURATION', 'USD/shares', 'EQUIVALENT', ['EarningsPerShareDiluted']),
  dilutedShares: item('dilutedShares', 'DURATION', 'shares', 'EQUIVALENT', ['WeightedAverageNumberOfDilutedSharesOutstanding']),
  operatingCashFlow: item('operatingCashFlow', 'DURATION', 'USD', 'ORDERED', [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ]),
  capex: item('capex', 'DURATION', 'USD', 'ORDERED', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']),
  depreciationAmortization: item('depreciationAmortization', 'DURATION', 'USD', 'ORDERED', [
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
  ]),
  interestExpense: item('interestExpense', 'DURATION', 'USD', 'ORDERED', ['InterestExpense', 'InterestExpenseDebt']),
  cash: item('cash', 'INSTANT', 'USD', 'EQUIVALENT', ['CashAndCashEquivalentsAtCarryingValue']),
  totalEquity: item('totalEquity', 'INSTANT', 'USD', 'ORDERED', [
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'StockholdersEquity',
  ]),
  currentAssets: item('currentAssets', 'INSTANT', 'USD', 'EQUIVALENT', ['AssetsCurrent']),
  currentLiabilities: item('currentLiabilities', 'INSTANT', 'USD', 'EQUIVALENT', ['LiabilitiesCurrent']),
  longTermDebt: item('longTermDebt', 'INSTANT', 'USD', 'EQUIVALENT', ['LongTermDebt']),
  longTermDebtNoncurrent: item('longTermDebtNoncurrent', 'INSTANT', 'USD', 'EQUIVALENT', ['LongTermDebtNoncurrent']),
  longTermDebtCurrent: item('longTermDebtCurrent', 'INSTANT', 'USD', 'EQUIVALENT', ['LongTermDebtCurrent']),
  debtCurrent: item('debtCurrent', 'INSTANT', 'USD', 'EQUIVALENT', ['DebtCurrent']),
  shortTermBorrowings: item('shortTermBorrowings', 'INSTANT', 'USD', 'EQUIVALENT', ['ShortTermBorrowings']),
  commercialPaper: item('commercialPaper', 'INSTANT', 'USD', 'EQUIVALENT', ['CommercialPaper']),
  sharesOutstanding: item('sharesOutstanding', 'INSTANT', 'shares', 'EQUIVALENT', ['EntityCommonStockSharesOutstanding'], 'dei'),
});

export const DEBT_RECIPE_VERSION = 'DEBT-v1';

/**
 * Debt recipes, tried in order; the first whose required items are all reported at the balance-sheet date is used.
 *  A: LongTermDebt (includes current maturities) + ShortTermBorrowings + CommercialPaper when reported.
 *  B: LongTermDebtNoncurrent + LongTermDebtCurrent (required) + ShortTermBorrowings + CommercialPaper when reported.
 *  C: LongTermDebtNoncurrent + DebtCurrent (required; DebtCurrent already includes short-term borrowings).
 * When A and B can both be computed their long-term parts must agree exactly, otherwise the debt is AMBIGUOUS.
 */
export const DEBT_RECIPES: ReadonlyArray<{ readonly id: string; readonly required: readonly string[]; readonly optional: readonly string[] }> =
  Object.freeze([
    Object.freeze({ id: 'A', required: Object.freeze(['longTermDebt']), optional: Object.freeze(['shortTermBorrowings', 'commercialPaper']) }),
    Object.freeze({
      id: 'B',
      required: Object.freeze(['longTermDebtNoncurrent', 'longTermDebtCurrent']),
      optional: Object.freeze(['shortTermBorrowings', 'commercialPaper']),
    }),
    Object.freeze({ id: 'C', required: Object.freeze(['longTermDebtNoncurrent', 'debtCurrent']), optional: Object.freeze([]) }),
  ]);

/** Cover-page share count must be within this fraction of the weighted-average diluted share count (data sanity). */
export const MARKET_CAP_SHARES_TOLERANCE = 0.25;

/** Forms whose facts are used. Anything else (8-K, S-1, 20-F ...) is dropped and counted. */
export const SEC_ACCEPTED_FORMS: readonly string[] = Object.freeze(['10-K', '10-K/A', '10-Q', '10-Q/A']);

/** Every (taxonomy, tag) the map can read: the compaction filter. */
export function neededTags(): ReadonlyArray<{ readonly taxonomy: string; readonly tag: string; readonly unit: SecUnit }> {
  const out: Array<{ taxonomy: string; tag: string; unit: SecUnit }> = [];
  Object.keys(SEC_ITEMS).forEach((key) => {
    const def = SEC_ITEMS[key];
    def.tags.forEach((tag) => out.push({ taxonomy: def.taxonomy, tag, unit: def.unit }));
  });
  return out;
}

/** Fingerprint input for the "map changed without a version bump" test. */
export function conceptMapFingerprintSource(): string {
  return stableStringify({ version: SEC_CONCEPT_MAP_VERSION, items: SEC_ITEMS, debt: DEBT_RECIPES, tolerance: MARKET_CAP_SHARES_TOLERANCE, forms: SEC_ACCEPTED_FORMS });
}
