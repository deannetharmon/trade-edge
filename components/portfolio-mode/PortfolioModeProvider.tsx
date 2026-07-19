// components/portfolio-mode/PortfolioModeProvider.tsx
//
// PT-0002A: the single, application-wide PortfolioMode provider, mounted
// once in app/providers.tsx (same pattern as TaskProvider and
// PortfolioDataProvider). Owns mode selection and its hydration-safe
// resolution from lib/portfolio-mode/persistence.ts; owns nothing about
// portfolio DATA (positions/balances/ledgers) -- that remains
// PortfolioDataProvider's (LIVE) and the PT-0001 API's (PAPER)
// responsibility, reached only through the adapters in
// lib/portfolio-mode/liveAdapter.ts / paperAdapter.ts. This provider has no
// dependency on PortfolioDataProvider and PortfolioDataProvider has no
// dependency on it -- deliberately, to avoid any provider cycle and to keep
// mode selection usable even on routes that never mount portfolio data.
//
// Hydration safety: the very first render (server, and the client's first
// paint before hydration) is always `status: 'resolving'` with `mode: null`
// -- identical on server and client, so there is no hydration mismatch to
// warn about. Only after mount does a `useEffect` read
// localStorage (via readPersistedPortfolioMode()) and transition to
// 'ready' or 'invalid'. Because no existing screen reads this context today
// (see the Implementation Report's Known Limitations), this resolution
// window causes no visible flicker anywhere in the current app -- it only
// affects the new PortfolioModeIndicator, which is designed to render a
// neutral state during 'resolving' (see that component).
//
// First-use vs. invalid (Mandatory Invariant 5 / Persistence Requirements):
//   - 'first-use' (no key ever stored) is documented, tested,
//     product-intentional new-user initialization: silently resolves to
//     LIVE and persists that choice, exactly once.
//   - 'invalid' (a key is stored but is not exactly 'LIVE' or 'PAPER', or
//     storage itself could not be read) is never coerced into LIVE or
//     PAPER. Status stays 'invalid' with the offending raw value exposed
//     for display; the app must show a visible, forced resolution prompt
//     (PortfolioModeIndicator) rather than silently picking a side.

'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { readPersistedPortfolioMode, writePersistedPortfolioMode } from '@/lib/portfolio-mode/persistence';
import type { PortfolioMode } from '@/lib/portfolio-mode/types';

export type PortfolioModeStatus = 'resolving' | 'ready' | 'invalid';

export interface PortfolioModeContextValue {
  status: PortfolioModeStatus;
  mode: PortfolioMode | null;
  /** Only meaningful when status === 'invalid'. The literal stored value
   *  that failed validation, or null if the storage read itself failed. */
  rawInvalidValue: string | null;
  /** Sets the mode explicitly, persists it, and moves status to 'ready'.
   *  This is the only way 'invalid' can resolve -- an explicit user choice,
   *  never an automatic fallback. */
  setMode: (mode: PortfolioMode) => void;
}

const PortfolioModeContext = createContext<PortfolioModeContextValue | null>(null);

export function PortfolioModeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PortfolioModeStatus>('resolving');
  const [mode, setModeState] = useState<PortfolioMode | null>(null);
  const [rawInvalidValue, setRawInvalidValue] = useState<string | null>(null);

  useEffect(() => {
    const result = readPersistedPortfolioMode();
    if (result.status === 'valid') {
      setModeState(result.mode);
      setStatus('ready');
      return;
    }
    if (result.status === 'first-use') {
      // Documented, tested new-user initialization -- not ambiguity. See
      // this file's module doc and
      // lib/portfolio-mode/__tests__/persistence.test.tsx.
      writePersistedPortfolioMode('LIVE');
      setModeState('LIVE');
      setStatus('ready');
      return;
    }
    // status === 'invalid': never coerce to LIVE or PAPER.
    setRawInvalidValue(result.rawValue);
    setModeState(null);
    setStatus('invalid');
  }, []);

  const setMode = useCallback((next: PortfolioMode) => {
    writePersistedPortfolioMode(next);
    setModeState(next);
    setRawInvalidValue(null);
    setStatus('ready');
  }, []);

  return (
    <PortfolioModeContext.Provider value={{ status, mode, rawInvalidValue, setMode }}>
      {children}
    </PortfolioModeContext.Provider>
  );
}

export function usePortfolioMode(): PortfolioModeContextValue {
  const ctx = useContext(PortfolioModeContext);
  if (!ctx) {
    throw new Error('usePortfolioMode must be used within a PortfolioModeProvider');
  }
  return ctx;
}
