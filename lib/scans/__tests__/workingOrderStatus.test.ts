// lib/scans/__tests__/workingOrderStatus.test.ts
// CC-WHEEL-0001 S1 -- one definition of a working order for covered-call capacity.
import { describe, it, expect } from 'vitest';
import { isWorkingOrderStatus } from '../workingOrderStatus';
import { normalizeWorkingCallReservations } from '../covered-call-capacity';
import { normalizeWorkingCallReservations as normalizeSnapshotReservations } from '@/lib/portfolio-snapshot/normalizeWorkingOrders';

const WORKING = ['Live', 'live', ' LIVE ', 'Working', 'Received', 'Routed', 'In Flight', 'in  flight', 'Contingent', 'Cancel Requested', 'Replace Requested'];
const NOT_WORKING = ['Filled', 'Cancelled', 'Expired', 'Rejected', 'Removed', '', null, undefined];

describe('isWorkingOrderStatus', () => {
  it.each(WORKING)('treats %j as working', (s) => expect(isWorkingOrderStatus(s)).toBe(true));
  it.each(NOT_WORKING)('treats %j as not working', (s) => expect(isWorkingOrderStatus(s as string | null | undefined)).toBe(false));
});

describe('both capacity modules reserve shares for the same statuses', () => {
  const order = (status: string) => ({
    status,
    legs: [{ symbol: 'MU    260918C00130000', action: 'Sell to Open', quantity: 1 }],
  });
  it.each([...WORKING, ...(NOT_WORKING.filter(Boolean) as string[])])('%s', (status) => {
    const a = normalizeWorkingCallReservations([order(status)] as never).bySymbol.MU ?? 0;
    const b = normalizeSnapshotReservations([order(status)] as never).bySymbol.MU ?? 0;
    expect(a).toBe(b);
    expect(a).toBe(isWorkingOrderStatus(status) ? 1 : 0);
  });
});
