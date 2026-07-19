// lib/portfolio-mode/paperAdapter.ts
//
// PT-0002A: the PAPER adapter required by the design doc's architecture
// diagram. Reads exclusively through PT-0001's own read API route
// (`GET /api/paper-trading/account`, the same route app/paper-trading/
// page.tsx already calls) and reshapes the result into the
// PortfolioModeAdapterState<T> envelope (lib/portfolio-mode/contract.ts).
//
// Isolation guarantee (enforced by
// lib/portfolio-mode/__tests__/adapterIsolation.test.ts, which source-scans
// this file): this module does not import, and must never import,
// lib/tastytrade.ts, lib/tastytrade/client.ts, or
// lib/portfolio-data/acquisition.ts, and must never reference
// loadPositions/loadAccountBalances/ttFetch/getAccessToken/placeOrder by
// name. It reaches the paper ledger the exact same way the existing,
// already-isolated PT-0001 page does -- an HTTP call to PT-0001's own API
// route -- never a direct import of server-side paper-trading modules
// (which are Redis-backed and not meant to run in the browser), and never
// any live acquisition path. This file is not wired into any existing
// screen in PT-0002A (see the Implementation Report's Known Limitations) --
// it exists as tested, ready-to-consume infrastructure for PT-0002B.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaperTradingLedgerView } from '@/lib/paper-trading/types';
import type { PortfolioModeAdapterState } from './contract';

export interface PaperPortfolioModeData {
  ledgerView: PaperTradingLedgerView;
}

export function usePaperPortfolioModeAdapter(): PortfolioModeAdapterState<PaperPortfolioModeData> {
  const [data, setData] = useState<PaperPortfolioModeData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/paper-trading/account');
      const body = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setStatus('error');
        setError(body?.error ?? 'Failed to load paper account.');
        return;
      }
      setData({ ledgerView: body.view as PaperTradingLedgerView });
      setLastRefreshedAt(new Date().toISOString());
      setStatus('ready');
    } catch (e) {
      if (!mountedRef.current) return;
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    mode: 'PAPER',
    status,
    error,
    lastRefreshedAt,
    data,
    refresh,
  };
}
