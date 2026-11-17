'use client';

// features/screener/useCcMinPay.ts
// CC-PMCC-GUIDANCE-0001 R2 -- Dean's "Pays at least" setting: total dollars for the whole order. One setting for the strike
// grid, the scan rows and the stock card, kept in localStorage and synced across components by a window event.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CC_MIN_PAY, sanitizeCcMinPay } from '@/lib/scans/ccGridView';

const KEY = 'te-cc-min-pay';
const EVENT = 'te-cc-min-pay-change';

function read(): number {
  try { return sanitizeCcMinPay(window.localStorage.getItem(KEY)); } catch { return DEFAULT_CC_MIN_PAY; }
}

export function useCcMinPay(): [number, (n: number) => void] {
  const [minPay, setState] = useState<number>(DEFAULT_CC_MIN_PAY);
  useEffect(() => {
    setState(read());
    const sync = () => setState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const set = useCallback((n: number) => {
    setState(n);
    try { window.localStorage.setItem(KEY, String(n)); } catch { /* the choice still applies for this visit */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [minPay, set];
}
