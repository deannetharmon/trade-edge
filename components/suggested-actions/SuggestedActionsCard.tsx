// components/suggested-actions/SuggestedActionsCard.tsx
//
// SUGGESTED-ACTIONS-0001 slice 4: dashboard "Suggested Actions" section, built from Diane's mock.
// Suggestion only: a tap opens the existing Screener PMCC short-call review for that exact LEAPS and
// places nothing. Renders nothing when there are no cards. When quotes are stale the cards are greyed
// and not tappable until Refresh succeeds.

'use client';

import { useState } from 'react';
import type { THEMES, Theme } from '@/lib/theme';
import { launchPmccShortCallReview } from '@/lib/scans/pmccReviewHandoff';
import type { PmccShortCallCard, PmccSuggestionResult } from '@/lib/suggested-actions/pmccShortCallSuggestion';

export interface SuggestedActionsCardProps {
  result: PmccSuggestionResult;
  th: (typeof THEMES)[Theme];
  /** Re-fetches broker data (the dashboard's refresh). */
  onRefresh: () => Promise<unknown> | void;
  /** Defaults to the shared hand-off; injectable for tests. */
  onOpen?: (card: PmccShortCallCard) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'Jan 21 2028' without a timezone shift. The full date tells two LEAPS on one symbol apart. */
export function formatExpiration(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])} ${m[1]}`;
}

function money(value: number): string {
  const abs = Math.abs(Math.round(value)).toLocaleString('en-US');
  return `${value < 0 ? '-' : '+'}$${abs}`;
}

function defaultOpen(card: PmccShortCallCard) {
  launchPmccShortCallReview(card.opportunity);
}

export function SuggestedActionsCard({ result, th, onRefresh, onOpen = defaultOpen }: SuggestedActionsCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  if (result.cards.length === 0) return null;
  const { stale } = result;

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return (
    <section aria-label="Suggested Actions" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Suggested Actions</h2>
        {stale ? (
          <div className="flex items-center gap-2.5">
            <span className={`text-[11px] ${th.textMuted}`}>
              As of {result.asOf ? result.asOf.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'unknown'} · quotes are over 2 minutes old
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="min-h-[44px] rounded-lg border border-[var(--accent)] px-4 text-[12px] font-semibold text-[var(--accent)] hover:opacity-80 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        ) : (
          <span className={`text-[11px] ${th.textFaint}`}>LEAPS up 100% or more</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {result.cards.map(card => (
          <button
            key={card.positionKey}
            type="button"
            disabled={stale}
            aria-disabled={stale}
            onClick={() => onOpen(card)}
            data-testid={`suggested-action-${card.positionKey}`}
            className={`flex w-full min-h-[68px] flex-col gap-2 rounded-[10px] border ${th.borderLight} ${th.cardQualified} px-3.5 py-3 text-left sm:flex-row sm:items-center sm:gap-4 ${stale ? 'cursor-not-allowed opacity-60' : `${th.border} hover:border-[var(--accent)]`}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-[15px] font-bold ${th.text}`}>{card.symbol}</span>
                <span className={`text-[12px] ${th.textMuted}`}>${card.strike} call · {formatExpiration(card.expiration)} · ×{card.quantity}</span>
              </div>
              {card.spot != null && <span className={`text-[12px] ${th.textFaint}`}>Stock ${card.spot.toFixed(2)}</span>}
            </div>
            <div className="flex flex-col sm:w-[130px] sm:items-end">
              <span className={`text-[18px] font-bold ${stale ? th.textMuted : 'text-emerald-500'}`}>+{Math.round(card.gain * 100)}%</span>
              <span className={`text-[12px] ${stale ? th.textFaint : 'text-emerald-500'}`}>{money(card.gainDollars)} (mid)</span>
            </div>
            <div className="flex flex-col items-start gap-1 sm:w-[220px]">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${stale ? `${th.tag} ${th.border} ${th.textMuted}` : 'border-[var(--accent)] text-[var(--accent)]'}`}
                style={stale ? undefined : { background: 'rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.15)' }}
              >
                {card.badge}
              </span>
              <span className={`text-[11px] ${th.textFaint}`}>{card.windowText}</span>
            </div>
          </button>
        ))}
      </div>

      {result.overflow > 0 && (
        <p className={`mt-2.5 text-[11px] ${th.textFaint}`}>+{result.overflow} more LEAPS qualify</p>
      )}
    </section>
  );
}
