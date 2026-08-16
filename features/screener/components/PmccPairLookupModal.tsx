'use client';

// features/screener/components/PmccPairLookupModal.tsx
//
// PMCC on-demand pair lookup ticket. Answers "was this specific structure
// evaluated, and what happened to it" -- independent of the 10-item
// retention limit that governs the full scan's visible results. Directly
// motivated by a real comparison against a manually-built TastyTrade
// trade that was genuinely valid but never appeared in the retained set.
//
// Fresh chain fetch on every check, by design (not reusing a scan
// session's cached chain) -- always reflects live data, at the cost of
// one extra API call per check. Simpler and safer than session-state
// coupling for a tool used occasionally, not per-scan.

import { useState } from 'react';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';
import type { PmccOnDemandOutcome, PmccOnDemandResult } from '@/lib/scans/pmccTypes';

interface Props {
  th: ScanModalTheme;
  symbol: string;
  onClose: () => void;
  onCheck: (input: {
    longStrike: number;
    longExpiration: string;
    shortStrike: number;
    shortExpiration: string;
  }) => Promise<PmccOnDemandResult>;
}

const OUTCOME_COPY: Record<PmccOnDemandOutcome, { label: string; color: string; explain: string }> = {
  not_found_in_chain: {
    label: 'Not found in chain',
    color: 'border-neutral-500 text-neutral-300 bg-neutral-500/10',
    explain: 'The requested strike/expiration doesn\u2019t exist in the fetched option chain for this underlying. Double-check the strike and expiration date.',
  },
  leg_rejected: {
    label: 'Leg rejected',
    color: 'border-red-500 text-red-300 bg-red-500/10',
    explain: 'One of the two legs exists but fails its own eligibility check (delta, DTE, open interest, or quote quality) before the pair is ever evaluated together.',
  },
  pair_rejected: {
    label: 'Pair rejected',
    color: 'border-red-500 text-red-300 bg-red-500/10',
    explain: 'Both legs are individually eligible, but the pair itself fails a structural check (net debit, strike order, or expiration order).',
  },
  qualified: {
    label: 'Qualified',
    color: 'border-emerald-500 text-emerald-300 bg-emerald-500/10',
    explain: 'This is a genuinely valid, qualified PMCC structure. If it isn\u2019t in your results list, it was truncated by the 10-result retention limit, not disqualified.',
  },
  near_miss: {
    label: 'Near miss',
    color: 'border-amber-500 text-amber-300 bg-amber-500/10',
    explain: 'Structurally valid, but not fully qualified (typically the net debit isn\u2019t below the strike width). Same truncation caveat as Qualified applies if not in your results list.',
  },
};

export function PmccPairLookupModal({ th, symbol, onClose, onCheck }: Props) {
  const [longStrike, setLongStrike] = useState('');
  const [longExpiration, setLongExpiration] = useState('');
  const [shortStrike, setShortStrike] = useState('');
  const [shortExpiration, setShortExpiration] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PmccOnDemandResult | null>(null);

  const valid = longStrike !== '' && longExpiration !== '' && shortStrike !== '' && shortExpiration !== ''
    && /^\d{4}-\d{2}-\d{2}$/.test(longExpiration) && /^\d{4}-\d{2}-\d{2}$/.test(shortExpiration);

  const runCheck = async () => {
    if (!valid) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const outcome = await onCheck({
        longStrike: Number(longStrike),
        longExpiration,
        shortStrike: Number(shortStrike),
        shortExpiration,
      });
      setResult(outcome);
    } catch (e: any) {
      setError(e?.message ?? 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  };

  const copy = result ? OUTCOME_COPY[result.outcome] : null;

  return (
    <ScanModalShell
      th={th}
      titleId="pmcc-pair-lookup-title"
      title="CHECK A SPECIFIC PMCC PAIR"
      subtitle={`${symbol} · does this exact structure exist in the current chain, and what happened to it`}
      closeLabel="Close PMCC pair lookup"
      onClose={onClose}
    >
      <div className="flex flex-col gap-0">
        <div className="grid grid-cols-2 gap-3">
          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Long call (LEAPS)</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Long call strike" type="number" placeholder="Strike"
                value={longStrike} onChange={e => setLongStrike(e.target.value)}
                className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <input aria-label="Long call expiration" type="text" placeholder="YYYY-MM-DD"
                value={longExpiration} onChange={e => setLongExpiration(e.target.value)}
                className="w-28 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Short call</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Short call strike" type="number" placeholder="Strike"
                value={shortStrike} onChange={e => setShortStrike(e.target.value)}
                className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <input aria-label="Short call expiration" type="text" placeholder="YYYY-MM-DD"
                value={shortExpiration} onChange={e => setShortExpiration(e.target.value)}
                className="w-28 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">
            Cancel
          </button>
          <button
            disabled={!valid || loading}
            onClick={runCheck}
            className="rounded-lg border border-cyan-400 bg-cyan-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'CHECKING\u2026' : 'CHECK THIS PAIR \u2192'}
          </button>
        </div>

        {result && copy && (
          <div className={`mt-4 rounded-lg border p-3 text-xs ${copy.color}`} data-testid="pmcc-pair-lookup-result">
            <p className="font-bold tracking-wider mb-1">{copy.label}</p>
            <p className="opacity-90 mb-2">{copy.explain}</p>

            {result.chainMissing.long && <p>Long leg strike/expiration not found in the fetched chain.</p>}
            {result.chainMissing.short && <p>Short leg strike/expiration not found in the fetched chain.</p>}

            {result.longLegRejection && (
              <p>Long leg rejected: {result.longLegRejection.reasons.map(r => r.message).join('; ')}</p>
            )}
            {result.shortLegRejection && (
              <p>Short leg rejected: {result.shortLegRejection.reasons.map(r => r.message).join('; ')}</p>
            )}
            {result.pair && result.pair.failureReasons.length > 0 && (
              <p>Pair-level: {result.pair.failureReasons.map(r => r.message).join('; ')}</p>
            )}
            {result.pair?.metrics && (
              <p className="mt-2 opacity-80">
                Net debit ${result.pair.metrics.netDebitPerShare.toFixed(2)}/share ·
                {' '}Strike width ${result.pair.metrics.strikeWidth.toFixed(2)} ·
                {' '}Net delta {result.pair.metrics.netDelta.toFixed(2)}
              </p>
            )}
          </div>
        )}
      </div>
    </ScanModalShell>
  );
}
