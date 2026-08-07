// features/screener/components/__tests__/AccountingSummaryBar.test.tsx
//
// SCREENER-UX-0001 required tests 2-4: accounting summary never conflates
// "scanned" with "attempted", hides zero-value Failed/Skipped segments,
// carries a tooltip on every segment, and never renders qualified/
// disqualified as a misleading fraction (each is its own absolute count).

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AccountingSummaryBar } from '../AccountingSummaryBar';
import type { ScreenerScanSession } from '@/lib/screener/scanSession';

function baseSession(overrides: Partial<ScreenerScanSession> = {}): ScreenerScanSession {
  return {
    sessionId: 's1',
    mode: 'filter',
    requestedStrategy: 'spreads',
    scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['AAPL', 'MSFT'] },
    selectedSymbols: ['AAPL', 'MSFT'],
    plannedScanSymbols: ['AAPL', 'MSFT'],
    startedAt: 0,
    completedAt: 100,
    status: 'complete',
    symbolOutcomes: [
      { symbol: 'AAPL', status: 'evaluated', candidateCount: 1 },
      { symbol: 'MSFT', status: 'evaluated', candidateCount: 1 },
    ],
    results: [
      { symbol: 'AAPL', strategy: 'BPS', price: 100, ivr: 50, qualified: true, bestCandidate: null, failReasons: [], checks: {} as any },
      { symbol: 'MSFT', strategy: 'BPS', price: 100, ivr: 50, qualified: false, bestCandidate: null, failReasons: ['x'], checks: {} as any },
    ],
    cacheProvenance: 'live',
    cachedAt: null,
    schemaVersion: 3,
    ...overrides,
  };
}

describe('AccountingSummaryBar', () => {
  it('never labels attemptedCount as "scanned" — each segment carries its own precise label', () => {
    render(<AccountingSummaryBar session={baseSession()} />);
    const bar = screen.getByTestId('accounting-summary-bar');
    expect(bar).toHaveTextContent('2 selected');
    expect(bar).toHaveTextContent('2 planned');
    expect(bar).toHaveTextContent('2 attempted');
    expect(bar).toHaveTextContent('2 evaluated');
    expect(bar.textContent).not.toMatch(/scanned/i);
  });

  it('hides Failed and Skipped segments entirely when their counts are zero', () => {
    render(<AccountingSummaryBar session={baseSession()} />);
    const bar = screen.getByTestId('accounting-summary-bar');
    expect(bar.textContent).not.toMatch(/failed/i);
    expect(bar.textContent).not.toMatch(/skipped/i);
  });

  it('shows Failed and Skipped segments when their counts are nonzero', () => {
    const session = baseSession({
      selectedSymbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA'],
      plannedScanSymbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA'],
      symbolOutcomes: [
        { symbol: 'AAPL', status: 'evaluated', candidateCount: 1 },
        { symbol: 'MSFT', status: 'evaluated', candidateCount: 1 },
        { symbol: 'GOOG', status: 'failed', reasonCode: 'MARKET_DATA_REQUEST_FAILED', candidateCount: 0 },
        { symbol: 'TSLA', status: 'skipped', reasonCode: 'EXCLUDED_BY_SCAN_SCOPE', candidateCount: 0 },
      ],
    });
    render(<AccountingSummaryBar session={session} />);
    const bar = screen.getByTestId('accounting-summary-bar');
    expect(bar).toHaveTextContent('1 failed');
    expect(bar).toHaveTextContent('1 skipped');
  });

  it('gives every segment a tooltip (title attribute)', () => {
    render(<AccountingSummaryBar session={baseSession()} />);
    const bar = screen.getByTestId('accounting-summary-bar');
    const tooltipped = bar.querySelectorAll('[title]');
    expect(tooltipped.length).toBeGreaterThanOrEqual(6); // selected/planned/attempted/evaluated/qualified/disqualified
  });

  it('never renders qualified/disqualified as a fraction — each is its own absolute count', () => {
    render(<AccountingSummaryBar session={baseSession()} />);
    const bar = screen.getByTestId('accounting-summary-bar');
    expect(bar).toHaveTextContent('1 qualified');
    expect(bar).toHaveTextContent('1 disqualified');
    expect(bar.textContent).not.toMatch(/\d+\s+of\s+\d+/i);
  });
});
