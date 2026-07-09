// features/screener/components/RankedScoreTierSummary.tsx
//
// Rank-mode-only score-tier counts (🟢🟡🟠🔴), extracted verbatim from
// app/screener/page.tsx's results-header JSX (RF-0001). Pure presentational
// — same className/markup/emoji, same scoreCandidate() call, same
// rankConfig thresholds. No behavior or visual change.

'use client';

import { scoreCandidate } from '@/lib/scans/rank-scoring';
import type { RankConfig, ScreenResult } from '@/lib/scans/types';

export interface RankedScoreTierSummaryProps {
  results: ScreenResult[];
  rankConfig: RankConfig;
}

export function RankedScoreTierSummary({ results, rankConfig }: RankedScoreTierSummaryProps) {
  return (
    <>
      <span className="text-emerald-400">{results.filter(r => { const s = scoreCandidate(r, rankConfig)?.score ?? 0; return s >= rankConfig.thresholdGreen; }).length} 🟢</span>
      <span className="text-yellow-400">{results.filter(r => { const s = scoreCandidate(r, rankConfig)?.score ?? 0; return s >= rankConfig.thresholdYellow && s < rankConfig.thresholdGreen; }).length} 🟡</span>
      <span className="text-orange-400">{results.filter(r => { const s = scoreCandidate(r, rankConfig)?.score ?? 0; return s >= rankConfig.thresholdOrange && s < rankConfig.thresholdYellow; }).length} 🟠</span>
      <span className="text-red-400">{results.filter(r => { const s = scoreCandidate(r, rankConfig)?.score ?? 0; return s < rankConfig.thresholdOrange; }).length} 🔴</span>
    </>
  );
}

