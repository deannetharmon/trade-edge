// features/screener/components/__tests__/SymbolOutcomesDisclosure.test.tsx
//
// SCREENER-UX-0001 required test 14: "Symbols not producing candidates" is
// a separate disclosure, grouped by Failed / Excluded from scope /
// Cancelled / Superseded / No qualifying candidate, showing the symbol and
// a human-readable reason (never leading with the raw internal enum text).

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SymbolOutcomesDisclosure, buildSymbolOutcomeGroups } from '../SymbolOutcomesDisclosure';
import type { ScreenerScanSession } from '@/lib/screener/scanSession';

function session(overrides: Partial<ScreenerScanSession> = {}): ScreenerScanSession {
  return {
    sessionId: 's1',
    mode: 'filter',
    requestedStrategy: 'spreads',
    scope: { universeSymbols: [], eligibleSymbols: [] },
    selectedSymbols: [],
    plannedScanSymbols: [],
    startedAt: 0,
    completedAt: null,
    status: 'complete',
    symbolOutcomes: [],
    results: [],
    cacheProvenance: 'live',
    cachedAt: null,
    schemaVersion: 3,
    ...overrides,
  };
}

describe('buildSymbolOutcomeGroups', () => {
  it('groups outcomes into the five required buckets', () => {
    const s = session({
      symbolOutcomes: [
        { symbol: 'AAPL', status: 'failed', reasonCode: 'MARKET_DATA_REQUEST_FAILED', candidateCount: 0 },
        { symbol: 'MSFT', status: 'skipped', reasonCode: 'EXCLUDED_BY_SCAN_SCOPE', candidateCount: 0 },
        { symbol: 'GOOG', status: 'skipped', reasonCode: 'CANCELLED', candidateCount: 0 },
        { symbol: 'TSLA', status: 'skipped', reasonCode: 'SUPERSEDED', candidateCount: 0 },
        { symbol: 'NFLX', status: 'evaluated', reasonCode: 'NO_QUALIFYING_CANDIDATE', candidateCount: 0 },
        // Should NOT appear anywhere: a real evaluated result belongs in Qualified/Disqualified only.
        { symbol: 'AMZN', status: 'evaluated', candidateCount: 1 },
      ],
    });
    const groups = buildSymbolOutcomeGroups(s);
    const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
    expect(byKey.failed.entries.map(e => e.symbol)).toEqual(['AAPL']);
    expect(byKey.excludedFromScope.entries.map(e => e.symbol)).toEqual(['MSFT']);
    expect(byKey.cancelled.entries.map(e => e.symbol)).toEqual(['GOOG']);
    expect(byKey.superseded.entries.map(e => e.symbol)).toEqual(['TSLA']);
    expect(byKey.noQualifyingCandidate.entries.map(e => e.symbol)).toEqual(['NFLX']);
    expect(groups.some(g => g.entries.some(e => e.symbol === 'AMZN'))).toBe(false);
  });

  it('uses human-readable reason labels, not raw enum text', () => {
    const s = session({ symbolOutcomes: [{ symbol: 'AAPL', status: 'failed', reasonCode: 'MARKET_DATA_REQUEST_FAILED', candidateCount: 0 }] });
    const groups = buildSymbolOutcomeGroups(s);
    expect(groups[0].entries[0].reasonLabel).toBe('Market-data request failed');
    expect(groups[0].entries[0].reasonLabel).not.toBe('MARKET_DATA_REQUEST_FAILED');
    // Raw code still preserved for diagnostics.
    expect(groups[0].entries[0].reasonCode).toBe('MARKET_DATA_REQUEST_FAILED');
  });
});

describe('SymbolOutcomesDisclosure', () => {
  it('renders nothing when there are no non-candidate-producing outcomes', () => {
    const { container } = render(<SymbolOutcomesDisclosure session={session()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed by default and expands via a keyboard-operable aria-expanded button', () => {
    const s = session({ symbolOutcomes: [{ symbol: 'AAPL', status: 'failed', reasonCode: 'MARKET_DATA_REQUEST_FAILED', candidateCount: 0 }] });
    render(<SymbolOutcomesDisclosure session={s} />);
    const toggle = screen.getByRole('button', { name: /Symbols not producing candidates \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Market-data request failed')).toBeInTheDocument();
  });

  it('announces expand/collapse state via a polite live region and restores focus on collapse', async () => {
    const s = session({ symbolOutcomes: [{ symbol: 'AAPL', status: 'failed', reasonCode: 'MARKET_DATA_REQUEST_FAILED', candidateCount: 0 }] });
    render(<SymbolOutcomesDisclosure session={s} />);
    const toggle = screen.getByRole('button', { name: /Symbols not producing candidates \(1\)/ });
    fireEvent.click(toggle); // expand
    expect(screen.getByRole('status')).toHaveTextContent('Symbols not producing candidates expanded');
    fireEvent.click(toggle); // collapse
    expect(screen.getByRole('status')).toHaveTextContent('Symbols not producing candidates collapsed');
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(toggle).toHaveFocus();
  });
});
