// components/paper-trading/__tests__/PaperAccountSummary.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaperAccountSummary from '../PaperAccountSummary';
import { createInitialLedger, deriveLedgerView } from '@/lib/paper-trading/ledger';

describe('PaperAccountSummary', () => {
  it('renders a PAPER badge', () => {
    const view = deriveLedgerView(createInitialLedger('u1', 100000, new Date('2026-08-01')));
    render(<PaperAccountSummary view={view} />);
    expect(screen.getByText('PAPER')).toBeInTheDocument();
  });

  it('renders starting balance, cash, and current equity from the view it is given (no fetching of its own)', () => {
    const view = deriveLedgerView(createInitialLedger('u1', 75000, new Date('2026-08-01')));
    render(<PaperAccountSummary view={view} />);
    // A fresh ledger has startingBalance === cash === currentEquity, so all
    // three stat cards legitimately render the same formatted figure.
    expect(screen.getAllByText('$75,000.00').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Starting Balance')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Current Equity')).toBeInTheDocument();
  });

  it('never renders any live-order or execution wording', () => {
    const view = deriveLedgerView(createInitialLedger('u1', 100000, new Date('2026-08-01')));
    const { container } = render(<PaperAccountSummary view={view} />);
    const text = container.textContent ?? '';
    for (const forbidden of ['Submit Order', 'Place Order', 'Execute Trade', 'Buy Now', 'Sell Now']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
