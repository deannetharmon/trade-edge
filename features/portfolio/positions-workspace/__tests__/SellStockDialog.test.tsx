// features/portfolio/positions-workspace/__tests__/SellStockDialog.test.tsx
//
// STOCKS-ORDERS-0001 dialog, per the mock approved 2026-09-22.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { SellStockDialog } from '../SellStockDialog';
import type { StockHoldingRow } from '../model/stockHoldings';
import type { SnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';

const row: StockHoldingRow = {
  key: 'equity:MRVL:long', accountNumber: 'ACCT-1', symbol: 'MRVL', direction: 'Long', shares: 300, sharesNote: null,
  price: 74.5, value: 22350, avgCost: 60, costBasis: 18000, basisComplete: true, pnl: 4350, pnlPct: 24.2,
  covered: { kind: 'available', headline: '', detail: null, tone: 'good' }, quoteAsOf: null, stale: false,
  sellable: { maxSellableShares: 200, sharesOwned: 300, sharesCommitted: 100, blockedByDataQuality: false, reason: null },
};

const report = (over: Partial<SnapshotCapacityReport['bySymbol']['MRVL']> = {}): SnapshotCapacityReport => ({
  status: 'ok',
  bySymbol: { MRVL: { sharesOwned: 300, costBasis: null, costBasisComplete: true, grossCoveredContracts: 3, existingShortCallContracts: 1, workingShortCallContracts: 0, availableCoveredContracts: 2, oversubscribed: false, hasUnclassifiedExposure: false, ...over } },
  warnings: [],
});

describe('SellStockDialog', () => {
  it('shows a loading state, then refetches capacity fresh before showing any number', async () => {
    const onRefreshCapacity = vi.fn().mockResolvedValue(report());
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity, onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking/i);
    await waitFor(() => expect(screen.getByText(/All available \(200 shares\)/)).toBeInTheDocument());
    expect(onRefreshCapacity).toHaveBeenCalledWith('ACCT-1');
  });

  it('"All" is explicitly the fresh maxSellableShares, never sharesOwned, shown as a real number', async () => {
    const onRefreshCapacity = vi.fn().mockResolvedValue(report());
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity, onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('All available (200 shares)')).toBeInTheDocument());
    expect(screen.queryByText('All available (300 shares)')).not.toBeInTheDocument();
  });

  it('shows the commitment line when partially committed', async () => {
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('100 of 300 shares are committed to an open call; 200 are available to sell.')).toBeInTheDocument());
  });

  it('shows the data-quality banner, distinct wording, when capacity is unavailable', async () => {
    const onRefreshCapacity = vi.fn().mockResolvedValue({ status: 'unavailable', bySymbol: {}, warnings: [], unavailableReason: 'stale' } as SnapshotCapacityReport);
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity, onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Share commitment could not be verified. Selling is blocked until it can be.'));
    expect(screen.queryByText(/are committed to an open call/)).not.toBeInTheDocument();
  });

  it('Part caps the quantity input at the fresh maxSellableShares', async () => {
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Part')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Part'));
    expect(screen.getByLabelText('Shares to sell')).toHaveAttribute('max', '200');
  });

  it('the Confirm step shows the full-close warning only when selling everything available', async () => {
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'REVIEW ORDER' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'REVIEW ORDER' }));
    expect(screen.getByText('This closes your entire available MRVL position.')).toBeInTheDocument();
  });

  it('the full-close warning does NOT show when selling Part of a larger sellable amount', async () => {
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder: vi.fn() }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Part')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Part'));
    await userEvent.type(screen.getByLabelText('Shares to sell'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'REVIEW ORDER' }));
    expect(screen.queryByText(/closes your entire/)).not.toBeInTheDocument();
  });

  it('re-refetches capacity a second time immediately before submit, and never calls onSubmitOrder if that fresh check fails', async () => {
    const onRefreshCapacity = vi.fn()
      .mockResolvedValueOnce(report()) // on open: 200 sellable
      .mockResolvedValueOnce(report({ existingShortCallContracts: 3 })); // at submit: capital used up elsewhere, now 0 sellable
    const onSubmitOrder = vi.fn();
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity, onSubmitOrder }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'REVIEW ORDER' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'REVIEW ORDER' }));
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM SELL' }));

    await waitFor(() => expect(onRefreshCapacity).toHaveBeenCalledTimes(2));
    expect(onSubmitOrder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('submits and shows the broker order id on success', async () => {
    const onSubmitOrder = vi.fn().mockResolvedValue({ orderId: 'ord-789' });
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'REVIEW ORDER' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'REVIEW ORDER' }));
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM SELL' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ord-789'));
    expect(onSubmitOrder).toHaveBeenCalledWith(expect.objectContaining({ legs: [expect.objectContaining({ quantity: 200, action: 'Sell to Close' })] }), 'ACCT-1');
  });

  it('closes without submitting anything', async () => {
    const onSubmitOrder = vi.fn();
    const onClose = vi.fn();
    render(<SellStockDialog row={row} deps={{ onRefreshCapacity: vi.fn().mockResolvedValue(report()), onSubmitOrder }} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmitOrder).not.toHaveBeenCalled();
  });
});
