// components/paper-trading/__tests__/PaperCloseForm.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PaperCloseForm from '../PaperCloseForm';
import type { PaperFillEvidence, PaperTradingPosition } from '@/lib/paper-trading/types';

const NOW = new Date('2026-08-01T00:00:00.000Z');

function fill(value: number): PaperFillEvidence {
  return {
    pricingSource: 'marketable',
    midValue: value,
    marketableValue: value,
    simulatedFillValue: value,
    slippage: 0,
    quoteAgeSeconds: 5,
    staleQuoteConfirmed: false,
    manualOverride: null,
    quoteSnapshot: null,
    evaluatedAt: NOW.toISOString(),
  };
}

function makePosition(): PaperTradingPosition {
  return {
    positionId: 'pos-1',
    idempotencyKey: 'k',
    userId: 'u1',
    symbol: 'SPY',
    strategy: 'CSP',
    legs: [{ legId: 'p', optionType: 'put', strike: 400, expiration: '2026-08-21', openAction: 'sell_to_open' }],
    expiration: '2026-08-21',
    quantity: 1,
    contractMultiplier: 100,
    entryTimestamp: NOW.toISOString(),
    entryFill: fill(300),
    entryCredit: 300,
    capitalReserved: 40000,
    theoreticalMaxLoss: 39700,
    entryRationale: null,
    status: 'open',
    currentMark: null,
    unrealizedPnl: null,
    closeTimestamp: null,
    closeFill: null,
    realizedPnl: null,
    auditRefs: [],
  };
}

describe('PaperCloseForm', () => {
  it('presents this as a full close only, with Close/Cancel confirmation controls', () => {
    render(<PaperCloseForm position={makePosition()} onClosed={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/full close only/i)).toBeInTheDocument();
    expect(screen.getByText('Close Paper Position')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows a stale-quote warning and confirmation checkbox when the observed-at time is old', async () => {
    render(<PaperCloseForm position={makePosition()} onClosed={vi.fn()} onCancel={vi.fn()} />);
    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // datetime-local is local wall-clock time -- format from local getters
    // (see PaperCloseForm.tsx's formatLocalDateTime doc comment), not
    // toISOString(), or this is off by the local UTC offset outside of UTC.
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const oldTime = `${twentyMinAgo.getFullYear()}-${pad(twentyMinAgo.getMonth() + 1)}-${pad(twentyMinAgo.getDate())}T${pad(twentyMinAgo.getHours())}:${pad(twentyMinAgo.getMinutes())}`;
    fireEvent.change(dateInput, { target: { value: oldTime } });

    expect(await screen.findByText(/Stale quote/i, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/Confirm use of stale quote/i)).toBeInTheDocument();
  });

  it('shows a manual override warning/section when Manual Paper Fill override is toggled', () => {
    render(<PaperCloseForm position={makePosition()} onClosed={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Manual Paper Fill override/i));
    expect(screen.getByPlaceholderText('Manual close price')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Reason')).toBeInTheDocument();
  });

  it('cancel calls onCancel without calling fetch', () => {
    const onCancel = vi.fn();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(<PaperCloseForm position={makePosition()} onClosed={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
