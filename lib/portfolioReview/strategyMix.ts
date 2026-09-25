// lib/portfolioReview/strategyMix.ts
//
// The "strategy mix" line in the portfolio AI prompt: how many open positions per strategy. Counts every
// distinct strategy present (cash-secured puts, covered calls, PMCC, LEAPS, stock and so on), so the
// counts always add up to the number of positions. The prompt used to name only BPS, BCS and IC and lump
// everything else into "Other", which hid what the rest of the book actually is.

export function countByStrategy(strategies: readonly (string | null | undefined)[]): Array<{ strategy: string; count: number }> {
  const counts = new Map<string, number>();
  for (const raw of strategies) {
    const key = raw && raw.trim() ? raw : 'UNKNOWN';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([strategy, count]) => ({ strategy, count }))
    .sort((a, b) => b.count - a.count || a.strategy.localeCompare(b.strategy));
}

export function formatStrategyMix(strategies: readonly (string | null | undefined)[]): string {
  const rows = countByStrategy(strategies);
  return rows.length === 0 ? 'None' : rows.map(r => `${r.strategy}: ${r.count}`).join(' | ');
}
