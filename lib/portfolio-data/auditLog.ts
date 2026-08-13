// lib/portfolio-data/auditLog.ts
//
// Build-fix note: AuditEntry and filterStopGtcHistory originally lived
// directly in app/portfolio/page.tsx (exported so the test file could
// import them). Next.js's App Router restricts what a special `page.tsx`
// file may export to the default page component plus a small allow-list
// (metadata, generateMetadata, etc.) -- any other named export fails the
// production build with "X is not a valid Page export field", even though
// it passes `tsc --noEmit` cleanly (this is a Next.js-specific route-file
// constraint, not a general TypeScript error, which is why it wasn't
// caught until the actual Vercel build). Moved here so page.tsx only
// imports these, never exports them.

import type { ActionType } from './types';

export interface AuditEntry {
  id: string;
  timestamp: string;
  symbol: string;
  strategy: string;
  action: ActionType;
  orderType: string;
  limitPrice: number;
  quantity: number;
  orderId: string;
  status: 'submitted' | 'error' | 'dry-run';
  error?: string;
  estPnl?: number;
  closeProfitPct?: number;  // % profit captured on TAKE_PROFIT closes (e.g. 65 for 65%)
  creditAtClose?: number;   // credit per contract at time of close — used to back-calc pct
  // PI-0011: OCO/stop-loss placements carry two prices (GTC target AND stop
  // trigger), which `limitPrice` alone can't represent. Both optional so
  // every other existing entry shape/consumer is unaffected -- only
  // SetStopLossButton's submit() populates these, and only for a CONFIRMED
  // broker placement, never a draft edit (see writeAuditEntry call site).
  gtcPrice?: number;
  stopPrice?: number;
  // ES-0001: diagnostic/audit evidence for the canonical close-order safety
  // gate -- reuses this existing audit mechanism rather than adding a new
  // one. groupKey lets a later investigation trace exactly which canonical
  // position group (post-split, if any) this order was built against.
  groupKey?: string;
  safetyGateOk?: boolean;
  safetyGateIssues?: string[];  // rule IDs of any issues (block or warn)
}

// PI-0011: which audit entries count as stop/GTC change history for a given
// position -- extracted as a pure, named, exported function specifically so
// it's unit-testable without a full component render harness (SetStopLossButton
// depends on live price fetch, AI suggestion fetch, and modal-open state, none
// of which are worth mocking just to test a filter predicate). Only entries
// carrying gtcPrice/stopPrice count -- ordinary trade-execution audit entries
// (closes, rolls, take-profits) are deliberately excluded even if they share
// the same groupKey, since this history is scoped to stop/GTC placements only.
export function filterStopGtcHistory(log: AuditEntry[], positionKey: string): AuditEntry[] {
  return log.filter(e => e.groupKey === positionKey && (e.gtcPrice != null || e.stopPrice != null));
}
