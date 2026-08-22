// lib/portfolio-snapshot/__tests__/normalizeEquity.test.ts
// LCC-0001A PR 1 — equity-holding normalization tests.
// Traces to docs/design/LCC-0001A-technical-spec.md §15/§16:
//   - "Equity visibility" acceptance criterion
//   - "Short stock" acceptance criterion
//   - "Incomplete basis" acceptance criterion
//   - Multiple accounts remain distinct (accountNumber is a passthrough field, not derived)
import { describe, it, expect } from 'vitest';
import { normalizeEquityHoldings, type RawPositionLike } from '../normalizeEquity';

const equity = (
  symbol: string,
  qty: number,
  direction: string = 'Long',
  avgPrice?: number,
): RawPositionLike => ({
  'instrument-type': 'Equity',
  'underlying-symbol': symbol,
  symbol,
  quantity: qty,
  'quantity-direction': direction,
  ...(avgPrice != null ? { 'average-open-price': avgPrice } : {}),
});

const option = (symbol: string): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  symbol,
  quantity: 1,
  'quantity-direction': 'Short',
});

describe('normalizeEquityHoldings', () => {
  it('produces a Long EquityHolding with complete basis for a single-lot position', () => {
    const result = normalizeEquityHoldings([equity('MSFT', 250, 'Long', 300)], 'ACC1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      accountNumber: 'ACC1',
      symbol: 'MSFT',
      direction: 'Long',
      quantity: 250,
      basis: 300,
      basisComplete: true,
    });
  });

  it('weights basis across multiple lots of the same symbol and direction', () => {
    const result = normalizeEquityHoldings(
      [equity('AAPL', 100, 'Long', 100), equity('AAPL', 100, 'Long', 200)],
      'ACC1',
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(200);
    expect(result[0].basis).toBe(150);
    expect(result[0].basisComplete).toBe(true);
  });

  it('retains short stock as a visible holding with direction Short (LCC-0001A "Short stock" criterion)', () => {
    const result = normalizeEquityHoldings([equity('TSLA', 50, 'Short', 250)], 'ACC1');
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe('Short');
    expect(result[0].quantity).toBe(50);
    // Quantity is a positive magnitude; direction carries the sign, never a negative quantity.
    expect(result[0].quantity).toBeGreaterThan(0);
  });

  it('never merges Long and Short lots of the same underlying into one group', () => {
    const result = normalizeEquityHoldings(
      [equity('NVDA', 100, 'Long', 400), equity('NVDA', 30, 'Short', 500)],
      'ACC1',
    );
    expect(result).toHaveLength(2);
    const long = result.find(h => h.direction === 'Long');
    const short = result.find(h => h.direction === 'Short');
    expect(long?.quantity).toBe(100);
    expect(long?.basis).toBe(400);
    expect(short?.quantity).toBe(30);
    expect(short?.basis).toBe(500);
  });

  it('marks basis incomplete when at least one contributing lot has no usable basis, and never averages the partial basis over all shares (LCC-0001A "Incomplete basis" criterion)', () => {
    const result = normalizeEquityHoldings(
      [equity('IBM', 100, 'Long', 140), equity('IBM', 100, 'Long')], // second lot: no average-open-price
      'ACC1',
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(200);
    expect(result[0].basisComplete).toBe(false);
    expect(result[0].basis).toBeNull();
  });

  it('marks basis incomplete when the only lot has an invalid (non-positive) basis', () => {
    const result = normalizeEquityHoldings([equity('GME', 10, 'Long', 0)], 'ACC1');
    expect(result[0].basisComplete).toBe(false);
    expect(result[0].basis).toBeNull();
  });

  it('drops non-positive and invalid quantities without creating a holding', () => {
    const result = normalizeEquityHoldings(
      [equity('ZERO', 0, 'Long', 10), equity('NEG', -5, 'Long', 10)],
      'ACC1',
    );
    expect(result).toHaveLength(0);
  });

  it('drops rows with no resolvable symbol', () => {
    const noSymbol: RawPositionLike = {
      'instrument-type': 'Equity',
      quantity: 10,
      'quantity-direction': 'Long',
      'average-open-price': 10,
    };
    const result = normalizeEquityHoldings([noSymbol], 'ACC1');
    expect(result).toHaveLength(0);
  });

  it('ignores non-Equity instrument types entirely', () => {
    const result = normalizeEquityHoldings([option('AAPL')], 'ACC1');
    expect(result).toHaveLength(0);
  });

  it('drops rows with an unrecognized quantity-direction value', () => {
    const result = normalizeEquityHoldings([equity('WEIRD', 10, 'Sideways', 10)], 'ACC1');
    expect(result).toHaveLength(0);
  });

  it('is idempotent: running the same input twice produces the same output, no duplicate holdings', () => {
    const input = [equity('MSFT', 250, 'Long', 300)];
    const first = normalizeEquityHoldings(input, 'ACC1');
    const second = normalizeEquityHoldings(input, 'ACC1');
    expect(second).toEqual(first);
  });

  it('carries the passed-in accountNumber onto every holding, keeping multiple accounts distinct', () => {
    const acc1 = normalizeEquityHoldings([equity('MSFT', 100, 'Long', 100)], 'ACC1');
    const acc2 = normalizeEquityHoldings([equity('MSFT', 100, 'Long', 100)], 'ACC2');
    expect(acc1[0].accountNumber).toBe('ACC1');
    expect(acc2[0].accountNumber).toBe('ACC2');
  });

  it('keeps unavailable quote fields null and marks the quote stale', () => {
    const result = normalizeEquityHoldings([equity('MSFT', 100, 'Long', 100)], 'ACC1');
    expect(result[0].currentPrice).toBeNull();
    expect(result[0].marketValue).toBeNull();
    expect(result[0].unrealizedPnl).toBeNull();
    expect(result[0].quoteAsOf).toBeNull();
    expect(result[0].staleQuote).toBe(true);
    expect(result[0].deliverable).toBe('standard');
    expect(result[0].settledQuantity).toBeNull();
    expect(result[0].dataQualityWarnings).toEqual([]);
  });

  it('uses a verified broker mark for value and unrealized P/L', () => {
    const result = normalizeEquityHoldings([
      { ...equity('MSFT', 100, 'Long', 100), 'mark-price': '112.50' },
    ], 'ACC1');
    expect(result[0]).toMatchObject({ currentPrice: 112.5, marketValue: 11250, unrealizedPnl: 1250, staleQuote: false });
  });
});
