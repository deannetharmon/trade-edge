// features/portfolio/components/PercentPriceInputs.tsx

// ORDER-PCT-INPUT-0001: a percentage box and a price box that stay in sync. Typing a percentage asks the parent for the
// matching (tick-rounded) price; typing a price leaves the percentage to follow from it. The parent owns the price, which
// is what is sent; the percentage shown is always recomputed from that price, except while the trader is typing in it.

'use client';

import { useId, useState } from 'react';

export type PercentPriceTone = 'target' | 'stop' | 'limit';

const TONE: Record<PercentPriceTone, string> = {
  target: 'text-emerald-400 focus:border-emerald-500',
  stop: 'text-orange-400 focus:border-orange-500',
  limit: 'text-blue-400 focus:border-blue-500',
};

export interface PercentPriceInputsProps {
  pctLabel: string;
  priceLabel: string;
  /** Percentage derived from the current price; null when not computable. */
  pct: number | null;
  /** The price as the parent holds it (raw text while typing). */
  price: string;
  onPctChange: (pct: number) => void;
  onPriceChange: (raw: string) => void;
  onPriceBlur?: () => void;
  tone: PercentPriceTone;
  error?: string | null;
  /** e.g. "sent $3.80 · 29.6%" when tick rounding changed the typed percentage. */
  note?: string | null;
  disabled?: boolean;
  inputClassName?: string;
  labelClassName?: string;
}

export function formatPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

export function PercentPriceInputs({
  pctLabel, priceLabel, pct, price, onPctChange, onPriceChange, onPriceBlur, tone, error, note, disabled,
  inputClassName = 'border-white/20 bg-black/40', labelClassName = 'text-white/50',
}: PercentPriceInputsProps) {
  const id = useId();
  const [pctDraft, setPctDraft] = useState<string | null>(null);
  const [lastEdited, setLastEdited] = useState<'pct' | 'price'>('pct');
  const pctShown = pctDraft ?? (pct == null ? '' : formatPct(pct));
  const box = `w-full text-[11px] px-2 py-1.5 rounded border outline-none ${inputClassName} ${error ? 'border-red-500' : ''} ${TONE[tone]}`;
  const errorLine = error ? <p className="mt-1 text-[10px] text-red-400" role="alert">{error}</p> : null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-pct`} className={`flex-1 min-w-[150px] text-[9px] ${labelClassName}`}>
          {pctLabel}
          <span className="mt-1 flex items-center gap-1">
            <input
              id={`${id}-pct`} type="number" inputMode="decimal" step="1" value={pctShown} disabled={disabled}
              onChange={e => {
                setLastEdited('pct');
                setPctDraft(e.target.value);
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onPctChange(v);
              }}
              onBlur={() => setPctDraft(null)}
              className={box}
            />
            <span className={`text-[11px] ${labelClassName}`}>%</span>
          </span>
          {lastEdited === 'pct' && errorLine}
        </label>
        <label htmlFor={`${id}-price`} className={`flex-1 min-w-[150px] text-[9px] ${labelClassName}`}>
          {priceLabel}
          <span className="mt-1 flex items-center gap-1">
            <span className={`text-[11px] ${labelClassName}`}>$</span>
            <input
              id={`${id}-price`} type="number" inputMode="decimal" step="0.01" min="0.01" value={price} disabled={disabled}
              onChange={e => { setLastEdited('price'); setPctDraft(null); onPriceChange(e.target.value); }}
              onBlur={onPriceBlur}
              className={box}
            />
          </span>
          {lastEdited === 'price' && errorLine}
        </label>
      </div>
      {note && <p className={`mt-1 text-[10px] ${labelClassName}`}>{note}</p>}
    </div>
  );
}
