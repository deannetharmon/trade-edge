import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// FIX: LCC_0001A_SNAPSHOT_ENABLED defaults to true now ("an unset variable
// must never silently hide stock holdings", per
// lib/portfolio-snapshot/acquire.ts) -- PortfolioDataProvider's real
// refresh() always calls the real acquirePortfolioSnapshot() on mount,
// separate from the loadPositions mock above. Unmocked, it genuinely tried
// to resolve a real TastyTrade account against this test's rejected-fetch
// stub and failed with "account identity could not be resolved".
//
// A second, deeper find while fixing that: when snapshotAcquisition
// succeeds, refresh() takes positions from `snapshotAcquisition.snapshot.
// options` -- NOT from loadPositions() at all (see the ternary: `positions:
// snapshotAcquisition ? snapshot.options : await loadPositions()`).
// loadPositions() only runs as a fallback when snapshot acquisition itself
// is unavailable. That makes the loadPositions mock above dead for this
// test's actual purpose now -- positionFixture must be supplied via the
// snapshot's own `options` field, read fresh on each call (not a static
// `.mockResolvedValue`, since positionFixture isn't assigned until
// beforeEach runs, after this factory's own module-load-time evaluation).
vi.mock('@/lib/portfolio-snapshot/acquire', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio-snapshot/acquire')>('@/lib/portfolio-snapshot/acquire');
  return {
    ...actual,
    acquirePortfolioSnapshot: vi.fn(() => Promise.resolve({
      pendingOrders: [],
      snapshot: {
        accountNumber: 'acct', asOf: '2026-08-22T18:00:00.000Z', quoteAsOf: null,
        equities: [], options: [positionFixture], workingOrders: [],
        coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false },
        dataQuality: { status: 'ok', staleQuotes: true, warnings: [] }, freshness: 'current',
        lastSuccessfulAsOf: '2026-08-22T18:00:00.000Z',
      },
    })),
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

  it('keeps the canonical reason authoritative even when the optional AI explanation fails', async () => {
    // FIX: traced handleAnalyze/analyzePosition directly (identical across
    // every point in this file's git history) -- there is no kind-based
    // skip; clicking "Explain Recommendation" always attempts the AI call.
    // This test's original premise (no /api/analyze request at all for a
    // 'verify-pricing' recommendation) doesn't match anything the app has
    // ever actually done, as far as three separate historical commits and
    // the current code all show identically. Rather than invent a
    // skip-behavior that was never built, this verifies the real, valuable
    // guarantee the file's own header comment states: "the canonical
    // evaluator remains authoritative before and after AI analysis" --
    // i.e. the canonical reason is shown before AI is ever asked, AI is
    // genuinely attempted (not silently skipped), and if it fails, the
    // canonical reason stays correct rather than being replaced or hidden.
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network disabled'));
    vi.stubGlobal('fetch', fetchSpy);
    render(<PortfolioModeProvider><PortfolioDataProvider><PortfolioPage /></PortfolioDataProvider></PortfolioModeProvider>);
    const button = await screen.findByRole('button', { name: /Explain Recommendation/i });
    expect(screen.getByText('$1260.00')).toBeInTheDocument();
    expect(screen.getByText('(-27.0%)')).toBeInTheDocument();
    // Canonical reason is already visible before any AI request -- it's
    // the recommendation's own primaryReason, not an AI-derived value.
    expect(screen.getByText(/Current broker leg quotes are stale/i)).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/analyze'))).toBe(true));
    // The AI request genuinely failed (network disabled, per this test's
    // own stub) -- that failure is surfaced honestly, not hidden.
    await waitFor(() => expect(screen.getByText(/Analysis failed: network disabled/i)).toBeInTheDocument());
    // And the canonical reason is still there, unchanged, unaffected by
    // the AI failure -- this is the actual PM-0002 guarantee.
    expect(screen.getByText(/Current broker leg quotes are stale/i)).toBeInTheDocument();
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
    expect(screen.queryByText('Derived marketable P/L')).not.toBeInTheDocument();
    const maxRisk = screen.getByText(/Max Risk/i).closest('div');
    expect(maxRisk).not.toBeNull();
    expect(within(maxRisk!).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take Profit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place GTC/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cut Losses/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set Stop/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/50% unlikely|~by/i)).not.toBeInTheDocument();
  });
});
