// features/screener/components/CcBlockedCalls.tsx
//
// CC-VISIBILITY-0001 slice 4 -- greyed list of calls the safety checks keep out of the grid, with each one's reason. Collapsed by
// default, display only: no button, nothing here can be ordered.

import { describeCcBlocked, CC_BLOCKED_LIMIT, type CcBlockedCall } from '@/lib/scans/ccBlocked';

export function CcBlockedCalls({ symbol, calls, total, className = '' }: { symbol: string; calls: CcBlockedCall[]; total: number; className?: string }) {
  if (calls.length === 0) return null;
  return (
    <details data-testid={`cc-blocked-${symbol}`} className={`text-[10px] opacity-70 ${className}`} onClick={e => e.stopPropagation()}>
      <summary className="cursor-pointer">{total} {total === 1 ? 'call' : 'calls'} blocked by the safety checks (not orderable)</summary>
      <ul className="mt-1 space-y-0.5">
        {calls.map(c => <li key={`${c.expiration}-${c.strike}`} className="text-neutral-400">{describeCcBlocked(c)}</li>)}
      </ul>
      {total > CC_BLOCKED_LIMIT && <p className="mt-0.5">Showing the first {CC_BLOCKED_LIMIT}.</p>}
    </details>
  );
}
