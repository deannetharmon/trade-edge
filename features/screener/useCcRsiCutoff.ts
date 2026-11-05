'use client';

// features/screener/useCcRsiCutoff.ts
// CC-WHEEL-0001 S3 -- the daily-RSI cutoff for the covered-call timing chip. A per-browser setting kept in localStorage
// (a UI preference). Every component using it stays in sync through a window event. Default 50; invalid values fall back.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CC_RSI_CUTOFF, sanitizeCcRsiCutoff } from '@/lib/scans/ccRsiChip';

const KEY = 'te-cc-rsi-cutoff';
const EVENT = 'te-cc-rsi-cutoff-change';

function read(): number {
  try { return sanitizeCcRsiCutoff(window.localStorage.getItem(KEY)); } catch { return DEFAULT_CC_RSI_CUTOFF; }
}

export function useCcRsiCutoff(): [number, (next: number) => void] {
  const [cutoff, setCutoff] = useState<number>(DEFAULT_CC_RSI_CUTOFF);
  useEffect(() => {
    setCutoff(read());
    const onChange = () => setCutoff(read());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const update = useCallback((next: number) => {
    try { window.localStorage.setItem(KEY, String(sanitizeCcRsiCutoff(next))); } catch { /* storage unavailable: the chip still works with the default */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [cutoff, update];
}
