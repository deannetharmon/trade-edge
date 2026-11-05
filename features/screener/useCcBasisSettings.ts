'use client';

// features/screener/useCcBasisSettings.ts
// CC-WHEEL-0001 S2b -- client side of /api/cc-basis: the typed cost basis and the per-position
// "allow strikes below my basis" opt-in. Components using the hook stay in sync through a window event.

import { useCallback, useEffect, useState } from 'react';
import { normalizeCcBasisSymbol, sanitizeCcBasisSettings, type CcBasisEntry, type CcBasisSettings } from '@/lib/ccBasis/ccBasisSettings';

const EVENT = 'te-cc-basis-change';
let cache: CcBasisSettings | null = null;

/** The saved settings; {} when signed out or offline (the scan then uses the broker's basis, never a guess). */
export async function fetchCcBasisSettings(): Promise<CcBasisSettings> {
  try {
    const res = await fetch('/api/cc-basis');
    if (!res.ok) return cache ?? {};
    const json = await res.json();
    cache = sanitizeCcBasisSettings(json?.config?.settings);
    return cache;
  } catch {
    return cache ?? {};
  }
}

/** Saves (or, with null, clears) one symbol. Returns the new settings, or null when the save failed. */
export async function saveCcBasisEntry(symbol: string, entry: CcBasisEntry | null): Promise<CcBasisSettings | null> {
  const key = normalizeCcBasisSymbol(symbol);
  if (!key) return null;
  try {
    const current = await fetchCcBasisSettings();
    const next: CcBasisSettings = { ...current };
    delete next[key];
    if (entry) next[key] = entry;
    const clean = sanitizeCcBasisSettings(next);
    const res = await fetch('/api/cc-basis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: clean }),
    });
    if (!res.ok) return null;
    cache = clean;
    window.dispatchEvent(new Event(EVENT));
    return clean;
  } catch {
    return null;
  }
}

export function useCcBasisSettings(): { settings: CcBasisSettings; ready: boolean; save: (symbol: string, entry: CcBasisEntry | null) => Promise<boolean> } {
  const [settings, setSettings] = useState<CcBasisSettings>(cache ?? {});
  const [ready, setReady] = useState(cache !== null);
  useEffect(() => {
    let live = true;
    const load = () => { void fetchCcBasisSettings().then(s => { if (live) { setSettings(s); setReady(true); } }); };
    load();
    const onChange = () => { if (cache && live) setSettings(cache); };
    window.addEventListener(EVENT, onChange);
    return () => { live = false; window.removeEventListener(EVENT, onChange); };
  }, []);
  const save = useCallback(async (symbol: string, entry: CcBasisEntry | null) => {
    const next = await saveCcBasisEntry(symbol, entry);
    if (next) setSettings(next);
    return next !== null;
  }, []);
  return { settings, ready, save };
}
