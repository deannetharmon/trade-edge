// components/command-center/PortfolioHealthCard.tsx
//
// TC-0001: Portfolio Health summary card -- displays the existing canonical
// portfolio-health result verbatim (score/classification) plus a link to
// the detailed Portfolio Review. Never computes a new score.

import Link from 'next/link';
import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterHealthViewModel } from '@/lib/command-center';

const STATUS_STYLE: Record<string, string> = {
  Healthy: 'text-emerald-400',
  'Needs Attention': 'text-amber-400',
  'Action Required': 'text-red-400',
};

export interface PortfolioHealthCardProps {
  health: CommandCenterHealthViewModel;
  th: (typeof THEMES)[Theme];
}

export function PortfolioHealthCard({ health, th }: PortfolioHealthCardProps) {
  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`} aria-label="Portfolio Health">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Portfolio Health</h2>
        <Link href="/portfolio" className={`text-[11px] font-semibold underline ${th.textFaint}`}>
          View Portfolio Review
        </Link>
      </div>
      {health.state === 'loaded' && health.score != null && health.status ? (
        <div className="flex items-baseline gap-3">
          <span className={`text-2xl font-bold ${th.text}`}>{health.score}</span>
          <span className={`text-[12px] font-semibold ${STATUS_STYLE[health.status] ?? th.textMuted}`}>{health.status}</span>
        </div>
      ) : (
        <p className={`text-[11px] ${health.state === 'error' ? 'text-red-400' : th.textFaint}`}>
          {health.message ?? 'Portfolio Health is unavailable.'}
        </p>
      )}
    </section>
  );
}
