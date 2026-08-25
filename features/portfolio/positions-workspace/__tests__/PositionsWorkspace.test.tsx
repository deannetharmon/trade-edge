import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@/lib/theme';
import type { Position } from '@/lib/portfolio-data/types';
import type { PositionsWorkspaceModel } from '../model/types';
import { PositionsWorkspace } from '../PositionsWorkspace';

const position = {
  key: 'AAPL-1', symbol: 'AAPL', strategy: 'CSP', quantity: 1, expDate: '2026-09-25', dte: 32,
  entryDate: '2026-08-20', stockPrice: 200, buffer: 12.9, legs: [], maxRisk: 1000,
  maxRiskReliable: true, entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 935,
  creditReceived: 935, closeValue: 900, currentValue: 910, closeNowPnl: 35, pnl: 25,
  profitTarget: 50, snapshotHistory: [], netDelta: -0.22, theta: 0.24, gamma: -0.006,
  netVega: -0.2, iv: 46, ivr: 63, hasGtc: true, stopLossClassification: 'NO_STOP',
  structureAmbiguous: false,
} as unknown as Position;
const aggregate = (value: number | null, basis: 'mark-mid' | 'marketable-close' = 'mark-mid') => ({ value, completeness: 'complete' as const, includedCount: 1, expectedCount: 1, excludedInstrumentKeys: [], reasons: [], basis, asOf: '2026-08-23T12:00:00Z' });

const model: PositionsWorkspaceModel = {
  snapshotAsOf: '2026-08-23T12:00:00Z', quoteAsOf: null,
  dataQuality: { status: 'ok', staleQuotes: false, warnings: [] },
  symbolGroups: [{
    symbol: 'AAPL', underlyingPrice: 200, equityMarketValue: 47000, optionMarketValue: -900,
    symbolUnrealizedPnl: 8240, equities: [], options: [position], instrumentCount: 1,
    strategies: ['CSP'], needsAttention: false, contextualAction: null,
    capacity: { status: 'ok', sharesOwned: 100, allocatedContracts: 0, reservedContracts: 0, availableContracts: 1, remainderShares: 0, basisComplete: true, blockingReason: null, unallocatedShares: 100 },
    composition: 'short-option-only', compositionLabel: 'Short put',
    equityMarketValueAggregate: { ...aggregate(null), completeness: 'not-applicable', includedCount: 0, expectedCount: 0, basis: null },
    longOptionValueMid: { ...aggregate(null), completeness: 'not-applicable', includedCount: 0, expectedCount: 0, basis: null },
    optionBuybackMid: aggregate(910), optionMarketableClose: aggregate(900, 'marketable-close'),
    unrealizedPnlMid: aggregate(28), optionCloseNowPnl: aggregate(35, 'marketable-close'),
    unrealizedPnlPct: 3, unrealizedPnlPctReason: null,
    optionInstruments: [{ key: position.key, position, role: 'short-put', roleLabel: 'Short put', midpointLabel: 'Buyback obligation (mid)', marketableLabel: 'Marketable buyback cost' }],
  }],
  analysisRows: [{ id: position.key, position, symbol: position.symbol, strategy: position.strategy, needsAttention: false }],
};

describe('PositionsWorkspace', () => {
  beforeEach(() => window.localStorage.clear());

  it('switches between the accessible portfolio and analysis tabs', async () => {
    const user = userEvent.setup();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    expect(screen.getByRole('tab', { name: 'Portfolio' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /AAPL position details/i })).toBeInTheDocument();
    expect(screen.getByText('No equity holding')).toBeInTheDocument();
    expect(screen.getAllByText(/Buyback obligation \(mid\)/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Average basis unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coverage relationship unresolved/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(screen.getByRole('tab', { name: 'Position Analysis' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
  });

  it('applies filters only after Apply and exposes the active count', async () => {
    const user = userEvent.setup();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter positions' });
    await user.type(within(dialog).getByLabelText('Symbol'), 'MSFT');
    expect(screen.getByText('1 of 1 positions')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Filter 1' })).toBeInTheDocument();
    expect(screen.getByText('0 of 1 positions')).toBeInTheDocument();
  });

  it('renders all thirteen headers in Full Detail without What Moved', async () => {
    const user = userEvent.setup();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.selectOptions(screen.getByLabelText('View'), 'full');
    expect(screen.getAllByRole('columnheader')).toHaveLength(13);
    expect(screen.queryByRole('columnheader', { name: 'What Moved' })).not.toBeInTheDocument();
  });

  it('exposes Cut Losses and routes it through the existing review flow', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(<PositionsWorkspace model={model} th={THEMES.dark} getManagementActions={() => ['CUT_LOSSES']} onExecute={onExecute} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.click(screen.getByRole('button', { name: 'Cut Losses' }));
    expect(onExecute).toHaveBeenCalledWith(position, 'CUT_LOSSES');
  });

  it('keeps Close Position and Roll Position as separate explicit choices', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(<PositionsWorkspace model={model} th={THEMES.dark} getManagementActions={() => ['CLOSE_ROLL']} onExecute={onExecute} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.click(screen.getByRole('button', { name: 'Close Position' }));
    expect(onExecute).toHaveBeenLastCalledWith(position, 'CLOSE_ROLL', 'close');
    await user.click(screen.getByRole('button', { name: 'Roll Position' }));
    expect(onExecute).toHaveBeenLastCalledWith(position, 'CLOSE_ROLL', 'roll');
  });

  it('explains the displayed management recommendation with its matching reason', async () => {
    const user = userEvent.setup();
    const recommendedPosition = {
      ...position,
      recommendation: {
        label: 'Cut Losses',
        primaryReason: 'Upcoming earnings',
        managementIntent: { reasons: ['Loss threshold breached'] },
      },
    } as Position;
    const recommendationModel = {
      ...model,
      analysisRows: [{ id: recommendedPosition.key, position: recommendedPosition, symbol: recommendedPosition.symbol, strategy: recommendedPosition.strategy, needsAttention: true }],
    } as PositionsWorkspaceModel;
    render(<PositionsWorkspace model={recommendationModel} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(screen.getByText('Cut Losses')).toBeInTheDocument();
    expect(screen.getByText('Loss threshold breached')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming earnings')).not.toBeInTheDocument();
  });
});
