// features/screener/lib/useCardView.ts

'use client';

import { useSyncExternalStore } from 'react';

export type CardView = 'clean' | 'full';
const KEY = 'hunter-card-view';
const EVENT = 'hunter-card-view-change';

export function readCardView(): CardView {
  try { return window.localStorage.getItem(KEY) === 'full' ? 'full' : 'clean'; } catch { return 'clean'; }
}

export function writeCardView(v: CardView): void {
  try { window.localStorage.setItem(KEY, v); } catch { /* storage unavailable: applies to this visit only */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
}

/** Clean (default) or Full. Remembered in this browser; every card on the page follows one toggle. */
export function useCardView(): CardView {
  return useSyncExternalStore(subscribe, readCardView, () => 'clean');
}
