// lib/fundamentals/fmpClient.ts
//
// FUNDAMENTALS-0001: pure fetch functions for Financial Modeling Prep's
// stable endpoints. Confirmed real URLs (fetched from FMP's own docs,
// 2026-09-04):
//   https://financialmodelingprep.com/stable/price-target-consensus?symbol=X
//   https://financialmodelingprep.com/stable/price-target-summary?symbol=X
// grades-summary follows the same stable/{name}?symbol=X pattern as the
// two confirmed endpoints, but wasn't independently verified -- treat its
// exact path/fields as unconfirmed the same as the two above.
//
// Deliberately returns unknown/raw JSON, not a typed interface. FMP's docs
// describe the fields in prose (high/low/median/consensus targets; average
// targets over lastMonth/lastQuarter/lastYear/allTime; analyst coverage
// counts) but don't expose the exact JSON key names in fetchable text.
// Per Alan's explicit requirement, scoring math must be built against
// CONFIRMED real field names, not guessed ones -- see
// app/debug/fundamentals/page.tsx, which exists specifically to let Dean
// inspect a real response before anything reads specific keys from it.

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_LEGACY_BASE = 'https://financialmodelingprep.com/api/v3';

async function fetchFmp(path: string, symbol: string): Promise<unknown> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY is not configured');
  const url = `${FMP_BASE}/${path}?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed != null && 'error' in (parsed as Record<string, unknown>)
      ? String((parsed as Record<string, unknown>).error)
      : body.slice(0, 300);
    throw new Error(`FMP ${path} failed (${response.status}): ${detail}`);
  }
  return parsed;
}

export function fetchPriceTargetConsensus(symbol: string): Promise<unknown> {
  return fetchFmp('price-target-consensus', symbol);
}

export function fetchPriceTargetSummary(symbol: string): Promise<unknown> {
  return fetchFmp('price-target-summary', symbol);
}

export function fetchGradesSummary(symbol: string): Promise<unknown> {
  return fetchFmp('grades-summary', symbol);
}

// FUNDAMENTALS-0002: valuation compression needs multiple historical
// periods -- FMP has no single field for "current vs. 3-year median", so
// this is computed from the plain Ratios endpoint's history ourselves.
// Path pattern confirmed against the same stable/{name}?symbol=X
// convention as everything else here; still unverified for its exact
// field names until checked on /debug/fundamentals.
export function fetchRatiosHistory(symbol: string): Promise<unknown> {
  return fetchFmp('ratios', symbol);
}

// FUNDAMENTALS-0002: standard financial-statement endpoints, needed to
// compute the Altman Z"-Score ourselves (see computeZDoublePrimeScore
// below) rather than reading FMP's own Financial Health Scores endpoint,
// which computes the classic manufacturing-calibrated Z-Score -- confirmed
// from FMP's own docs wording ("a credit-strength test... for publicly
// traded manufacturing companies"). That version's Sales/Total-Assets
// component systematically penalizes asset-light, R&D-heavy companies
// (Ian: exactly the kind of company Dean actually trades -- BE, NFLX,
// NVDA, MRNA), so it was never the right choice for this app even though
// it would have been one field instead of two extra endpoint calls.
//
// Path pattern (stable/{name}?symbol=X) matches the three confirmed
// FUNDAMENTALS-0001 endpoints plus income-statement-ttm, independently
// confirmed via FMP's own docs during scoping -- high confidence, but
// still unverified for these specific two until checked against real
// output via the debug page, same as everything else in this file.
export function fetchBalanceSheetStatement(symbol: string): Promise<unknown> {
  return fetchFmp('balance-sheet-statement', symbol);
}

export function fetchIncomeStatement(symbol: string): Promise<unknown> {
  return fetchFmp('income-statement', symbol);
}

// FUNDAMENTALS-0002: also covers Paul's FCF signal -- operatingCashFlow
// minus capitalExpenditure, both standard fields on this statement.
export function fetchCashFlowStatement(symbol: string): Promise<unknown> {
  return fetchFmp('cash-flow-statement', symbol);
}

export interface FmpEventCalendarBundle {
  symbol: string;
  fetchedAt: string;
  earnings: unknown;
  dividends: unknown;
  splits: unknown;
}

async function fetchFmpCalendar(path: string, from: string, to: string): Promise<unknown> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY is not configured');
  const url = `${FMP_LEGACY_BASE}/${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${apiKey}`;
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  if (!response.ok) throw new Error(`FMP ${path} failed (${response.status})`);
  return parsed;
}

/** Raw calendar spike. Fields deliberately remain untrusted until a deployed
 * response confirms the account's plan, schema, and date semantics. */
export async function fetchEventCalendarBundle(symbol: string, from: string, to: string): Promise<FmpEventCalendarBundle> {
  const [earnings, dividends, splits] = await Promise.all([
    fetchFmpCalendar('earning_calendar', from, to),
    fetchFmpCalendar('stock_dividend_calendar', from, to),
    fetchFmpCalendar('stock_split_calendar', from, to),
  ]);
  return { symbol, fetchedAt: new Date().toISOString(), earnings, dividends, splits };
}

export interface FundamentalsBundle {
  symbol: string;
  fetchedAt: string;
  priceTargetConsensus: unknown;
  priceTargetSummary: unknown;
  gradesSummary: unknown;
  // FUNDAMENTALS-0002
  balanceSheetStatement: unknown;
  incomeStatement: unknown;
  cashFlowStatement: unknown;
  ratiosHistory: unknown;
  // Computed from the raw statements above. null when the raw data
  // doesn't contain the fields the computation expects (unverified field
  // mapping, or a symbol with genuinely missing data), never a fabricated
  // number.
  zDoublePrimeScore: ZScoreResult | null;
  freeCashFlow: number | null;
  valuationCompression: ValuationCompressionResult | null;
}

// Bundles all seven calls together so a single cache write/read covers the
// full fundamentals picture for a symbol -- a cache HIT saves all seven
// FMP calls at once, not just one. Each call fails independently rather
// than failing the whole bundle -- a symbol with grades data but no
// consensus data yet (e.g. very thin coverage) still returns what's
// available rather than nothing.
export async function fetchFundamentalsBundle(symbol: string): Promise<FundamentalsBundle> {
  const [priceTargetConsensus, priceTargetSummary, gradesSummary, balanceSheetStatement, incomeStatement, cashFlowStatement, ratiosHistory] = await Promise.all([
    fetchPriceTargetConsensus(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchPriceTargetSummary(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchGradesSummary(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchBalanceSheetStatement(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchIncomeStatement(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchCashFlowStatement(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchRatiosHistory(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ]);
  return {
    symbol, fetchedAt: new Date().toISOString(),
    priceTargetConsensus, priceTargetSummary, gradesSummary,
    balanceSheetStatement, incomeStatement, cashFlowStatement, ratiosHistory,
    zDoublePrimeScore: computeZDoublePrimeScore(balanceSheetStatement, incomeStatement),
    freeCashFlow: computeFreeCashFlow(cashFlowStatement),
    valuationCompression: computeValuationCompression(ratiosHistory),
  };
}

export interface ZScoreResult {
  score: number;
  components: { workingCapitalToAssets: number; retainedEarningsToAssets: number; ebitToAssets: number; equityToLiabilities: number };
}

// FUNDAMENTALS-0002: Altman Z"-Score (non-manufacturer variant), computed
// directly rather than read from FMP's own Financial Health Scores
// endpoint -- see the comment on fetchBalanceSheetStatement above for why.
//
//   Z" = 6.56A + 3.26B + 6.72C + 1.05D
//   A = Working Capital / Total Assets
//   B = Retained Earnings / Total Assets
//   C = EBIT / Total Assets
//   D = Book Value of Equity / Total Liabilities
//
// Field names below (totalAssets, totalCurrentAssets, etc.) are FMP's
// standard, widely-documented naming convention -- but per Alan's explicit
// requirement, treat this as UNVERIFIED until checked against real output
// on /debug/fundamentals. Returns null rather than a fabricated number if
// any required field is missing -- this must never silently produce a
// score from partial or wrong data.
//
// Ian: no threshold is set anywhere on this value. It's returned and
// displayed as a plain number for review, not gated on, until Ian has
// seen it across enough real candidates to trust a cutoff.
export function computeZDoublePrimeScore(balanceSheetStatement: unknown, incomeStatement: unknown): ZScoreResult | null {
  const bs = firstStatementPeriod(balanceSheetStatement);
  const is = firstStatementPeriod(incomeStatement);
  if (!bs || !is) return null;

  const totalAssets = numberField(bs, 'totalAssets');
  const totalCurrentAssets = numberField(bs, 'totalCurrentAssets');
  const totalCurrentLiabilities = numberField(bs, 'totalCurrentLiabilities');
  const retainedEarnings = numberField(bs, 'retainedEarnings');
  const totalStockholdersEquity = numberField(bs, 'totalStockholdersEquity');
  const totalLiabilities = numberField(bs, 'totalLiabilities');
  const ebit = numberField(is, 'operatingIncome');

  if ([totalAssets, totalCurrentAssets, totalCurrentLiabilities, retainedEarnings, totalStockholdersEquity, totalLiabilities, ebit].some(v => v == null)) {
    return null;
  }
  if (totalAssets === 0 || totalLiabilities === 0) return null;

  const workingCapitalToAssets = (totalCurrentAssets! - totalCurrentLiabilities!) / totalAssets!;
  const retainedEarningsToAssets = retainedEarnings! / totalAssets!;
  const ebitToAssets = ebit! / totalAssets!;
  const equityToLiabilities = totalStockholdersEquity! / totalLiabilities!;

  const score = 6.56 * workingCapitalToAssets + 3.26 * retainedEarningsToAssets + 6.72 * ebitToAssets + 1.05 * equityToLiabilities;
  return { score, components: { workingCapitalToAssets, retainedEarningsToAssets, ebitToAssets, equityToLiabilities } };
}

function firstStatementPeriod(statement: unknown): Record<string, unknown> | null {
  if (Array.isArray(statement) && statement.length > 0 && typeof statement[0] === 'object' && statement[0] != null) {
    return statement[0] as Record<string, unknown>;
  }
  return null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// FUNDAMENTALS-0002: Paul's FCF signal -- operatingCashFlow minus
// capitalExpenditure, both standard fields on the cash flow statement.
// FMP typically reports capitalExpenditure as a negative number
// (cash outflow); this handles either sign convention rather than assume
// one, since that specific convention wasn't independently confirmed.
export function computeFreeCashFlow(cashFlowStatement: unknown): number | null {
  const period = firstStatementPeriod(cashFlowStatement);
  if (!period) return null;
  const operatingCashFlow = numberField(period, 'operatingCashFlow');
  const capitalExpenditure = numberField(period, 'capitalExpenditure');
  if (operatingCashFlow == null || capitalExpenditure == null) return null;
  return operatingCashFlow - Math.abs(capitalExpenditure);
}

export interface ValuationCompressionResult {
  metric: 'peRatio';
  current: number;
  historicalMedian: number;
  compressionPct: number; // positive = currently cheaper than its own history
  periodsUsed: number;
}

// FUNDAMENTALS-0002: "current P/E vs. its own 3-year historical median" --
// FMP has no single field for this; computed here from the Ratios
// endpoint's period-by-period history. Uses whatever periods are actually
// available up to 3 years (12 quarterly periods) rather than failing
// outright on a symbol with a shorter public history -- periodsUsed is
// returned so a thin history is visible, not silently treated as a full
// one. Returns null rather than a fabricated result if there's fewer than
// 2 periods to compare against (a "median" of one point isn't meaningful).
export function computeValuationCompression(ratiosHistory: unknown): ValuationCompressionResult | null {
  if (!Array.isArray(ratiosHistory) || ratiosHistory.length === 0) return null;
  const periods = ratiosHistory.slice(0, 12).filter((p): p is Record<string, unknown> => typeof p === 'object' && p != null);
  const peValues = periods.map(p => numberField(p, 'priceToEarningsRatio')).filter((v): v is number => v != null && v > 0);
  if (peValues.length < 2) return null;

  const current = peValues[0];
  const historical = peValues.slice(1);
  const sorted = [...historical].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const historicalMedian = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (historicalMedian === 0) return null;

  const compressionPct = ((historicalMedian - current) / historicalMedian) * 100;
  return { metric: 'peRatio', current, historicalMedian, compressionPct, periodsUsed: peValues.length };
}
