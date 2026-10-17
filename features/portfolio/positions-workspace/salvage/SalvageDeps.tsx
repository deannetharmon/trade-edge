'use client';
// features/portfolio/positions-workspace/salvage/SalvageDeps.tsx
//
// SALVAGE-0001 slice D -- broker access for the Salvage order review, supplied
// by the Portfolio page (it owns the token, account and live/paper plumbing),
// the same boundary SellStockDialog uses. Without a provider the panel is
// read-only and says so.

import { createContext, useContext, type ReactNode } from 'react';
import type { Position } from '@/lib/portfolio-data/types';
import type { SalvageDryRunResult } from '@/lib/salvage/salvageDryRun';
import type { SalvageOrder } from '@/lib/salvage/salvageOrder';

export interface SalvageDeps {
  /** Refreshes positions and returns this one as it is NOW, or null if it is gone. */
  fetchFreshPosition: (positionKey: string) => Promise<Position | null>;
  /** Broker dry run. Places nothing. */
  dryRun: (order: SalvageOrder, accountNumber: string) => Promise<SalvageDryRunResult>;
  /** Places the real order. Called only from inside submitSalvageOrderIfSafe. */
  submit: (order: SalvageOrder, accountNumber: string) => Promise<{ orderId: string }>;
}

const SalvageDepsContext = createContext<SalvageDeps | null>(null);

export function SalvageDepsProvider({ value, children }: { value: SalvageDeps | null; children: ReactNode }) {
  return <SalvageDepsContext.Provider value={value}>{children}</SalvageDepsContext.Provider>;
}

export function useSalvageDeps(): SalvageDeps | null {
  return useContext(SalvageDepsContext);
}
