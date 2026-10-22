// components/portfolio/ExitWalkPanel.tsx
//
// EXIT-WALK-0001B step 3b: the "Walk the price" button and panel for closing one position (Diane v4, "Walk the price").
// Start near the mid, step toward the market, stop at the live bid/ask. Never auto-starts; every reprice is shown;
// Stop walk is always there. It never touches the batch close modal and never cancels another order: a position with a
// working order is refused (see lib/exit-walk/closeOrder.ts). With Dry Run ON every price is validated at /orders/dry-run
// and nothing is placed (Ian's C2).

'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePortfolioMode } from '@/components/portfolio-mode/PortfolioModeProvider';
import { assertLiveContextReady } from '@/lib/portfolio-mode/guardrails';
import { getExecutableOptionQuotes } from '@/lib/scans/tastytrade-client';
import { getAccessToken, ttFetch } from '@/lib/tastytrade/client';
import { tickTableFromNestedChain, type TickTable } from '@/lib/portfolio/tickSize';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import {
  buildExitCloseOrder,
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

const LAUNCHER_CLASS = 'text-[9px] px-2.5 py-1 border rounded font-bold whitespace-nowrap transition-colors border-teal-700 text-teal-300 hover:bg-teal-500/10';

export function ExitWalkLauncher({ pos, className = LAUNCHER_CLASS, label = 'Walk the price' }: { pos: Position; className?: string; label?: string }) {
  const ctx = useContext(ExitWalkContext);
  const [open, setOpen] = useState(false);
  if (!ctx || pos.structureAmbiguous || !pos.identity || pos.entryPriceEffect === 'Unknown') return null;
  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className={className}>
        {label}
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
    const eligibility = checkExitWalkEligibility(pos, ctx.pendingOrders, nowMs);
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
      let firstOrderId: string;
      try {
        firstOrderId = await deps.submit(first);
      } catch (error) {
        setNotice(`The first order was refused. Nothing is working. ${error instanceof Error ? error.message : ''}`.trim());
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
            Start walk
          </button>
          <button type="button" onClick={() => void refresh()} disabled={running}
            className="min-h-[44px] px-4 rounded-lg border border-neutral-700 text-slate-300 text-sm disabled:opacity-40">
            Refresh
          </button>
        </footer>
      </div>
    </div>
  );
}
