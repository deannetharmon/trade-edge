// lib/scans/workingOrderStatus.ts
// CC-WHEEL-0001 S1 -- one definition of "this order is still working" for covered-call capacity.
//
// An order that is still working reserves shares. TastyTrade reports Received, Routed, In Flight, Live and
// Contingent while an order is open; a cancel or replace request leaves it working until the broker confirms.
// 'working' is kept because earlier code accepted it. Over-counting here is the safe direction: it can only
// lower available capacity, never raise it. Matching is case- and whitespace-insensitive.
// Not used by existingGtcReplacement.ts, which asks a different question (can this order be replaced).

const WORKING_ORDER_STATUSES = new Set([
  'live',
  'working',
  'received',
  'routed',
  'in flight',
  'contingent',
  'cancel requested',
  'replace requested',
]);

export function isWorkingOrderStatus(raw: string | null | undefined): boolean {
  return WORKING_ORDER_STATUSES.has(String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
}
