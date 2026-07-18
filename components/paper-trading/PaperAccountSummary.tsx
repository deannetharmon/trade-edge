// components/paper-trading/PaperAccountSummary.tsx
//
// PT-0001 section 11: read-only summary stat grid for the Paper Portfolio.
// Pure presentation -- all values are passed in, nothing is fetched or
// computed here.

'use client';

import type { PaperTradingLedgerView } from '@/lib/paper-trading/types';

function formatUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function PaperAccountSummary({ view }: { view: PaperTradingLedgerView }) {
  const { ledger, availableCapital, currentEquity, realizedPnl, unrealizedPnl, openRisk } = view;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-amber-500 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-black">PAPER</span>
        <p className="text-sm text-slate-400">Simulated account -- no real money, no broker connection.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Starting Balance" value={formatUsd(ledger.startingBalance)} />
        <Stat label="Cash" value={formatUsd(ledger.cash)} />
        <Stat label="Reserved Capital" value={formatUsd(ledger.reservedCapital)} />
        <Stat label="Available Capital" value={formatUsd(availableCapital)} tone={availableCapital < 0 ? 'negative' : 'neutral'} />
        <Stat label="Current Equity" value={formatUsd(currentEquity)} />
        <Stat label="Realized P/L" value={formatUsd(realizedPnl)} tone={realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : 'neutral'} />
        <Stat label="Unrealized P/L" value={formatUsd(unrealizedPnl)} tone={unrealizedPnl > 0 ? 'positive' : unrealizedPnl < 0 ? 'negative' : 'neutral'} />
        <Stat label="Open Risk" value={formatUsd(openRisk)} />
      </div>
    </section>
  );
}
