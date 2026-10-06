// lib/discovery/qv/runUniverse.ts

// LEAPS-QV-0001 -- Gate 3 input builder, run over a symbol list (spec Section 5). Fetchers, clock and sleep are injected
// (the browser binding is lib/scans/qvUniverseTransport.ts), so this module stays I/O-free. Concurrency 3; a symbol's
// sources time out after 30 s; one symbol's failure never affects another; output is in input order and is exactly the
// {symbol, evaluation} pairs Gate 4c's runQvLeaps consumes. No previous state exists until Gate 7, so none is passed.

import { runStrategy, type StrategyEvaluation, type StrategyInput } from '../evaluation';
import { assembleQvStrategyInput, QvAssemblyContractError, type FundamentalsSource, type MarketMetricsSource } from './assembleInput';
import { QV_V1_0_STRATEGY } from './strategy';

export interface QvUniverseDeps {
  fetchFundamentals: (symbol: string) => Promise<FundamentalsSource>;
  /** One request for up to `marketMetricsBatch` symbols; a symbol absent from the reply is reported as such. */
  fetchMarketMetrics: (symbols: string[]) => Promise<Record<string, MarketMetricsSource>>;
  now: () => string;
  sleep: (ms: number) => Promise<void>;
}

export const QV_UNIVERSE_RUN_LIMITS = Object.freeze({ concurrency: 3, perSymbolTimeoutMs: 30000, marketMetricsBatch: 50 });

export interface QvUniverseEntry {
  symbol: string;
  input: StrategyInput;
  evaluation: StrategyEvaluation;
  sourceIssues: string[];
  /** Gate 7 adds persisted lifecycle state; until then transitions are not computed. */
  previousState: null;
}

export interface QvUniverseRun {
  entries: QvUniverseEntry[];
  asOf: string;
}

const TIMED_OUT = Symbol('timed-out');

export async function runQvUniverse(rawSymbols: readonly string[], deps: QvUniverseDeps, limits = QV_UNIVERSE_RUN_LIMITS): Promise<QvUniverseRun> {
  const symbols: string[] = [];
  rawSymbols.forEach((s) => {
    const sym = s.trim().toUpperCase();
    if (sym && symbols.indexOf(sym) < 0) symbols.push(sym);
  });

  // Earnings dates: one market-metrics request per batch; a failed batch marks its symbols unavailable.
  const market: Record<string, MarketMetricsSource> = {};
  for (let i = 0; i < symbols.length; i += limits.marketMetricsBatch) {
    const batch = symbols.slice(i, i + limits.marketMetricsBatch);
    let reply: Record<string, MarketMetricsSource> = {};
    try {
      reply = await deps.fetchMarketMetrics(batch);
    } catch {
      reply = {};
      batch.forEach((s) => { reply[s] = { ok: false, reason: 'MARKET_METRICS_UNAVAILABLE' }; });
    }
    batch.forEach((s) => { market[s] = reply[s] ?? { ok: false, reason: 'MARKET_METRICS_NO_ITEM' }; });
  }

  // Fundamentals + price history, at most `concurrency` at a time, each with its own time budget.
  const fundamentals: FundamentalsSource[] = new Array(symbols.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= symbols.length) return;
      try {
        const outcome = await Promise.race([deps.fetchFundamentals(symbols[index]), deps.sleep(limits.perSymbolTimeoutMs).then(() => TIMED_OUT)]);
        fundamentals[index] = outcome === TIMED_OUT ? { ok: false, reason: 'FUNDAMENTALS_TIMEOUT' } : outcome as FundamentalsSource;
      } catch {
        fundamentals[index] = { ok: false, reason: 'FUNDAMENTALS_NETWORK' };
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, limits.concurrency); i += 1) workers.push(worker());
  await Promise.all(workers);

  // One evaluation instant, read after all fetches.
  const asOf = deps.now();
  const entries = symbols.map((symbol, i) => {
    let assembled;
    try {
      assembled = assembleQvStrategyInput({ symbol, asOf, fundamentals: fundamentals[i], marketMetrics: market[symbol] });
    } catch (error) {
      if (!(error instanceof QvAssemblyContractError)) throw error;
      // Fail closed: a source contract violation discards that symbol's data rather than guessing which copy is right.
      assembled = assembleQvStrategyInput({
        symbol, asOf,
        fundamentals: { ok: false, reason: 'ASSEMBLY_CONTRACT_ERROR' },
        marketMetrics: { ok: false, reason: 'ASSEMBLY_CONTRACT_ERROR' },
      });
    }
    const evaluation = runStrategy(QV_V1_0_STRATEGY, assembled.input);
    return { symbol, input: assembled.input, evaluation, sourceIssues: assembled.sourceIssues, previousState: null };
  });
  return { entries, asOf };
}
