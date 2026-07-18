// app/paper-trading/page.tsx
//
// PT-0001: Manual Paper Trading Sandbox -- top-level page. Client component
// that fetches from the paper-only API routes and composes the focused
// components in components/paper-trading/. No live-order code is imported
// anywhere on this page.

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import PaperAccountSummary from '@/components/paper-trading/PaperAccountSummary';
import PaperTicketForm from '@/components/paper-trading/PaperTicketForm';
import PaperPositionsList from '@/components/paper-trading/PaperPositionsList';
import PaperResetControl from '@/components/paper-trading/PaperResetControl';
import PaperIntelligenceSummary from '@/components/paper-trading/PaperIntelligenceSummary';
import type { PaperTradingLedgerView } from '@/lib/paper-trading/types';

export default function PaperTradingPage() {
  const [view, setView] = useState<PaperTradingLedgerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trading/account');
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load paper account.');
        return;
      }
      setView(body.view);
      setError(null);
      setRefreshToken((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">TradeEdge</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white md:text-4xl">Paper Portfolio</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              A fully simulated sandbox. Every open and close is a manual, intentional action you confirm yourself -- nothing here is automated,
              and nothing here can reach a real broker order.
            </p>
          </div>
          <Link href="/" className="inline-flex items-center rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
            Back to TradeEdge
          </Link>
        </div>

        {loading && <p className="text-sm text-slate-500">Loading paper account…</p>}
        {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p>}

        {view && (
          <div className="space-y-6">
            <PaperAccountSummary view={view} />

            <div className="flex justify-end">
              <PaperResetControl onReset={refresh} />
            </div>

            <PaperTicketForm onSubmitted={refresh} />

            <PaperPositionsList openPositions={view.ledger.openPositions} closedPositions={view.ledger.closedPositions} onChanged={refresh} />

            <PaperIntelligenceSummary refreshToken={refreshToken} />
          </div>
        )}
      </div>
    </main>
  );
}
