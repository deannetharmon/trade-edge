import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@/lib/theme';
import type { Position } from '@/lib/portfolio-data/types';
import type { PositionsWorkspaceModel } from '../model/types';
import { PositionsWorkspace, profitTargetPresentation } from '../PositionsWorkspace';

const position = {
  key: 'AAPL-1', symbol: 'AAPL', strategy: 'CSP', quantity: 1, expDate: '2026-09-25', dte: 32,
  entryDate: '2026-08-20', stockPrice: 200, buffer: 12.9, legs: [], maxRisk: 1000,
  maxRiskReliable: true, entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 935,
  creditReceived: 935, closeValue: 900, currentValue: 910, closeNowPnl: 35, pnl: 25,
  profitTarget: 0.5, snapshotHistory: [], netDelta: -0.22, theta: 0.24, gamma: -0.006,
  netVega: -0.2, iv: 46, ivr: 63, hasGtc: true, stopLossClassification: 'NO_STOP',
  structureAmbiguous: false,
} as unknown as Position;
const aggregate = (value: number | null, basis: 'mark-mid' | 'marketable-close' = 'mark-mid') => ({ value, completeness: 'complete' as const, includedCount: 1, expectedCount: 1, excludedInstrumentKeys: [], reasons: [], basis, asOf: '2026-08-23T12:00:00Z' });

const model: PositionsWorkspaceModel = {
  accountNumber: 'ACC-1',
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
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notes: {} }) }));
  });

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

  it('renders all fourteen headers in Full Detail without What Moved', async () => {
    const user = userEvent.setup();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.selectOptions(screen.getByLabelText('View'), 'full');
    expect(screen.getAllByRole('columnheader')).toHaveLength(14);
    expect(screen.getByRole('columnheader', { name: 'Since Tracked' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Greeks' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'IV / IVR' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Suggested Action' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'What Moved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Trade Evolution' })).not.toBeInTheDocument();
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

  it('formats canonical credit targets and hides targets for unsupported economics', async () => {
    const user = userEvent.setup();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(screen.getByText('Target 50%')).toBeInTheDocument();
    expect(profitTargetPresentation({ entryPriceEffect: 'Credit', entryEconomicsComplete: true, profitTarget: 0.25 })).toBe('Target 25%');
    expect(profitTargetPresentation({ entryPriceEffect: 'Debit', entryEconomicsComplete: true, profitTarget: 0.5 })).toBe('Target unavailable');
    expect(profitTargetPresentation({ entryPriceEffect: 'Credit', entryEconomicsComplete: false, profitTarget: 0.5 })).toBe('Target unavailable');
    expect(profitTargetPresentation({ entryPriceEffect: 'Credit', entryEconomicsComplete: true, profitTarget: 50 })).toBe('Target unavailable');
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

  it('shows compact intentional headers, canonical breakeven, Notes before Suggested Action, and compact actions', async () => {
    const user = userEvent.setup();
    const withLeg = { ...position, legs: [{ symbol: 'put', optionType: 'P', strikePrice: 175, direction: 'Short', quantity: 1, avgOpenPrice: 9.35, currentPrice: 9.1 }] } as Position;
    const next = { ...model, analysisRows: [{ id: withLeg.key, position: withLeg, symbol: withLeg.symbol, strategy: withLeg.strategy, needsAttention: false }] };
    render(<PositionsWorkspace model={next} th={THEMES.dark} getManagementActions={() => ['TAKE_PROFIT']} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(screen.getByRole('columnheader', { name: 'Strike Gap' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Dates' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Strike / BE' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Capital' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Entry Credit / Debit' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Close Value' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'P/L / Target' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Orders / Stop' })).toBeInTheDocument();
    expect(screen.getByText('BE 165.65')).toBeInTheDocument();
    const chartButton = screen.getByRole('button', { name: 'Quick chart for AAPL' });
    const strikeGapCellText = chartButton.closest('td')?.textContent ?? '';
    expect(strikeGapCellText.indexOf('12.5% OTM')).toBeLessThan(strikeGapCellText.indexOf('chart'));
    const headers = screen.getAllByRole('columnheader').map(header => header.textContent);
    expect(headers.indexOf('Notes')).toBeLessThan(headers.indexOf('Suggested Action'));
    expect(screen.getByRole('button', { name: 'Take Profit Now' })).toHaveClass('min-h-8');
  });

  it('lazy-loads one underlying chart at a time and links to TradingView', async () => {
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input).startsWith('/api/chart')) return { ok: true, json: async () => ({ bars: [{ c: 100 }, { c: 102 }] }) } as Response;
      return { ok: true, json: async () => ({ notes: {} }) } as Response;
    });
    const user = userEvent.setup();
    const second = { ...position, key: 'MSFT-2', symbol: 'MSFT' } as Position;
    const next = { ...model, analysisRows: [model.analysisRows[0], { id: second.key, position: second, symbol: second.symbol, strategy: second.strategy, needsAttention: false }] };
    render(<PositionsWorkspace model={next} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith('/api/chart'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Quick chart for AAPL' }));
    expect(await screen.findByRole('dialog', { name: 'Quick chart for AAPL' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open AAPL in TradingView, opens in new tab' })).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=AAPL');
    await waitFor(() => expect(screen.getByText(/\+2.0% 30d/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Quick chart for MSFT' }));
    expect(await screen.findByRole('dialog', { name: 'Quick chart for MSFT' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Quick chart for AAPL' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Quick chart for MSFT' })).not.toBeInTheDocument();
  });

  it('reuses the supplied analysis path with the clicked canonical identity and clears stale analysis', async () => {
    const user = userEvent.setup();
    const second = { ...position, key: 'MSFT-2', symbol: 'MSFT' } as Position;
    const onAnalyze = vi.fn(async (selected: Position) => ({ positionKey: selected.key, symbol: selected.symbol, recommendation: 'HOLD', confidence: 'HIGH', summary: `Summary ${selected.symbol}`, reasoning: 'Canonical evidence', risks: [], catalysts: [], generatedAt: '2026-08-25T00:00:00Z' }));
    const next = { ...model, analysisRows: [model.analysisRows[0], { id: second.key, position: second, symbol: second.symbol, strategy: second.strategy, needsAttention: false }] };
    render(<PositionsWorkspace model={next} th={THEMES.dark} onAnalyze={onAnalyze} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    const buttons = screen.getAllByRole('button', { name: 'Analyze with AI' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    expect(await screen.findByText('Summary MSFT')).toBeInTheDocument();
    expect(onAnalyze).toHaveBeenCalledWith(second, '');
    expect(screen.getByText(/No brokerage order is prepared or submitted/)).toBeInTheDocument();
  });

  it('locks follow-ups to the analyzed position snapshot and exposes the retained context', async () => {
    const user = userEvent.setup();
    const generatedAt = '2026-08-25T14:30:00Z';
    const analysis = { positionKey: position.key, symbol: position.symbol, recommendation: 'HOLD', confidence: 'HIGH', summary: 'Position summary', reasoning: 'Canonical evidence', risks: [], catalysts: [], generatedAt };
    const onAnalyze = vi.fn(async () => analysis);
    const renderAnalysisConversation = vi.fn((selected: Position) => <label>Follow-up for {selected.symbol}<textarea aria-label={`Ask a follow-up about ${selected.symbol}`} /></label>);
    render(<PositionsWorkspace model={model} th={THEMES.dark} onAnalyze={onAnalyze} renderAnalysisConversation={renderAnalysisConversation} />);

    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    await user.click(screen.getByRole('button', { name: 'Analyze with AI' }));

    expect(await screen.findByRole('textbox', { name: 'Ask a follow-up about AAPL' })).toBeInTheDocument();
    await user.click(screen.getByText('Position context locked for this conversation'));
    expect(screen.getByText(`Position ID: ${position.key}`)).toBeInTheDocument();
    expect(screen.getByText(/Follow-ups retain this snapshot and conversation history/)).toBeInTheDocument();
    expect(renderAnalysisConversation).toHaveBeenCalledWith(position, analysis);
  });

  it('shows portfolio-first income eligibility and keeps its review explicitly non-actionable', async () => {
    const user = userEvent.setup();
    const next = {
      ...model,
      incomeOpportunities: [{
        id: 'pmcc:AAPL-1', kind: 'pmcc-short-call', status: 'eligible', symbol: 'AAPL', positionKey: 'AAPL-1', title: 'PMCC short call',
        reason: 'Exact held long-call identity is verified. Short-call timing has not yet been evaluated.', freshness: 'Current broker evidence', exactContract: 'AAPL  270618C00150000',
        sharesOwned: null, allocatedContracts: null, reservedContracts: null, availableContracts: null,
      }, {
        id: 'covered-call:AAPL', kind: 'covered-call', status: 'no-capacity', symbol: 'AAPL', positionKey: null, title: 'Covered call',
        reason: 'Fully covered / no available capacity after existing and working short calls.', freshness: 'Current broker evidence', exactContract: null,
        sharesOwned: 100, allocatedContracts: 1, reservedContracts: 0, availableContracts: 0,
      }],
    } as PositionsWorkspaceModel;
    render(<PositionsWorkspace model={next} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(screen.getByRole('region', { name: 'Existing-position income eligibility' })).toBeInTheDocument();
    expect(screen.getByText('Fully covered / no available capacity')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('status')).toHaveTextContent('no recommendation, ticket, or order has been created');
  });

  it('saves notes on Enter, accepts up to 150 characters, and restores saved notes after remount', async () => {
    const store: Record<string, string> = {};
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        store[`${encodeURIComponent(body.accountNumber)}::${encodeURIComponent(body.positionKey)}`] = body.note;
        return { ok: true, json: async () => ({ ok: true, note: body.note }) } as Response;
      }
      return { ok: true, json: async () => ({ notes: store }) } as Response;
    });
    const user = userEvent.setup();
    const first = render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    const input = screen.getByRole('textbox', { name: /Note for AAPL CSP position/ });
    const note = 'a'.repeat(150);
    await user.type(input, `${note}Z{enter}`);
    expect(input).toHaveValue(note);
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
    first.unmount();
    render(<PositionsWorkspace model={model} th={THEMES.dark} />);
    await user.click(screen.getByRole('tab', { name: 'Position Analysis' }));
    expect(await screen.findByDisplayValue(note)).toBeInTheDocument();
  });
});
