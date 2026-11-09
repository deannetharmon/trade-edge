// features/screener/components/__tests__/CommittedCallsLine.test.tsx
//
// CC-VISIBILITY-0001 slice 2: the one shared "which short call holds the other contract" line.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CommittedCallsLine } from '../CommittedCallsLine';
import { DisqualifiedSection } from '../DisqualifiedSection';
import type { CommittedCall } from '@/lib/portfolio-snapshot/committedCalls';
import type { ScreenResult } from '@/lib/scans/types';

const filled: CommittedCall = { status: 'filled', quantity: 1, strike: 63, expiration: '2026-12-18', premiumPerShare: 2.01, unclassified: false };
const pending: CommittedCall = { status: 'pending', quantity: 1, strike: 64, expiration: '2027-01-16', premiumPerShare: null, unclassified: false };

describe('CommittedCallsLine', () => {
  it('says how many contracts are free and which call holds the other (TQQQ: 200 sh, one $63 call)', () => {
    render(<CommittedCallsLine symbol="TQQQ" sharesOwned={200} gross={2} available={1} calls={[filled]} asOf="2026-11-09" />);
    const line = screen.getByTestId('cc-committed-TQQQ');
    expect(line).toHaveTextContent('200 sh · 1 of 2 contracts free');
    expect(line).toHaveTextContent('Short $63 call · Dec 18 · 39 DTE · filled · +$201');
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  });

  it('lists a pending order after the filled call', () => {
    render(<CommittedCallsLine symbol="TQQQ" sharesOwned={300} gross={3} available={1} calls={[filled, pending]} asOf="2026-11-09" />);
    const items = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(items[0]).toContain('Short $63 call');
    expect(items[1]).toContain('Pending · $64 call · Jan 16');
  });

  it('shows only the count when nothing is committed, and can hide the count for a card that already shows it', () => {
    const { rerender } = render(<CommittedCallsLine symbol="TQQQ" sharesOwned={200} gross={2} available={2} calls={[]} />);
    expect(screen.getByTestId('cc-committed-TQQQ')).toHaveTextContent('2 of 2 contracts free');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    rerender(<CommittedCallsLine symbol="TQQQ" sharesOwned={200} gross={2} available={1} calls={[filled]} showCount={false} asOf="2026-11-09" />);
    expect(screen.getByTestId('cc-committed-TQQQ')).not.toHaveTextContent('contracts free');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('flags a list that does not add up to the free count instead of presenting it as complete', () => {
    render(<CommittedCallsLine symbol="TQQQ" sharesOwned={200} gross={2} available={2} calls={[filled]} asOf="2026-11-09" />);
    expect(screen.getByText(/may be incomplete/)).toBeInTheDocument();
  });

  it('renders nothing for a holding too small to cover a contract', () => {
    const { container } = render(<CommittedCallsLine symbol="TQQQ" sharesOwned={50} gross={0} available={0} calls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says detail is unavailable rather than guessing, and notes an unconfirmed call type', () => {
    render(<CommittedCallsLine symbol="TQQQ" sharesOwned={200} gross={2} available={1} calls={[{ ...filled, strike: null, expiration: null, premiumPerShare: null, unclassified: true }]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Short call (detail unavailable) · filled · type unconfirmed, counted as a call');
  });
});

describe('DisqualifiedSection with committed calls', () => {
  const cc = (over: Partial<ScreenResult> = {}): ScreenResult => ({
    symbol: 'TQQQ', strategy: 'CC', price: 57.35, ivr: 50, qualified: false, bestCandidate: null, failReasons: ['No qualifying call found'],
    ccCommitted: { sharesOwned: 200, gross: 2, available: 1, calls: [filled] },
    checks: { ivr: { status: 'pass', value: '50', reason: 'ok' } } as any, ...over,
  });
  it('shows the line right under a covered-call row, and not on other strategies', () => {
    render(<DisqualifiedSection results={[cc(), cc({ symbol: 'AAPL', strategy: 'CSP' })]} hasQualifiedCandidates={false} />);
    expect(screen.getByTestId('cc-committed-TQQQ')).toBeInTheDocument();
    expect(screen.queryByTestId('cc-committed-AAPL')).not.toBeInTheDocument();
  });
});
