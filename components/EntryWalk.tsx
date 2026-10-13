// components/EntryWalk.tsx
//
// ENTRY-WALK-0001: the "Walk the price" checkbox, the live list of prices tried, and the hook that runs the walk.
// Layout and wording follow Diane's mock: a plain in-order list ("Tried $1.37 / no fill"), one Cancel button
// while it is working, and one short line when it ends.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserWalkDeps, type BrowserWalkConfig } from '@/lib/entry-walk/browserDeps';
import { WALK_STEP_MS } from '@/lib/entry-walk/ladder';
import { runWalk, type WalkLogEntry, type WalkOutcome } from '@/lib/entry-walk/walk';

export interface StartWalkArgs {
  ladder: number[];
  firstOrderId: string;
  config: Omit<BrowserWalkConfig, 'cancelRequested' | 'abandoned' | 'onLog'>;
}

export function useEntryWalk() {
  const [log, setLog] = useState<WalkLogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<WalkOutcome | null>(null);
  const cancelRef = useRef(false);
  const abandonRef = useRef(false);

  // Leaving the page (or closing the dialog) abandons the walk: nothing more is sent, and the live order stays put.
  useEffect(() => {
    abandonRef.current = false;
    const onUnload = () => { abandonRef.current = true; };
    window.addEventListener('beforeunload', onUnload);
    return () => { abandonRef.current = true; window.removeEventListener('beforeunload', onUnload); };
  }, []);

  const start = useCallback(async ({ ladder, firstOrderId, config }: StartWalkArgs): Promise<WalkOutcome> => {
    cancelRef.current = false;
    setOutcome(null);
    setLog([]);
    setRunning(true);
    try {
      const deps = createBrowserWalkDeps({
        ...config,
        cancelRequested: () => cancelRef.current,
        abandoned: () => abandonRef.current,
        onLog: setLog,
      });
      const result = await runWalk({ ladder, firstOrderId, deps, stepMs: WALK_STEP_MS });
      setOutcome(result);
      return result;
    } finally {
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);
  return { log, running, outcome, start, cancel };
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function WalkCheckbox({ checked, onChange, disabled, plan }: {
  checked: boolean; onChange: (next: boolean) => void; disabled?: boolean;
  /** One quiet line once the market has been validated, for example "Tries $1.37 first, down to $1.30." */
  plan?: string | null;
}) {
  return (
    <div className="mb-4">
      <label className={`flex gap-3 items-center min-h-[44px] px-3 py-2 rounded-lg border border-indigo-600 bg-indigo-500/10 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-indigo-500" />
        <span className="flex flex-col">
          <span className="text-sm font-bold">Walk the price</span>
          <span className="text-xs text-slate-400">Start near the ask, work down to the mid. Never lower.</span>
        </span>
      </label>
      {checked && plan ? <p className="text-xs text-slate-400 mt-1 px-1">{plan}</p> : null}
    </div>
  );
}

const STATE_TEXT: Record<WalkLogEntry['state'], string> = {
  waiting: 'waiting', no_fill: 'no fill', filled: 'Filled', partial: 'Partly filled', cancelled: 'Cancelled', stopped: 'Stopped',
};

function outcomeLine(outcome: WalkOutcome): string {
  switch (outcome.kind) {
    case 'filled': return `Filled at ${money(outcome.price)}.`;
    case 'partial': return `${outcome.filledQty} of ${outcome.totalQty} contracts filled at ${money(outcome.price)}. Stopped; the rest is left as it is. Check Pending orders.`;
    case 'cancelled': return 'Cancelled. Nothing is left working.';
    case 'ended_working': return `No fill yet. The order stays working at ${money(outcome.price)}.`;
    case 'stopped': return outcome.orderLive && outcome.price != null ? `${outcome.message} The order stays working at ${money(outcome.price)}.` : outcome.message;
  }
}

export function WalkProgress({ log, running, outcome, onCancel }: {
  log: WalkLogEntry[]; running: boolean; outcome: WalkOutcome | null; onCancel: () => void;
}) {
  if (log.length === 0 && !outcome) return null;
  return (
    <div className="border border-neutral-700 rounded-xl p-4 mb-4 space-y-2">
      <div role="status" aria-live="polite" className="space-y-2 text-sm">
        {log.map((entry, i) => {
          const done = entry.state === 'filled';
          return (
            <div key={`${i}-${entry.price}`} className={`flex justify-between items-center ${done ? 'px-3 py-2 rounded-lg border border-emerald-500 bg-emerald-500/10' : ''}`}>
              <span>{entry.state === 'waiting' ? 'Trying' : 'Tried'} <b className="font-mono">{money(entry.price)}</b></span>
              <span className={done ? 'font-bold text-emerald-300' : entry.state === 'stopped' ? 'text-red-300' : 'text-slate-400'}>
                {entry.state === 'partial' && entry.detail ? entry.detail : STATE_TEXT[entry.state]}
              </span>
            </div>
          );
        })}
        {outcome ? <p className="text-xs text-slate-300 pt-1">{outcomeLine(outcome)}</p> : null}
      </div>
      {running ? (
        <button type="button" onClick={onCancel} className="w-full min-h-[44px] rounded-lg border border-red-500 text-red-300 text-sm font-bold">
          Cancel
        </button>
      ) : null}
    </div>
  );
}
