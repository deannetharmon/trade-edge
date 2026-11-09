// features/screener/components/CommittedCallsLine.tsx
//
// CC-VISIBILITY-0001 slice 2 -- the ONE place that says which short calls hold a stock's contracts. Used on covered-call
// scan results, and (later slices) the covered-call order window and the Portfolio stock card, so they can never disagree.
// "200 sh · 1 of 2 free" then one line per committed call. Display only; the free count comes from the capacity math,
// the list from the same raw broker rows (committedCalls.ts, tested for parity with those counts).

import { daysUntilNy } from '@/lib/scans/earningsPrecheck';
import { describeCommittedCall, type CommittedCall } from '@/lib/portfolio-snapshot/committedCalls';

export interface CommittedCallsLineProps {
  symbol: string;
  sharesOwned: number;
  /** Whole contracts the shares can cover (floor(shares / 100)). */
  gross: number;
  /** Contracts still free (never below 0). */
  available: number;
  calls: CommittedCall[];
  className?: string;
  /** Hide the "N of M free" sentence when the surrounding card already shows it. Default true. */
  showCount?: boolean;
  /** Test hook only; defaults to now (New York date). */
  asOf?: string;
}

const committedCount = (calls: CommittedCall[]) => calls.reduce((n, c) => n + c.quantity, 0);

export function CommittedCallsLine({ symbol, sharesOwned, gross, available, calls, className = '', showCount = true, asOf }: CommittedCallsLineProps) {
  if (gross < 1) return null;
  // The list and the count come from the same raw rows; if they ever differ, say so rather than show a list that does not add up.
  const mismatch = committedCount(calls) !== Math.max(0, gross - available);
  return (
    <div data-testid={`cc-committed-${symbol}`} className={`text-[10px] ${className}`}>
      {showCount && <span>{sharesOwned} sh · <b>{available} of {gross} {gross === 1 ? 'contract' : 'contracts'} free</b></span>}
      {calls.length > 0 && (
        <ul aria-label={`${symbol} short calls using your shares`} className="mt-0.5 space-y-0.5">
          {calls.map((call, i) => (
            <li key={i}>{describeCommittedCall(call, call.expiration ? daysUntilNy(call.expiration, asOf) : null)}{call.unclassified ? ' · type unconfirmed, counted as a call' : ''}</li>
          ))}
        </ul>
      )}
      {mismatch && calls.length > 0 && <p className="text-amber-300">The list may be incomplete; trust the free count above.</p>}
    </div>
  );
}
