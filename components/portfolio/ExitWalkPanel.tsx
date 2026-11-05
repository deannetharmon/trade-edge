// components/portfolio/ExitWalkPanel.tsx
//
// EXIT-WALK-0001B step 3b: the "Walk the price" button and panel for closing one position (Diane v4, "Walk the price").
// Start near the mid, step toward the market, stop at the live bid/ask. Never auto-starts; every reprice is shown;
// Stop walk is always there. It never touches the batch close modal. EXIT-WALK-CANCEL-0001: a working GTC close order is
// shown and cancelled only when the trader presses "Cancel order and start walk" (a live bracket is refused, see
// lib/exit-walk/workingClose.ts); a pending entry order still refuses. With Dry Run ON every price is validated at
// /orders/dry-run and nothing is placed (Ian's C2), so a working close still refuses there.

'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePortfolioMode } from '@/components/portfolio-mode/PortfolioModeProvider';
import { assertLiveContextReady } from '@/lib/portfolio-mode/guardrails';
import { getExecutableOptionQuotes } from '@/lib/scans/tastytrade-client';
import { BASE, getAccessToken, ttFetch } from '@/lib/tastytrade/client';
import { criticalGtcRestorationWarning } from '@/lib/portfolio/existingGtcReplacement';
import { cancelWorkingCloseForWalk } from '@/lib/exit-walk/workingClose';
import { tickTableFromNestedChain, type TickTable } from '@/lib/portfolio/tickSize';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import {
  buildExitCloseOrder,
  buildRestoreCloseOrder,
  checkExitWalkEligibility,
  exitWalkGateRefusal,
  type ExitWalkEligibility,
} from '@/lib/exit-walk/closeOrder';
import {
  createBrowserExitWalkDeps,
  createDryRunExitWalkDeps,
  exitQuoteFromLegs,
  type BrowserExitWalkConfig,
} from '@/lib/exit-walk/browserDeps';
import { outcomeLine, planChips, refusalText, rowsWithLog, walkTitle, type PanelChip } from '@/lib/exit-walk/panelModel';
import { checkWalkStart, runExitWalk, type ExitWalkLogEntry, type ExitWalkOutcome } from '@/lib/exit-walk/run';
import type { ExitSide, ExitWalkResult, Quote } from '@/lib/exit-walk/types';

type Plan = Extract<ExitWalkResult, { ok: true }>;

// ---------------------------------------------------------------------------------------------------------------------
// Context: what the page knows that the panel needs, without threading props through the position list.
// ---------------------------------------------------------------------------------------------------------------------

interface ExitWalkContextValue {
  pendingOrders: PendingOrder[];
  dryRun: boolean;
  /** Refresh positions after the walk ends. */
  onDone: () => void;
}
const ExitWalkContext = createContext<ExitWalkContextValue | null>(null);

export function ExitWalkProvider({ pendingOrders, dryRun, onDone, children }: ExitWalkContextValue & { children: ReactNode }) {
  return <ExitWalkContext.Provider value={{ pendingOrders, dryRun, onDone }}>{children}</ExitWalkContext.Provider>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Launcher: the small button on a position's action row.
// ---------------------------------------------------------------------------------------------------------------------

/** `className` sets the size and shape only, so the Table, Cards and legacy rows share one look and one colour. */
export function ExitWalkLauncher({ pos, className }: { pos: Position; className?: string }) {
  const ctx = useContext(ExitWalkContext);
  const [open, setOpen] = useState(false);
  if (!ctx || pos.structureAmbiguous || !pos.identity || pos.entryPriceEffect === 'Unknown') return null;
  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className={`${className ?? 'text-[9px] px-2.5 py-1 rounded'} border font-bold whitespace-nowrap transition-colors border-teal-700 text-teal-300 hover:bg-teal-500/10`}>
        Walk the price
      </button>
      {open ? <ExitWalkDialog pos={pos} ctx={ctx} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------------------------------

type Prepared =
  | { kind: 'loading' }
  | { kind: 'refused'; text: string }
  | { kind: 'ready'; side: ExitSide; plan: Plan; quote: Quote; tickTable: TickTable | null; eligibility: Extract<ExitWalkEligibility, { ok: true }> };

const toneClass: Record<PanelChip['tone'], string> = {
  neutral: 'border-neutral-700 text-slate-400',
  teal: 'border-teal-700 text-teal-300',
  amber: 'border-amber-700 text-amber-300',
};

function ExitWalkDialog({ pos, ctx, onClose }: { pos: Position; ctx: ExitWalkContextValue; onClose: () => void }) {
  const portfolioMode = usePortfolioMode();
  const [prepared, setPrepared] = useState<Prepared>({ kind: 'loading' });
  const [log, setLog] = useState<ExitWalkLogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<ExitWalkOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // EXIT-WALK-CANCEL-0001: the price of the working GTC the walk cancelled (null when it cancelled nothing), and whether it was put back.
  const [cancelledOriginal, setCancelledOriginal] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const cancelRef = useRef(false);
  const abandonRef = useRef(false);
  const runningRef = useRef(false);

  // Leaving the page or closing the dialog abandons the walk: nothing more is sent and a live order stays put.
  useEffect(() => {
    abandonRef.current = false;
    const onUnload = () => { abandonRef.current = true; };
    window.addEventListener('beforeunload', onUnload);
    return () => { abandonRef.current = true; window.removeEventListener('beforeunload', onUnload); };
  }, []);

  const walkLegs = pos.legs.map(l => ({ symbol: l.symbol, action: l.direction === 'Short' ? 'Buy to Close' : 'Sell to Close' }));

  /** Eligibility, a fresh quote, the tick table, the plan, and the safety gate on the first price. */
  const prepare = useCallback(async (): Promise<Prepared> => {
    const nowMs = Date.now();
    // EXIT-WALK-CANCEL-0001: a working GTC close no longer refuses; the walk offers to cancel it. Dry run places nothing and
    // the broker's validator rejects a new close while the old one works, so dry run keeps the refusal.
    const eligibility = checkExitWalkEligibility(pos, ctx.pendingOrders, nowMs, { allowWorkingClose: !ctx.dryRun });
    if (!eligibility.ok) return { kind: 'refused', text: refusalText(eligibility.reason) };
    try {
      const token = await getAccessToken();
      const quotes = await getExecutableOptionQuotes(walkLegs.map(l => l.symbol), token);
      const quote = exitQuoteFromLegs(eligibility.side, walkLegs, quotes, Date.now());
      if (!quote) return { kind: 'refused', text: refusalText('quote_missing') };
      let tickTable: TickTable | null = null;
      try { tickTable = tickTableFromNestedChain(await ttFetch(`/option-chains/${encodeURIComponent(pos.symbol)}/nested`, token), walkLegs[0].symbol); } catch { tickTable = null; }
      const start = checkWalkStart({
        side: eligibility.side, quote, nowMs: Date.now(), tickTable,
        hardRisk: pos.stopLossBreachState === 'CONFIRMED_BREACH',
        // The gap rule is part of the decision engine (DECIDE-0001 S2) and is not built yet; see the ticket.
        gapBlocked: false,
      });
      if (!start.ok) return { kind: 'refused', text: refusalText(start.reason) };
      const refusal = exitWalkGateRefusal({ pos, identity: eligibility.identity, side: eligibility.side, price_c: start.plan.prices_c[0], quote, nowMs: Date.now() });
      if (refusal) return { kind: 'refused', text: `No walk: ${refusal}` };
      return { kind: 'ready', side: eligibility.side, plan: start.plan, quote, tickTable, eligibility };
    } catch (error) {
      return { kind: 'refused', text: `No walk: ${error instanceof Error ? error.message : 'could not read the market.'}` };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, ctx.pendingOrders]);

  const refresh = useCallback(async () => {
    setNotice(null);
    setPrepared({ kind: 'loading' });
    setPrepared(await prepare());
  }, [prepare]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Puts the cancelled GTC close back at its original price. Returns the line to show the trader; a failure is flagged critical. */
  const putOriginalBack = async (price: number, side: ExitSide): Promise<string> => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${BASE}/accounts/${pos.accountNumber}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildRestoreCloseOrder(pos, price, side)),
      });
      if (res.status === 401) throw new Error('Session expired');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Request failed (${res.status})`);
      setRestored(true);
      ctx.onDone();
      return `The original close order was put back at $${price.toFixed(2)} (GTC).`;
    } catch (error) {
      return criticalGtcRestorationWarning(error).trim();
    }
  };

  const start = async () => {
    if (prepared.kind !== 'ready' || runningRef.current) return;
    setNotice(null);
    // Same guard as the batch close modal: it applies in dry run too, because dry run still calls the broker's validate endpoint.
    try { assertLiveContextReady(portfolioMode.status, portfolioMode.mode, 'walk an exit order'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Portfolio mode does not allow live orders right now.'); return; }
    runningRef.current = true;
    setRunning(true);
    setOutcome(null);
    setLog([]);
    try {
      // Re-read everything at the click. If the prices moved, show the new ones and wait for another click.
      const fresh = await prepare();
      if (fresh.kind !== 'ready') { setPrepared(fresh); return; }
      if (fresh.plan.prices_c.join() !== prepared.plan.prices_c.join()) {
        setPrepared(fresh);
        setNotice('Prices updated. Check them, then start again.');
        return;
      }
      const { side, plan, quote, tickTable, eligibility } = fresh;
      cancelRef.current = false;
      const config: BrowserExitWalkConfig = {
        accountNumber: pos.accountNumber,
        side,
        legs: walkLegs,
        getToken: getAccessToken,
        fetchQuotes: getExecutableOptionQuotes,
        buildPayload: price_c => buildExitCloseOrder(pos, price_c, side),
        cancelRequested: () => cancelRef.current,
        abandoned: () => abandonRef.current,
        onLog: setLog,
      };
      const deps = ctx.dryRun ? createDryRunExitWalkDeps(config) : createBrowserExitWalkDeps(config);
      const first = plan.prices_c[0];
      // EXIT-WALK-CANCEL-0001: the trader pressed "Cancel order and start walk". Cancel the working GTC close first; a refusal
      // (live bracket, any doubt) cancels nothing and stops here.
      let cancelledPrice: number | null = null;
      setCancelledOriginal(null);
      setRestored(false);
      if (eligibility.workingClose && !ctx.dryRun) {
        try {
          const token = await getAccessToken();
          const cancelled = await cancelWorkingCloseForWalk(
            {
              orderId: pos.gtcOrderId,
              complexOrderId: (pos as any).gtcComplexOrderId ?? null,
              originalPrice: pos.gtcOrderPrice,
              stopAssessment: pos.stopAssessment,
              legSymbols: pos.legs.map(l => l.symbol),
            },
            {
              readComplexOrder: id => ttFetch(`/accounts/${pos.accountNumber}/complex-orders/${id}`, token).then((r: any) => r?.data ?? null),
              cancel: async (orderId, complexOrderId) => {
                const res = await fetch(
                  complexOrderId ? `${BASE}/accounts/${pos.accountNumber}/complex-orders/${complexOrderId}` : `${BASE}/accounts/${pos.accountNumber}/orders/${orderId}`,
                  { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
                );
                if (res.status === 401) throw new Error('Session expired');
                if (!res.ok) throw new Error(`Cancel failed: ${(await res.text()).slice(0, 200)}`);
                return res.json().catch(() => ({}));
              },
            },
          );
          cancelledPrice = cancelled.originalPrice;
          setCancelledOriginal(cancelled.originalPrice);
          await new Promise(r => setTimeout(r, 800));
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'The working order could not be cancelled. Nothing was changed.');
          return;
        }
      }
      let firstOrderId: string;
      try {
        firstOrderId = await deps.submit(first);
      } catch (error) {
        const why = error instanceof Error ? error.message : '';
        if (cancelledPrice != null) {
          setNotice(`The first order was refused. ${why} ${await putOriginalBack(cancelledPrice, side)}`.replace(/\s+/g, ' ').trim());
        } else {
          setNotice(`The first order was refused. Nothing is working. ${why}`.trim());
        }
        return;
      }
      setLog([{ price_c: first, state: 'waiting' }]);
      const result = await runExitWalk({
        side, tickTable, firstOrderId, firstPrice_c: first, anchor: quote,
        deps: {
          ...deps,
          checkPrice: (price_c, liveQuote) =>
            exitWalkGateRefusal({ pos, identity: eligibility.identity, side, price_c, quote: liveQuote, nowMs: Date.now() }),
        },
      });
      setOutcome(result);
      if (!ctx.dryRun) ctx.onDone();
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const stop = () => { cancelRef.current = true; };
  const close = () => { if (!runningRef.current) onClose(); };

  const ready = prepared.kind === 'ready' ? prepared : null;
  const willCancelWorking = Boolean(ready?.eligibility.workingClose) && !ctx.dryRun;
  // The walk cancelled the original and ended with nothing working: offer to put it back (never automatic after a Stop).
  const canPutBack = cancelledOriginal != null && !restored && !running && outcome != null
    && (outcome.kind === 'cancelled' || (outcome.kind === 'stopped' && !outcome.orderLive));
  const sideForText: ExitSide = ready?.side ?? (pos.entryPriceEffect === 'Credit' ? 'buy' : 'sell');
  const rows = ready ? rowsWithLog(ready.plan, log.map(l => l.price_c), running) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Walk the price" onClick={e => e.stopPropagation()}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 text-slate-200">
        <header className="px-4 py-3 border-b border-neutral-800 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <b className="text-sm text-white">{walkTitle(pos, sideForText)}</b>
            <button type="button" onClick={close} disabled={running} aria-label="Close" className="text-slate-500 hover:text-white disabled:opacity-40 min-h-[32px] px-2">✕</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ctx.dryRun ? <span className="rounded-full border border-amber-700 px-2 text-[10px] text-amber-300">Dry run: nothing is placed</span> : null}
            {ready ? planChips(ready.plan, ready.quote).map(c => (
              <span key={c.text} className={`rounded-full border px-2 text-[10px] ${toneClass[c.tone]}`}>{c.text}</span>
            )) : null}
          </div>
        </header>

        <div className="px-4 py-3 space-y-3">
          {prepared.kind === 'loading' ? <p className="text-xs text-slate-400">Reading the market…</p> : null}
          {prepared.kind === 'refused' ? (
            <div className="rounded-lg border border-amber-700 bg-amber-500/5 px-3 py-2 text-xs text-slate-200">{prepared.text}</div>
          ) : null}
          {willCancelWorking && !running && cancelledOriginal == null ? (
            <div data-testid="walk-working-close" className="rounded-lg border border-amber-700 bg-amber-500/5 px-3 py-2 text-xs text-slate-200">
              This position has a working close order{pos.gtcOrderPrice != null ? ` (GTC at $${pos.gtcOrderPrice.toFixed(2)})` : ''}. Starting the walk cancels it first.
              If the walk ends with nothing working, you can put it back.
            </div>
          ) : null}
          {ready ? (
            <table className="w-full text-[11px] tabular-nums border-collapse">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-slate-500 text-left">
                  <th scope="col" className="py-1 px-1.5 border-b border-neutral-800">Step</th>
                  <th scope="col" className="py-1 px-1.5 border-b border-neutral-800 text-right">Price</th>
                  <th scope="col" className="py-1 px-1.5 border-b border-neutral-800 text-right">vs mid</th>
                  <th scope="col" className="py-1 px-1.5 border-b border-neutral-800 text-right">At</th>
                  <th scope="col" className="py-1 px-1.5 border-b border-neutral-800" />
                </tr>
              </thead>
              <tbody role="status" aria-live="polite">
                {rows.map(row => (
                  <tr key={row.step} className={row.status === 'Now' ? 'bg-teal-500/10 text-white font-bold' : row.status === 'Done' ? 'text-slate-500' : row.status === 'Floor' || row.status === 'Ceiling' ? 'text-amber-300' : 'text-slate-300'}>
                    <td className="py-1.5 px-1.5 border-b border-neutral-900">{row.step}</td>
                    <td className="py-1.5 px-1.5 border-b border-neutral-900 text-right">{row.price}</td>
                    <td className="py-1.5 px-1.5 border-b border-neutral-900 text-right">{row.vsMid}</td>
                    <td className="py-1.5 px-1.5 border-b border-neutral-900 text-right">{row.at}</td>
                    <td className="py-1.5 px-1.5 border-b border-neutral-900">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {notice ? <p className="text-xs text-amber-300">{notice}</p> : null}
          {outcome ? <p role="status" className="text-xs text-slate-200">{outcomeLine(outcome, sideForText)}</p> : null}
          {running ? <p className="text-xs text-amber-300">Stay on this page. Leaving it stops the walk and leaves the order at its last price.</p> : null}
        </div>

        <footer className="px-4 py-3 border-t border-neutral-800 flex flex-wrap gap-2 items-center">
          <button type="button" onClick={stop} disabled={!running}
            className="min-h-[44px] px-4 rounded-lg border border-red-500 text-red-300 text-sm font-bold disabled:opacity-40">
            Stop walk
          </button>
          <button type="button" onClick={() => void start()} disabled={!ready || running}
            className="min-h-[44px] px-4 rounded-lg border border-teal-600 text-teal-300 text-sm font-bold disabled:opacity-40 disabled:border-dashed">
            {willCancelWorking ? 'Cancel order and start walk' : 'Start walk'}
          </button>
          {canPutBack ? (
            <button type="button" onClick={() => void putOriginalBack(cancelledOriginal as number, sideForText).then(setNotice)}
              className="min-h-[44px] px-4 rounded-lg border border-amber-600 text-amber-300 text-sm font-bold">
              Put the original order back at ${(cancelledOriginal as number).toFixed(2)}
            </button>
          ) : null}
          <button type="button" onClick={() => void refresh()} disabled={running}
            className="min-h-[44px] px-4 rounded-lg border border-neutral-700 text-slate-300 text-sm disabled:opacity-40">
            Refresh
          </button>
        </footer>
      </div>
    </div>
  );
}
