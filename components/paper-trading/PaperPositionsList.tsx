// components/paper-trading/PaperPositionsList.tsx
//
// PT-0001 section 11: open and closed paper position lists. Pure
// presentation + the close-flow trigger; no fetch/mutation logic of its own
// beyond delegating to PaperCloseForm and a manual mark-refresh call.

'use client';

import { useState } from 'react';
import type { PaperTradingPosition } from '@/lib/paper-trading/types';
import PaperCloseForm from './PaperCloseForm';
import PaperMarkForm from './PaperMarkForm';

function daysToExpiration(expiration: string): number {
  const ms = new Date(`${expiration}T00:00:00`).getTime() - Date.now();
  return Math.round(ms / 86400000);
}

function PricingSourceTag({ source }: { source: string }) {
  const label = source === 'manual_paper_fill' ? 'Manual Paper Fill' : source === 'stale_confirmed' ? 'Stale Confirmed' : 'Marketable';
  const tone = source === 'manual_paper_fill' ? 'bg-violet-900/50 text-violet-200' : source === 'stale_confirmed' ? 'bg-amber-900/50 text-amber-200' : 'bg-slate-800 text-slate-300';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{label}</span>;
}

function OpenPositionCard({ position, onChanged }: { position: PaperTradingPosition; onChanged: () => void }) {
  const [closing, setClosing] = useState(false);
  const [marking, setMarking] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">
            {position.symbol} {position.strategy} x{position.quantity}
          </p>
          <p className="text-xs text-slate-400">
            Exp {position.expiration} ({daysToExpiration(position.expiration)} DTE)
          </p>
        </div>
        <PricingSourceTag source={position.entryFill.pricingSource} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div>
          <p className="text-slate-500">Entry Credit</p>
          <p className="text-white">${position.entryCredit.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Max Risk</p>
          <p className="text-white">${position.theoreticalMaxLoss.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Current Mark</p>
          <p className="text-white">{position.currentMark ? `$${position.currentMark.simulatedFillValue.toFixed(2)}` : 'Not marked yet'}</p>
        </div>
        <div>
          <p className="text-slate-500">Unrealized P/L</p>
          <p className={position.unrealizedPnl != null && position.unrealizedPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}>
            {position.unrealizedPnl != null ? `$${position.unrealizedPnl.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>

      {position.entryRationale && <p className="mt-2 text-[11px] italic text-slate-500">&ldquo;{position.entryRationale}&rdquo;</p>}

      {!closing && !marking && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setClosing(true)}
            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/30"
          >
            Close Paper Position
          </button>
          <button
            onClick={() => setMarking(true)}
            className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-950/30"
          >
            Refresh Mark
          </button>
        </div>
      )}
      {closing && (
        <PaperCloseForm
          position={position}
          onCancel={() => setClosing(false)}
          onClosed={() => {
            setClosing(false);
            onChanged();
          }}
        />
      )}
      {marking && (
        <PaperMarkForm
          position={position}
          onCancel={() => setMarking(false)}
          onMarked={() => {
            setMarking(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ClosedPositionRow({ position }: { position: PaperTradingPosition }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
      <span className="text-slate-300">
        {position.symbol} {position.strategy} x{position.quantity} — closed {position.closeTimestamp?.slice(0, 10)}
      </span>
      <span className={position.realizedPnl != null && position.realizedPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}>
        {position.realizedPnl != null ? `$${position.realizedPnl.toFixed(2)}` : '—'}
      </span>
    </div>
  );
}

export default function PaperPositionsList({
  openPositions,
  closedPositions,
  onChanged,
}: {
  openPositions: PaperTradingPosition[];
  closedPositions: PaperTradingPosition[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Open Positions ({openPositions.length})</h2>
        {openPositions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">No open paper positions yet.</p>
        ) : (
          <div className="space-y-3">
            {openPositions.map((p) => (
              <OpenPositionCard key={p.positionId} position={p} onChanged={onChanged} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Closed Positions ({closedPositions.length})</h2>
        {closedPositions.length === 0 ? (
          <p className="text-xs text-slate-600">No closed paper positions yet.</p>
        ) : (
          <div className="space-y-2">
            {closedPositions
              .slice()
              .reverse()
              .map((p) => (
                <ClosedPositionRow key={p.positionId} position={p} />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
