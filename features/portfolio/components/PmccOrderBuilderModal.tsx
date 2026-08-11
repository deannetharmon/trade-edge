// features/portfolio/components/PmccOrderBuilderModal.tsx

'use client';
import { useState } from 'react';
import { validatePmccStructure } from '@/lib/pmcc/pmccValidation';
import { buildPmccDiagonalOrder } from '@/lib/pmcc/pmccOrderBuilder';

export function PmccOrderBuilderModal({ symbol, accountNumber, onClose, onSubmit, th }: {
  symbol: string;
  accountNumber: string;
  onClose: () => void;
  onSubmit: (payload: any) => void;
  th: any;
}) {
  const [longStrike, setLongStrike] = useState<number>(100);
  const [shortStrike, setShortStrike] = useState<number>(115);
  const [longAsk, setLongAsk] = useState<number>(12.50);
  const [shortBid, setShortBid] = useState<number>(2.10);
  const [longDelta, setLongDelta] = useState<number>(0.84);
  const [shortDelta, setShortDelta] = useState<number>(0.28);

  const validation = validatePmccStructure(
    { symbol, expiry: '2027-01-15', strike: longStrike, optionType: 'C', delta: longDelta, bid: longAsk - 0.20, ask: longAsk, action: 'BTO' },
    { symbol, expiry: '2026-09-18', strike: shortStrike, optionType: 'C', delta: shortDelta, bid: shortBid, ask: shortBid + 0.20, action: 'STO' }
  );

  const handleExecute = () => {
    const payload = buildPmccDiagonalOrder(
      accountNumber,
      symbol,
      `${symbol}270115C${longStrike * 1000}`,
      `${symbol}260918C${shortStrike * 1000}`,
      validation.netDebit
    );
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl`}>
        <div className="flex justify-between items-center border-b pb-3">
          <h3 className={`text-sm font-bold ${th.text} tracking-wider`}>BUILD PMCC (Diagonal Debit Spread) — {symbol}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Structural Validation Feedback */}
        <div className={`p-4 rounded-xl border ${validation.isValid ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
          <p className="text-xs font-bold mb-1">
            {validation.isValid ? '✓ Structure Validated' : '✕ Structural Guardrail Block'}
          </p>
          <div className="text-[11px] space-y-1 text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            <p>Spread Width: ${validation.spreadWidth.toFixed(2)}</p>
            <p>Net Debit Required: ${validation.netDebit.toFixed(2)}</p>
            {validation.blockingReason && (
              <p className="text-red-400 font-bold mt-2 font-sans">⚠ {validation.blockingReason}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            disabled={!validation.isValid}
            onClick={handleExecute}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold tracking-widest transition-colors cursor-pointer disabled:cursor-not-allowed">
            Review & Send Diagonal Order
          </button>
          <button onClick={onClose} className={`px-4 py-3 border ${th.border} text-slate-400 rounded-xl text-xs font-medium hover:border-white/30 transition-colors`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
