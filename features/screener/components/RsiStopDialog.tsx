'use client';

// CC-RSI-GUARD-0001 -- "Stop. Look at SYM first." Shown before the order screen opens for a covered call or a PMCC
// short call when daily RSI is below the saved cutoff or unreadable. "Go back" is the default; "Sell anyway" runs the
// normal path unchanged. Rendered in a portal so it never sits inside a card's clickable root.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { decideCcRsiGuard, type CcRsiGuardDecision } from '@/lib/scans/ccRsiGuard';

export function RsiStopDialog({ decision, onGoBack, onSellAnyway }: {
  decision: Extract<CcRsiGuardDecision, { stop: true }>; onGoBack: () => void; onSellAnyway: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  const node = (
    <div
      data-testid="rsi-stop-overlay"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { e.stopPropagation(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onGoBack(); } }}
    >
      <div role="dialog" aria-modal="true" aria-label="Stop and look first" data-testid="rsi-stop"
        className="w-full max-w-md rounded-2xl border-2 border-amber-600 bg-slate-900 p-5 flex flex-col gap-3 text-slate-100">
        <div className="text-xl font-bold text-amber-200">{decision.title}</div>
        {decision.kind === 'below' && decision.rsi !== null && (
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg border border-slate-700 px-3 py-2">
              <div className="text-xs text-slate-400">Daily RSI now</div>
              <div data-testid="rsi-stop-rsi" className="text-2xl font-bold tabular-nums text-amber-200">{Math.round(decision.rsi)}</div>
            </div>
            <div className="flex-1 rounded-lg border border-slate-700 px-3 py-2">
              <div className="text-xs text-slate-400">Your cutoff</div>
              <div data-testid="rsi-stop-cutoff" className="text-2xl font-bold tabular-nums">{decision.cutoff}</div>
            </div>
          </div>
        )}
        <p data-testid="rsi-stop-body" className="text-[15px] leading-relaxed">{decision.body}</p>
        <div className="flex flex-wrap gap-2">
          <button ref={backRef} type="button" data-testid="rsi-stop-back" onClick={(e) => { e.stopPropagation(); onGoBack(); }}
            className="min-h-12 px-5 rounded-xl border-2 border-blue-400 bg-slate-800 text-[15px] font-bold">Go back</button>
          <button type="button" data-testid="rsi-stop-anyway" onClick={(e) => { e.stopPropagation(); onSellAnyway(); }}
            className="min-h-12 px-5 rounded-xl border border-slate-700 bg-slate-950 text-[15px] text-slate-400">Sell anyway</button>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}

/** request(run) runs `run` now when RSI passes, otherwise shows the stop and runs it only on "Sell anyway". */
export function useRsiGuard(input: { symbol: string; rsi: number | null | undefined; cutoff: number }): { request: (run: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<{ run: () => void; decision: Extract<CcRsiGuardDecision, { stop: true }> } | null>(null);
  const { symbol, rsi, cutoff } = input;
  const request = useCallback((run: () => void) => {
    const decision = decideCcRsiGuard({ symbol, rsi, cutoff });
    if (!decision.stop) { run(); return; }
    setPending({ run, decision });
  }, [symbol, rsi, cutoff]);
  const dialog = pending ? (
    <RsiStopDialog decision={pending.decision} onGoBack={() => setPending(null)} onSellAnyway={() => { const r = pending.run; setPending(null); r(); }} />
  ) : null;
  return { request, dialog };
}
