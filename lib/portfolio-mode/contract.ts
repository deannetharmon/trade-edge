// lib/portfolio-mode/contract.ts
//
// PT-0002A: the canonical mode-aware portfolio-context contract required by
// the design doc's "Required Architecture" diagram. This is intentionally a
// thin, shared ENVELOPE -- status/error/refresh -- around each mode's own,
// already-canonical payload shape. It does not attempt to force LIVE
// positions (lib/portfolio-data/types.ts's `Position[]`) and PAPER positions
// (lib/paper-trading/types.ts's `PaperTradingPosition[]`) into one unified
// shape. They are genuinely different domains with different fields
// (broker-sourced Greeks/stop-loss/recommendation data vs. simulated-fill
// evidence), and forcing artificial parity between them would itself be the
// kind of "duplicated logic" the design doc's Mandatory Invariant 7
// forbids. What both adapters share is this envelope -- mode, load status,
// error, last-refreshed timing, and a refresh() action -- which is exactly
// what PT-0002B's screen integration will need to render a mode-aware
// panel generically, regardless of which payload shape is inside.

import type { PortfolioMode } from './types';

export type PortfolioModeAdapterStatus = 'loading' | 'ready' | 'error';

export interface PortfolioModeAdapterState<TData> {
  mode: PortfolioMode;
  status: PortfolioModeAdapterStatus;
  error: string | null;
  lastRefreshedAt: string | null;
  data: TData | null;
  refresh: () => Promise<void>;
}
