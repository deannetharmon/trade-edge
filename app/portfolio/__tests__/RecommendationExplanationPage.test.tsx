import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioModeProvider } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioDataProvider } from '@/components/portfolio-data/PortfolioDataProvider';
import PortfolioPage from '../page';

const mocks = vi.hoisted(() => ({ loadPositions: vi.fn() }));
let positionFixture: any;

vi.mock('@/lib/portfolio-data/acquisition', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio-data/acquisition')>('@/lib/portfolio-data/acquisition');
  return {
    ...actual,
    loadPositions: mocks.loadPositions,
    loadAccountBalances: vi.fn().mockResolvedValue(null),
    fetchSnapshotStore: vi.fn().mockResolvedValue({}),
    attachSnapshotHistory: (positions: unknown[]) => positions,
  };
});

describe('PM-0002 Recommendation Explanation page boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadPositions.mockResolvedValue({
      pendingOrders: [],
      positions: [positionFixture = {
        key: 'MU::2026-09-04', symbol: 'MU', expDate: '2026-09-04', dte: 24, strategy: 'BPS', quantity: 5,
        legs: [
          { symbol: 'MU260904P00800000', optionType: 'P', strikePrice: 800, direction: 'Short', quantity: 5, avgOpenPrice: 4, currentPrice: 5 },
          { symbol: 'MU260904P00790000', optionType: 'P', strikePrice: 790, direction: 'Long', quantity: 5, avgOpenPrice: 1.48, currentPrice: 1.8 },
        ],
        identity: { positionKey: 'MU::2026-09-04', quantity: 5, signedEntryAmount: 1260, entryPriceEffect: 'Credit', legs: [] },
        structureAmbiguous: false, structureBlockMessage: null, entryPriceEffect: 'Credit', entryCredit: 1260,
        entryEconomicsComplete: true, creditReceived: 0, currentValue: 1600, closeValue: 3650, closeNowPnl: -2390,
        pnl: -340, pnlPct: -26.98, pnlReliable: true, intent: 'income', plOpen: -340, targetPrice: 630,
        profitTarget: .5, maxRisk: 3740, maxRiskReliable: true, hitTarget: false, needsClose: false,
        entryDte: 30, entryDate: '2026-08-05', accountNumber: 'acct', ivr: 39, iv: 66, hv30: 40, beta: 1,
        netDelta: .12, netVega: -.15, pop: 65, hasGtc: true, gtcOrderId: '1', gtcOrderPrice: 6.3,
        stopLossStatus: 'none', stopLossPrice: null, stopLossPolicy: null, stopLossDisplayPolicy: null,
        stopLossClassification: 'NO_STOP', stopLossOrderStatus: null, quoteWidthEvidence: null,
        quoteCapturedAt: '2026-08-10T22:00:00.000Z', stockPrice: 861.63, buffer: 7.2, putBufferPct: 7.2,
        callBufferPct: null, theta: .23, gamma: 0, earningsDate: null,
        recommendation: { kind: 'verify-pricing', label: 'Verify Pricing', urgency: 'HIGH', confidence: 70,
          primaryReason: 'Current broker leg quotes are stale.', supportingReasons: ['Refresh broker leg quotes.'],
          computedAt: '2026-08-10T22:00:00.000Z' },
      }],
    });
  });

  it('renders canonical explanation without making an AI request', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network disabled'));
    vi.stubGlobal('fetch', fetchSpy);
    render(<PortfolioModeProvider><PortfolioDataProvider><PortfolioPage /></PortfolioDataProvider></PortfolioModeProvider>);
    const button = await screen.findByRole('button', { name: /Explain Recommendation/i });
    expect(screen.getByText('$1260.00')).toBeInTheDocument();
    expect(screen.getByText('(-27.0%)')).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Current broker leg quotes are stale/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/analyze'))).toBe(false);
    expect(screen.queryByText(/Analyzing position with AI/i)).not.toBeInTheDocument();
  });

  it('keeps debit Close/Roll available but hides credit-derived target, stop and loss actions', async () => {
    positionFixture.entryPriceEffect = 'Debit';
    positionFixture.entryCredit = 500;
    positionFixture.creditReceived = 0;
    positionFixture.pnl = -100;
    positionFixture.pnlPct = null;
    positionFixture.hasGtc = false;
    positionFixture.recommendation = { ...positionFixture.recommendation, kind: 'watch', label: 'Manage' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    render(<PortfolioModeProvider><PortfolioDataProvider><PortfolioPage /></PortfolioDataProvider></PortfolioModeProvider>);
    expect(await screen.findByRole('button', { name: /Close\/Roll/i })).toBeInTheDocument();
    expect(screen.getByText('Debit (unsupported)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take Profit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place GTC/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cut Losses/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set Stop/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/50% unlikely|~by/i)).not.toBeInTheDocument();
  });
});
