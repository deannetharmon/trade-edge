// lib/trademap/optimizeRank.ts
//
// OPTMAP-0001 S5b (Dean, 2026-11-18): Optimize must return the screener's "Best opportunity", which comes from the
// RANKED scan (every short strike, every width, every 30-45 DTE expiration, scored with the trader's saved rank
// weights, qualified trades only), not from the per-width finder. This calls the screener's own ranked-scan runner for
// the one symbol and keeps the bull put / bear call results. No scoring or qualification lives here.

import { runRankedScan } from '@/lib/scans/ranked-scan-runner';
import { scoreCandidate } from '@/lib/scans/rank-scoring';
import { getSavedEtfRules, getSavedRankConfig, getSavedRules } from '@/lib/scans/savedRules';
import type { RankConfig, ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import type { RulesType } from '@/lib/scans/constants';

export type OptimizeStrategy = 'bps' | 'bcs';

export interface RankedPick {
  candidate: SpreadCandidate;
  score: number;
}

/** The ranked results for one side, best first: only results that have a candidate and a score (the screener drops the rest to the bottom). */
export function pickRanked(results: ScreenResult[], strategy: OptimizeStrategy, rankConfig: RankConfig, limit = 8): RankedPick[] {
  const want = strategy === 'bps' ? 'BPS' : 'BCS';
  const out: RankedPick[] = [];
  for (const r of results) {
    const c = r.bestCandidate;
    if (!c || c.strategy !== want) continue;
    const s = scoreCandidate(r, rankConfig);
    if (!s || !(s.score > 0)) continue;
    out.push({ candidate: c, score: s.score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export interface RankedOptimizeInput {
  symbol: string;
  strategy: OptimizeStrategy;
  sRules?: RulesType;
  eRules?: RulesType;
  rankConfig?: RankConfig;
}

export async function runRankedOptimize(i: RankedOptimizeInput): Promise<{ ranked: RankedPick[]; popMin: number }> {
  const sRules = i.sRules ?? getSavedRules();
  const eRules = i.eRules ?? getSavedEtfRules();
  const rankConfig = i.rankConfig ?? getSavedRankConfig();
  const scan = await runRankedScan({ activeSymbols: [i.symbol], sRules, eRules, rankConfig });
  const first = scan.rawScanCache[0];
  const isEtf = first?.chainData?.isEtfOrIndex === true;
  return { ranked: pickRanked(scan.results, i.strategy, rankConfig), popMin: (isEtf ? eRules : sRules).POP_MIN };
}
