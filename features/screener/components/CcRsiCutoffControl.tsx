'use client';

// features/screener/components/CcRsiCutoffControl.tsx
// CC-WHEEL-0001 S3 -- the one setting behind the Ready / Recovery / Wait chip: the daily RSI at or above which you are
// willing to sell a covered call. Default 50. Applies to the chip only; it does not filter results.

import { useEffect, useState } from 'react';
import { useCcRsiCutoff } from '../useCcRsiCutoff';
import { DEFAULT_CC_RSI_CUTOFF } from '@/lib/scans/ccRsiChip';

export function CcRsiCutoffControl() {
  const [cutoff, setCutoff] = useCcRsiCutoff();
  const [text, setText] = useState(String(cutoff));
  useEffect(() => { setText(prev => (prev !== '' && Number(prev) === cutoff ? prev : String(cutoff))); }, [cutoff]);
  return (
    <label className="flex items-center gap-1 text-[10px] text-neutral-400" title="The chip reads Wait when daily RSI is below this. It does not remove any result.">
      Sell calls when daily RSI ≥
      <input
        aria-label="RSI cutoff"
        inputMode="numeric"
        value={text}
        onChange={e => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 1 && n <= 99) setCutoff(n);
        }}
        onBlur={() => { if (text.trim() === '' || !(Number(text) >= 1 && Number(text) <= 99)) { setCutoff(DEFAULT_CC_RSI_CUTOFF); setText(String(DEFAULT_CC_RSI_CUTOFF)); } }}
        className="w-10 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-center text-xs text-white"
      />
    </label>
  );
}
