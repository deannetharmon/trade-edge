// lib/tradeLog/__tests__/reconstructTrades.test.ts
//
// PI-0008E: Closed Trade Integrity -- targeted tests for the shared
// reconstruction module against fixture TastyTrade transaction arrays
// (no live session needed). Covers the scope items from the ticket:
// normal spread parity, partial closes, assignment, exercise/expiration,
// reconstruction metadata, and unmatched closures.

import { describe, expect, it } from 'vitest';
import { reconstructTrades, type RawTransaction } from '../reconstructTrades';

function tx(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    'transaction-type': 'Trade',
    quantity: '1',
    price: '0',
    commission: '0',
    'regulatory-fees': '0',
    'clearing-fees': '0',
    ...overrides,
  };
}

describe('reconstructTrades: normal spread (parity with pre-PI-0008E behavior)', () => {
  it('reconstructs a fully-closed bull put spread with the same pnl/credit/fees/exitType math as before', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'o1', symbol: 'SPY240119P00450000', 'underlying-symbol': 'SPY', 'transaction-sub-type': 'Sell to Open', 'executed-at': '2024-01-02T14:30:00.000Z', quantity: '1', price: '3.00' }),
      tx({ id: 'o2', symbol: 'SPY240119P00445000', 'underlying-symbol': 'SPY', 'transaction-sub-type': 'Buy to Open',  'executed-at': '2024-01-02T14:30:00.000Z', quantity: '1', price: '1.00' }),
      tx({ id: 'c1', symbol: 'SPY240119P00450000', 'underlying-symbol': 'SPY', 'transaction-sub-type': 'Buy to Close', 'executed-at': '2024-01-10T15:00:00.000Z', quantity: '1', price: '1.00' }),
      tx({ id: 'c2', symbol: 'SPY240119P00445000', 'underlying-symbol': 'SPY', 'transaction-sub-type': 'Sell to Close','executed-at': '2024-01-10T15:00:00.000Z', quantity: '1', price: '0.30' }),
    ];

    const { trades, unmatchedClosures } = reconstructTrades(transactions);

    expect(unmatchedClosures).toHaveLength(0);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.strategy).toBe('BPS');
    expect(t.creditReceived).toBeCloseTo(200, 5);   // 3.00*100 short - 1.00*100 long
    expect(t.closePrice).toBeCloseTo(70, 5);         // 1.00*100 - 0.30*100
    expect(t.pnl).toBeCloseTo(130, 5);
    expect(t.pnlPct).toBeCloseTo(65, 3);
    expect(t.fees).toBeCloseTo(0, 5);
    expect(t.holdDays).toBe(8);
    expect(t.outcome).toBe('WIN');
    expect(t.exitType).toBe('TARGET_HIT');
  });

  it('marks a clean full close as COMPLETE/CLOSED with matching opened/closed/remaining quantities', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'o1', symbol: 'AMD240216P00150000', 'underlying-symbol': 'AMD', 'transaction-sub-type': 'Sell to Open', 'executed-at': '2024-01-05T15:00:00.000Z', quantity: '2', price: '2.00' }),
      tx({ id: 'c1', symbol: 'AMD240216P00150000', 'underlying-symbol': 'AMD', 'transaction-sub-type': 'Buy to Close', 'executed-at': '2024-01-12T15:00:00.000Z', quantity: '2', price: '1.00' }),
    ];
    const { trades } = reconstructTrades(transactions);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.reconstructionStatus).toBe('COMPLETE');
    expect(t.closureMechanism).toBe('CLOSED');
    expect(t.openedQuantity).toBe(2);
    expect(t.closedQuantity).toBe(2);
    expect(t.remainingQuantity).toBe(0);
    expect(t.sourceTransactionIds.sort()).toEqual(['c1', 'o1']);
  });
});

describe('reconstructTrades: partial closes', () => {
  it('supports a single lot closed across two separate closing transactions with proportional credit/debit/fees', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'open', symbol: 'AAPL240216P00150000', 'underlying-symbol': 'AAPL', 'transaction-sub-type': 'Sell to Open', 'executed-at': '2024-01-05T15:00:00.000Z', quantity: '5', price: '2.00', commission: '3.25', 'regulatory-fees': '0.5', 'clearing-fees': '0.25' }),
      tx({ id: 'close1', symbol: 'AAPL240216P00150000', 'underlying-symbol': 'AAPL', 'transaction-sub-type': 'Buy to Close', 'executed-at': '2024-01-12T15:00:00.000Z', quantity: '3', price: '1.00', commission: '1.95', 'regulatory-fees': '0.3', 'clearing-fees': '0.15' }),
      tx({ id: 'close2', symbol: 'AAPL240216P00150000', 'underlying-symbol': 'AAPL', 'transaction-sub-type': 'Buy to Close', 'executed-at': '2024-01-20T15:00:00.000Z', quantity: '2', price: '0.50', commission: '1.30', 'regulatory-fees': '0.2', 'clearing-fees': '0.1' }),
    ];

    const { trades, unmatchedClosures } = reconstructTrades(transactions);
    expect(unmatchedClosures).toHaveLength(0);
    expect(trades).toHaveLength(2); // two tranches, not silently dropped

    const [later, earlier] = trades; // sorted by closeDate desc
    expect(earlier.closeDate).toBe('2024-01-12');
    expect(later.closeDate).toBe('2024-01-20');

    // Tranche 1: 3 of 5 contracts, fees prorated 3/5 on the open side.
    expect(earlier.closureMechanism).toBe('PARTIAL_CLOSE');
    expect(earlier.openedQuantity).toBe(5);
    expect(earlier.closedQuantity).toBe(3);
    expect(earlier.remainingQuantity).toBe(2);
    expect(earlier.creditReceived).toBeCloseTo(600, 5);   // 2.00*3*100
    expect(earlier.closePrice).toBeCloseTo(300, 5);       // 1.00*3*100
    expect(earlier.fees).toBeCloseTo(4.8, 5);             // (4.00*3/5) open + 2.40 close
    expect(earlier.pnl).toBeCloseTo(295.2, 5);
    expect(earlier.reconstructionStatus).toBe('COMPLETE');

    // Tranche 2: remaining 2 of 5 contracts.
    expect(later.closureMechanism).toBe('PARTIAL_CLOSE');
    expect(later.openedQuantity).toBe(5);
    expect(later.closedQuantity).toBe(2);
    expect(later.remainingQuantity).toBe(0); // fully closed after this tranche
    expect(later.creditReceived).toBeCloseTo(400, 5);     // 2.00*2*100
    expect(later.closePrice).toBeCloseTo(100, 5);         // 0.50*2*100
    expect(later.fees).toBeCloseTo(3.2, 5);               // (4.00*2/5) open + 1.60 close
    expect(later.pnl).toBeCloseTo(296.8, 5);

    // Nothing was preserved by accident/double-counted: total contracts
    // accounted for across both tranches equals what was opened.
    expect(earlier.closedQuantity + later.closedQuantity).toBe(5);
  });
});

describe('reconstructTrades: assignment', () => {
  it('reports an assigned short put using the option leg premium, never dropping it', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'open', symbol: 'TSLA240315P00200000', 'underlying-symbol': 'TSLA', 'transaction-sub-type': 'Sell to Open', 'executed-at': '2024-02-01T15:00:00.000Z', quantity: '1', price: '5.00', commission: '0.65', 'regulatory-fees': '0.05', 'clearing-fees': '0.02' }),
      {
        id: 'assign', symbol: 'TSLA240315P00200000', 'underlying-symbol': 'TSLA',
        'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Assignment',
        'executed-at': '2024-02-20T00:00:00.000Z', quantity: '1',
      },
    ];

    const { trades, unmatchedClosures } = reconstructTrades(transactions);
    expect(unmatchedClosures).toHaveLength(0);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.closureMechanism).toBe('ASSIGNED');
    expect(t.reconstructionStatus).toBe('COMPLETE');
    expect(t.creditReceived).toBeCloseTo(500, 5);
    expect(t.closePrice).toBeCloseTo(0, 5); // no closing trade -- value passed via the stock position
    expect(t.fees).toBeCloseTo(0.72, 5);    // only the open-side commission/fees
    expect(t.pnl).toBeCloseTo(499.28, 5);
    expect(t.outcome).toBe('WIN');
    expect(t.openedQuantity).toBe(1);
    expect(t.closedQuantity).toBe(1);
    expect(t.remainingQuantity).toBe(0);
  });
});

describe('reconstructTrades: exercise', () => {
  it('reports an exercised long call using only the premium paid, not the resulting stock position (documented scope boundary)', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'open', symbol: 'MSFT240419C00300000', 'underlying-symbol': 'MSFT', 'transaction-sub-type': 'Buy to Open', 'executed-at': '2024-03-01T15:00:00.000Z', quantity: '1', price: '4.00', commission: '0.65', 'regulatory-fees': '0.05', 'clearing-fees': '0.02' }),
      {
        id: 'exercise', symbol: 'MSFT240419C00300000', 'underlying-symbol': 'MSFT',
        'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Exercise',
        'executed-at': '2024-04-10T00:00:00.000Z', quantity: '1',
      },
    ];

    const { trades } = reconstructTrades(transactions);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.closureMechanism).toBe('EXERCISED');
    expect(t.reconstructionStatus).toBe('COMPLETE');
    // Paid $400 in premium and received nothing back on the option leg itself
    // (the exercised call became a stock position -- out of scope, see
    // reconstructTrades.ts's module doc comment). This is the option leg's
    // true, non-fabricated economics, not a bug.
    expect(t.creditReceived).toBeCloseTo(-400, 5);
    expect(t.pnl).toBeCloseTo(-400.72, 5);
    expect(t.outcome).toBe('LOSS');
  });
});

describe('reconstructTrades: expiration', () => {
  it('reports a worthless OTM expiration as a full-premium win via the same formula as a bought-back close', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'open', symbol: 'NVDA240517P00100000', 'underlying-symbol': 'NVDA', 'transaction-sub-type': 'Sell to Open', 'executed-at': '2024-04-01T15:00:00.000Z', quantity: '2', price: '1.50', commission: '1.30', 'regulatory-fees': '0.1', 'clearing-fees': '0.05' }),
      {
        id: 'expire', symbol: 'NVDA240517P00100000', 'underlying-symbol': 'NVDA',
        'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Expiration',
        'executed-at': '2024-05-17T00:00:00.000Z', quantity: '2',
      },
    ];

    const { trades } = reconstructTrades(transactions);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.closureMechanism).toBe('EXPIRED');
    expect(t.pnl).toBeCloseTo(298.55, 5);
    expect(t.outcome).toBe('WIN');
    expect(t.exitType).toBe('HELD_TO_EXPIRY'); // held 100% of its DTE, as expected
  });
});

describe('reconstructTrades: unmatched closures', () => {
  it('never fabricates a trade for a closing transaction with no open lot in the fetched window', () => {
    const transactions: RawTransaction[] = [
      tx({ id: 'orphan-close', symbol: 'QQQ240119C00400000', 'underlying-symbol': 'QQQ', 'transaction-sub-type': 'Buy to Close', 'executed-at': '2024-01-10T15:00:00.000Z', quantity: '1', price: '1.00' }),
    ];

    const { trades, unmatchedClosures } = reconstructTrades(transactions);
    expect(trades).toHaveLength(0);
    expect(unmatchedClosures).toHaveLength(1);
    expect(unmatchedClosures[0].transactionId).toBe('orphan-close');
    expect(unmatchedClosures[0].quantity).toBe(1);
  });
});
