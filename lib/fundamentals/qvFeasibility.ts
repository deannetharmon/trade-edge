// lib/fundamentals/qvFeasibility.ts

// LEAPS-QV-0001 -- Gate 3 input builder feasibility run (spec Section 6), behind GET /api/qv-feasibility?symbols=A,B.
// Read-only and signed-in only: for each symbol it loads fundamentals + price history exactly as /api/fundamentals does,
// assembles the QV-v1.0 input and runs the strategy, then reports the state, what blocked it and any source issues.
// The TastyTrade earnings date is not fetched here (server-side broker reads are not this route's job); it is
// informational in QV-v1.0 and reported as a source issue, never guessed.

import { runQvUniverse, type FundamentalsSource } from '@/lib/discovery/qv';
import { handleFundamentalsRequest, type HandlerDeps } from './handler';
import type { LoadedFundamentals } from './secFundamentals';

export const QV_FEASIBILITY_MAX_SYMBOLS = 25;

export interface QvFeasibilityRow {
  symbol: string;
  state: string;
  blockingMetricIds: string[];
  /** Why each blocking metric is not usable: the loader's own validity and reason (e.g. CONCEPT_NOT_FOUND). */
  blockingReasons: Record<string, string>;
  sourceIssues: string[];
  reasonCodes: string[];
}

export async function handleQvFeasibility(symbolsParam: string | null, deps: HandlerDeps): Promise<{ status: number; body: { asOf: string; rows: QvFeasibilityRow[] } | { error: string } }> {
  if (!deps.userId) return { status: 401, body: { error: 'Unauthorized' } };
  const symbols = (symbolsParam ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (symbols.length === 0) return { status: 400, body: { error: 'symbols param required, e.g. ?symbols=UBER,NFLX' } };
  if (symbols.length > QV_FEASIBILITY_MAX_SYMBOLS) return { status: 400, body: { error: `at most ${QV_FEASIBILITY_MAX_SYMBOLS} symbols` } };

  const run = await runQvUniverse(symbols, {
    fetchFundamentals: async (symbol): Promise<FundamentalsSource> => {
      const res = await handleFundamentalsRequest(symbol, deps);
      if (res.status !== 200) return { ok: false, reason: `FUNDAMENTALS_HTTP_${res.status}` };
      const body = res.body as LoadedFundamentals;
      const issues = [body.priceIssue, body.benchmarkIssue, body.calendarIssue, body.benchmarkCalendarIssue].filter((x): x is string => !!x);
      if (body.coverage !== 'COVERED') issues.push(`SEC_${body.coverage}`);
      return { ok: true, metrics: body.metrics, technicals: body.technicals, issues };
    },
    fetchMarketMetrics: async (batch) => Object.fromEntries(batch.map((s) => [s, { ok: false as const, reason: 'MARKET_METRICS_NOT_FETCHED_IN_FEASIBILITY_RUN' }])),
    now: deps.nowIso,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  });

  const rows = run.entries.map((e) => {
    const outcome = e.evaluation.outcome;
    const blocking = outcome.kind === 'INSUFFICIENT_DATA' ? [...outcome.missingMetricIds] : [];
    const blockingReasons: Record<string, string> = {};
    blocking.forEach((id) => {
      const m = e.input.metrics[id] as { validity?: string; reason?: string; ageMs?: number } | undefined;
      blockingReasons[id] = m ? `${m.validity}${m.reason ? `: ${m.reason}` : ''}${m.ageMs != null ? ` (age ${Math.round(m.ageMs / 86400000)} d)` : ''}` : 'NOT_IN_INPUT';
    });
    // QV-v1.0 screens operating companies; a fund with no SEC company filings is out of scope, not "insufficient".
    const notApplicable = e.sourceIssues.indexOf('SEC_NOT_COVERED') >= 0;
    return {
      symbol: e.symbol,
      state: notApplicable ? 'NOT_APPLICABLE_NO_COMPANY_FILINGS' : outcome.kind === 'CLASSIFIED' ? outcome.state : 'INSUFFICIENT_DATA',
      blockingMetricIds: blocking,
      blockingReasons,
      sourceIssues: e.sourceIssues.filter((x) => x !== 'MARKET_METRICS_NOT_FETCHED_IN_FEASIBILITY_RUN'),
      reasonCodes: e.evaluation.reasonCodes.map((r) => String((r as { code?: string }).code ?? r)),
    };
  });
  return { status: 200, body: { asOf: run.asOf, rows } };
}
