// lib/wheel/instrumentKind.ts
//
// WHEEL-SYSTEM-0001 (W1) -- is a symbol an ETF-like or a single stock, for choosing the target delta.
//
// Reuses the screener's own detection (classifyUnderlying in lib/scans/tastytrade-client.ts: the broker's
// /instruments/equities record, with a session cache) so the Wheel plan and the screener always agree.
// An index counts as ETF-like here (a broad basket, priced at the ETF delta). A symbol the broker does not
// support returns null, and the row falls back to "stock" and can be corrected by hand.
//
// Known quirk inherited from the screener: a transient broker error on a symbol that is not a known index is
// classified "index" (and cached for the session), so it would read as ETF-like here. The Type box on the row corrects it.

import { classifyUnderlying } from '@/lib/scans/tastytrade-client';
import type { InstrumentKind } from './capitalPlan';

export async function fetchInstrumentKind(symbol: string, token: string): Promise<InstrumentKind | null> {
  try {
    const classification = await classifyUnderlying(symbol, token);
    if (classification === 'etf' || classification === 'index') return 'etf';
    if (classification === 'stock') return 'stock';
    return null;
  } catch {
    return null;
  }
}
