// features/portfolio/positions-workspace/DecisionHistory.tsx
//
// LEAPS-LEDGER-0001 -- "Decision history" for a held LEAPS: what the card said, what you did, and how you changed your rules, newest first.
// Loaded only when you ask. Every line is described by lib/leaps-position-intelligence/ledger.ts, and each says who recorded it: the server
// (an order the broker accepted), your browser (what the card showed, that you opened the review), or your saved rules.

import { useState } from 'react';
import { describeLedgerEvent, isDecisionHistoryEvent, type LedgerEventLike, type LedgerLine } from '@/lib/leaps-position-intelligence/ledger';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const TONE_TEXT: Record<LedgerLine['tone'], string> = { good: 'text-emerald-400', watch: 'text-amber-300', bad: 'text-red-400', neutral: 'text-white' };
const EVIDENCE_LABEL: Record<LedgerLine['evidence'], string> = { server: 'recorded by the server', client: 'reported by your browser', rules: 'your saved rules' };

export function DecisionHistory({ accountNumber, longOccSymbol }: { accountNumber: string; longOccSymbol: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<LedgerLine[]>([]);

  const load = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    try {
      const response = await fetch(`/api/leaps-ledger?accountNumber=${encodeURIComponent(accountNumber)}&longOcc=${encodeURIComponent(longOccSymbol)}&limit=50`);
      if (!response.ok) throw new Error('ledger request failed');
      const data = await response.json();
      const events: LedgerEventLike[] = Array.isArray(data?.events) ? data.events : [];
      setLines(events.filter(isDecisionHistoryEvent).map(describeLedgerEvent));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div data-testid="decision-history" className="mt-1">
      {status === 'idle' && <button type="button" onClick={() => void load()} className="min-h-8 rounded border border-white/15 px-3 text-[10px] text-neutral-300 focus:ring-2 focus:ring-teal-400">Show decision history</button>}
      {status === 'loading' && <p className="text-[10px] text-neutral-400">Loading the decision history…</p>}
      {status === 'error' && <p className="text-[10px] text-amber-300">Could not load the decision history. <button type="button" onClick={() => void load()} className="ml-1 underline focus:ring-2 focus:ring-teal-400">Try again</button></p>}
      {status === 'ready' && (
        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-wider text-neutral-400">Decision history · newest first</p>
          {lines.length === 0 && <p className="text-[10px] text-neutral-400">Nothing recorded yet. From now on this list shows what the card says when its state changes, orders you place through TradeEdge, when you open the PMCC review, and changes to your income rules.</p>}
          {lines.length > 0 && (
            <ul className="space-y-1 text-[10px]">
              {lines.map(line => (
                <li key={line.id} className="rounded border border-white/10 px-2 py-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-neutral-400">{new Date(line.at).toLocaleString()}</span>
                    <span className={TONE_TEXT[line.tone]}>{line.title}</span>
                    <span className="text-neutral-500">{EVIDENCE_LABEL[line.evidence]}</span>
                  </div>
                  {line.detail && <p className="mt-0.5 text-neutral-300">{line.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
