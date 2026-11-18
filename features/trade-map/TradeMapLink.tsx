// features/trade-map/TradeMapLink.tsx
//
// OPTMAP-0001 S2e: small "Trade Map" link for result cards. Opens the Trade Map
// in a new tab prefilled with the candidate. Display only.

'use client';

import { candidateTradeMapUrl, type CandidateLike } from '@/lib/trademap/candidateLink';

export default function TradeMapLink({ symbol, candidate, className }: { symbol: string; candidate?: CandidateLike | null; className?: string }) {
  return (
    <a
      href={candidateTradeMapUrl(symbol, candidate)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      data-testid="trade-map-link"
      className={className ?? 'text-[10px] font-semibold tracking-wide text-[var(--accent,#3b82f6)] hover:underline'}
    >
      Trade Map ↗
    </a>
  );
}
