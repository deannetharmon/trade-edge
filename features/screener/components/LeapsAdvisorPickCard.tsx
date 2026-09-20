// features/screener/components/LeapsAdvisorPickCard.tsx
//
// LEAPS-DASH-0003 -- one LEAPS Advisor pick as a dashboard card: TradeEdge score, readable contract, five tiles, and
// rule-computed callouts. The advisor's own reasoning is collapsed underneath. Purely presentational: the numbers and
// callouts come from buildLeapsPickSummary (lib/leaps-analysis/dashboard.ts).

import type { LeapsPickSummary } from '@/lib/leaps-analysis/dashboard';
import { BORDER, CalloutList, TEXT } from './LeapsAnalysisDashboard';

export function LeapsAdvisorPickCard({ th, symbol, contractLabel, score, summary, reasoning, verifyEnabled, onVerify }: {
  th: { text: string; textMuted: string };
  symbol: string;
  contractLabel: string;
  score: number | null;
  summary: LeapsPickSummary | null;
  reasoning: string;
  verifyEnabled: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 p-3" data-testid="leaps-advisor-pick-card">
      <div className="flex items-start gap-3">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-md border border-violet-500/60 py-1">
          <span className="font-mono text-lg font-semibold text-violet-200">{score ?? '—'}</span>
          <span className="text-[9px] uppercase tracking-wider text-neutral-400">score</span>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className={`${th.text} text-[15px] font-bold tracking-wide`}>{symbol}</span>
            <span className={`${th.text} font-mono text-[13px]`}>{contractLabel}</span>
          </p>
          {summary && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {summary.tiles.map(tile => (
                <div key={tile.id} className={`rounded-md border px-2 py-1 ${BORDER[tile.tone]} bg-neutral-900/60`}>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">{tile.label}</div>
                  <div className={`font-mono text-sm font-semibold ${tile.tone === 'neutral' ? th.text : TEXT[tile.tone]}`}>{tile.value}</div>
                </div>
              ))}
            </div>
          )}
          {summary && <CalloutList callouts={summary.callouts} th={th} compact />}
          {reasoning && (
            <details className="rounded border border-neutral-800 p-2">
              <summary className="cursor-pointer text-[10px] font-bold text-neutral-400">Why the advisor picked this</summary>
              <p className={`mt-1 text-[11px] ${th.text}`}>{reasoning}</p>
            </details>
          )}
        </div>
        <button
          onClick={onVerify}
          disabled={!verifyEnabled}
          title={verifyEnabled ? undefined : 'This candidate is no longer in your filtered results.'}
          className="shrink-0 rounded border border-cyan-500 px-2 py-0.5 text-[9px] font-bold text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Verify before trading →
        </button>
      </div>
    </div>
  );
}
