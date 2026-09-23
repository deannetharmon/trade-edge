'use client';
// features/portfolio/positions-workspace/SellStockDialog.tsx
//
// STOCKS-ORDERS-0001 -- the Sell dialog, per the mock approved 2026-09-22
// (Diane, with Ian/Quinn/Paul sign-off). Refetches capacity fresh on open,
// caps quantity at the freshly-known maxSellableShares, and re-verifies
// again via submitStockSellOrderIfSafe immediately before submit -- the
// dialog's own display never substitutes for that submit-time gate.
//
// Integration boundary (deliberate, not an oversight): onRefreshCapacity and
// onSubmitOrder are supplied by the caller, since building them requires the
// page's own broker-token/account plumbing, which this component does not
// own. See SellStockDialogDeps.

import { useEffect, useState } from 'react';
import { submitStockSellOrderIfSafe } from '@/lib/portfolio/stockOrderSubmission';
import type { SnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import type { StockHoldingRow } from './model/stockHoldings';

export interface SellStockDialogDeps {
  /** Fetches a FRESH SnapshotCapacityReport (never the one already on screen) for this account, used both for the dialog's own display and passed through to the submit-time gate. */
  onRefreshCapacity: (accountNumber: string) => Promise<SnapshotCapacityReport>;
  /** Places the real broker order. Called only from inside submitStockSellOrderIfSafe's callback -- never reachable unless the gate has already passed. */
  onSubmitOrder: (order: import('@/lib/portfolio/stockOrderBuilder').StockSellOrder, accountNumber: string) => Promise<{ orderId: string }>;
}

type Phase = 'loading' | 'form' | 'confirm' | 'placing' | 'done' | 'error';

export function SellStockDialog({ row, deps, onClose }: { row: StockHoldingRow; deps: SellStockDialogDeps; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [report, setReport] = useState<SnapshotCapacityReport | null>(null);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');

  const [quantityMode, setQuantityMode] = useState<'all' | 'part'>('all');
  const [partQuantity, setPartQuantity] = useState('');
  const [limitPrice, setLimitPrice] = useState(row.price != null ? String(row.price) : '');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const fresh = await deps.onRefreshCapacity(row.accountNumber);
        if (alive) { setReport(fresh); setPhase('form'); }
      } catch (e: any) {
        if (alive) { setError(e?.message ?? 'Could not load current share availability.'); setPhase('error'); }
      }
    })();
    return () => { alive = false; };
  }, [row.accountNumber, deps]);

  const sellable = report ? (report.bySymbol[row.symbol]
    ? Math.max(0, report.bySymbol[row.symbol].sharesOwned - 100 * (report.bySymbol[row.symbol].existingShortCallContracts + report.bySymbol[row.symbol].workingShortCallContracts))
    : 0) : 0;
  // "All" is explicitly maxSellableShares, never sharesOwned -- Paul, 2026-09-22.
  const quantity = quantityMode === 'all' ? sellable : Math.max(0, Math.min(sellable, parseInt(partQuantity, 10) || 0));
  const isFullClose = quantityMode === 'all' || quantity === sellable;
  const priceNum = parseFloat(limitPrice);
  const canSubmit = report?.status === 'ok' && sellable > 0 && quantity > 0 && Number.isFinite(priceNum) && priceNum > 0;

  const place = async () => {
    setPhase('placing'); setError('');
    try {
      const fresh = await deps.onRefreshCapacity(row.accountNumber); // re-fetch again, immediately before submit -- never trust the value shown when the dialog opened.
      const result = await submitStockSellOrderIfSafe(
        fresh, { symbol: row.symbol, quantity, limitPrice: priceNum },
        order => deps.onSubmitOrder(order, row.accountNumber),
      );
      if (!result.submitted) { setError(result.reason); setPhase('error'); return; }
      setOrderId(result.result.orderId);
      setPhase('done');
    } catch (e: any) {
      setError(e?.message ?? 'Order failed.'); setPhase('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-6" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Sell ${row.symbol}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-widest text-white">SELL {row.symbol}</h2>
          <button onClick={onClose} className="text-xl text-white/40 hover:text-white">✕</button>
        </div>

        {phase === 'loading' && <p className="text-xs text-white/60" role="status">Checking current share availability…</p>}

        {report && report.status === 'unavailable' && (
          <p role="alert" className="mb-4 rounded-lg border border-amber-600 bg-amber-500/10 p-3 text-xs text-amber-300">
            Share commitment could not be verified. Selling is blocked until it can be.
          </p>
        )}

        {phase !== 'loading' && report?.status === 'ok' && (
          <>
            <div className="mb-4 space-y-3">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/50">Quantity</p>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setQuantityMode('all')}
                    className={`flex-1 rounded border px-2 py-2 ${quantityMode === 'all' ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-white/20 text-white/60'}`}>
                    All available ({sellable} shares)
                  </button>
                  <button type="button" onClick={() => setQuantityMode('part')}
                    className={`flex-1 rounded border px-2 py-2 ${quantityMode === 'part' ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-white/20 text-white/60'}`}>
                    Part
                  </button>
                </div>
                {quantityMode === 'part' && (
                  <input type="number" min={1} max={sellable} value={partQuantity} onChange={e => setPartQuantity(e.target.value)}
                    aria-label="Shares to sell" placeholder={`Up to ${sellable}`}
                    className="mt-2 w-full rounded border border-white/20 bg-transparent px-2 py-1 text-xs text-white" />
                )}
              </div>

              {row.sellable.sharesCommitted > 0 && (
                <p className="text-[11px] text-white/70">
                  {row.sellable.sharesCommitted} of {row.shares} shares are committed to an open call; {sellable} are available to sell.
                </p>
              )}

              <label className="block text-xs">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/50">Limit price</span>
                <input type="number" step="0.01" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  className="w-full rounded border border-white/20 bg-transparent px-2 py-1 text-white" />
              </label>

              <p className="text-[11px] text-white/50">Time in force: <span className="text-white">GTC</span></p>
              <p className="text-[10px] text-white/40">Selling shares is a taxable event; your broker selects which lots close.</p>
            </div>

            {error && phase === 'error' && <p role="alert" className="mb-3 text-xs text-red-400">{error}</p>}

            {phase === 'confirm' && (
              <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
                {isFullClose && <p className="mb-2 font-bold text-amber-300">This closes your entire available {row.symbol} position.</p>}
                <p className="text-white/70">Sell {quantity} {row.symbol} @ ${Number.isFinite(priceNum) ? priceNum.toFixed(2) : '—'} · GTC</p>
              </div>
            )}

            {phase === 'done' ? (
              <>
                <p role="status" className="mb-3 text-xs text-emerald-400">Order submitted. Broker order id: {orderId}</p>
                <button onClick={onClose} className="w-full rounded-xl border border-white/20 py-2.5 text-xs font-bold tracking-widest text-white">CLOSE</button>
              </>
            ) : (
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 rounded-xl border border-white/20 py-2.5 text-xs font-bold tracking-widest text-white">CANCEL</button>
                <button
                  disabled={!canSubmit || phase === 'placing'}
                  onClick={() => (phase === 'confirm' ? place() : setPhase('confirm'))}
                  className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold tracking-widest text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                >
                  {phase === 'placing' ? 'PLACING…' : phase === 'confirm' ? 'CONFIRM SELL' : 'REVIEW ORDER'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
