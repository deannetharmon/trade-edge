// components/RsiLine.tsx
//
// RSI-TURN-0001: one neutral line for an order window: "RSI(14), daily" and the plain-words state.
// Loads the daily closes itself when the window opens. INFORMATION ONLY: never blocks, warns on or scores an order.

'use client';

import { useEffect, useState } from 'react';
import { classifyRsiTurn, describeRsiTurn } from '@/lib/indicators/rsiTurn';
import type { THEMES, Theme } from '@/lib/theme';

const INDEX_CHART_SYMBOLS: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };

export function RsiLine({ symbol, th }: { symbol: string; th: typeof THEMES[Theme] }) {
  const [text, setText] = useState<string>('Loading…');
  useEffect(() => {
    let active = true;
    setText('Loading…');
    const chartSymbol = INDEX_CHART_SYMBOLS[symbol.toUpperCase()] ?? symbol;
    fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`)
      .then(response => response.json())
      .then(payload => {
        if (!active) return;
        const closes = (payload?.bars ?? []).map((bar: { c?: number | null }) => bar?.c);
        setText(describeRsiTurn(classifyRsiTurn(closes)));
      })
      .catch(() => { if (active) setText('RSI n/a'); });
    return () => { active = false; };
  }, [symbol]);
  return (
    <div className="flex justify-between text-xs" data-testid="rsi-line">
      <span className={th.textFaint}>RSI(14), daily</span>
      <span className={th.textMuted}>{text}</span>
    </div>
  );
}
