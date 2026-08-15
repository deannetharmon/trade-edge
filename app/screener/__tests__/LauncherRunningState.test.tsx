// app/screener/__tests__/LauncherRunningState.test.tsx
//
// SCREENER-LAUNCHER-0001 corrective pass — production defect: every
// launcher rendered its label from the page-wide `loading` Boolean
// (`loading ? 'SCANNING...' : label`), so all four buttons showed
// "SCANNING..." whenever ANY one scan was running. This proves the fix:
// `runningLauncher` (app/screener/page.tsx) identifies only the ONE
// launcher whose own scan invocation is actually in flight, derived
// read-only from the canonical session (`activeSession?.status ===
// 'running'`) rather than a new independent flag -- so it inherits the
// session model's existing stale-session/supersession guarantees for free.
//
// Also covers the visual correction: selected AND running now share one
// strategy-independent white-background/black-text treatment (no more
// strategy-colored solid fills, no persistent ring, no checkmark).
//
// Same mocking convention as LauncherSelectedState.test.tsx /
// ScreenerSessionWiring.test.tsx: only the network boundary is mocked, the
// real page.tsx component and real session model run unmodified.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

const getAccessTokenMock = vi.fn();
const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getQuoteMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: (...args: any[]) => getAccessTokenMock(...args),
    getCoveredCallCapacityReport: (...args: any[]) => getCoveredCallCapacityReportMock(...(args as [])),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: (...args: any[]) => getQuoteMock(...args),
    getChain: (...args: any[]) => getChainMock(...args),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(10000),
    getCspCapitalContext: vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 10000, cashBalance: 10000 }),
  };
});

function renderScreener() {
  return render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
}

async function addToUniverse(symbols: string) {
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, symbols);
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
}

const qualifyingChain = (symbol: string, optionType: 'C' | 'P' = 'C') => {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  const expDate = d.toISOString().slice(0, 10);
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        {
          strikePrice: optionType === 'C' ? 110 : 90, expirationDate: expDate, optionType, delta: optionType === 'C' ? 0.28 : -0.2,
          openInterest: optionType === 'C' ? 150 : 500, bid: 1.2, ask: 1.28, mid: 1.24, occSymbol: `${symbol}_TEST_${optionType}`,
        },
      ],
    },
    isEtfOrIndex: false,
    classification: 'stock' as const,
  };
};

const holding = (overrides: Partial<CoveredCallCapacityReport['bySymbol'][string]> = {}) => ({
  sharesOwned: 100, costBasis: 50, costBasisComplete: true,
  grossCoveredContracts: 1, existingShortCallContracts: 0, workingShortCallContracts: 0,
  availableCoveredContracts: 1, oversubscribed: false, hasUnclassifiedExposure: false,
  ...overrides,
});

function launcherButtons() {
  return {
    spreads: screen.getByRole('button', { name: 'FIND SPREADS' }),
    csp: screen.getByRole('button', { name: 'FIND CSPs' }),
    cc: screen.getByRole('button', { name: 'FIND CCs' }),
    pmcc: screen.getByRole('button', { name: 'FIND PMCCs' }),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getAccessTokenMock.mockReset().mockResolvedValue('fake-token');
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset().mockResolvedValue({ expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' });
  getQuoteMock.mockReset().mockResolvedValue(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SCREENER-LAUNCHER-0001 corrective: isolated running label', () => {
  it('1. with no active session, all enabled launchers are outlined and retain their normal labels', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    const { spreads, csp, cc, pmcc } = launcherButtons();
    for (const [btn, label] of [[spreads, 'FIND SPREADS'], [csp, 'FIND CSPs'], [cc, 'FIND CCs'], [pmcc, 'FIND PMCCs']] as const) {
      expect(btn).toHaveTextContent(label);
      expect(btn).not.toHaveTextContent('SCANNING');
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(btn).toHaveAttribute('aria-busy', 'false');
    }
  });

  it('2. a running CSP scan shows SCANNING... and aria-busy only on FIND CSPs while genuinely in flight, then restores on completion', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));

    renderScreener();
    // addToUniverse's own handleAdd also calls getAccessToken() (to merge the
    // new ticker) -- the deferred mock must be installed AFTER that resolves,
    // or it gets consumed by ticker-add instead of by the CSP scan.
    await addToUniverse('NKE');

    // Holds the scan open deterministically: runCspScan's very first await is
    // getAccessToken(), called immediately after beginScanSession() flips the
    // session to 'running' -- so as long as this promise is unresolved, the
    // session (and therefore runningLauncher) is provably still 'running',
    // not just "probably still running because the mock hadn't settled yet."
    let releaseToken!: (value: string) => void;
    getAccessTokenMock.mockReset().mockImplementationOnce(
      () => new Promise<string>((resolve) => { releaseToken = resolve; }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));

    // --- while the CSP scan is genuinely in flight ---
    const inFlight = launcherButtons();
    await waitFor(() => expect(inFlight.csp).toHaveTextContent('SCANNING...'));
    expect(inFlight.csp).toHaveAttribute('aria-busy', 'true');
    expect(inFlight.csp.className).toMatch(/bg-white/);
    expect(inFlight.csp.className).toMatch(/text-black/);

    expect(inFlight.spreads).toHaveTextContent('FIND SPREADS');
    expect(inFlight.cc).toHaveTextContent('FIND CCs');
    expect(inFlight.pmcc).toHaveTextContent('FIND PMCCs');
    expect(inFlight.spreads).toHaveAttribute('aria-busy', 'false');
    expect(inFlight.cc).toHaveAttribute('aria-busy', 'false');
    expect(inFlight.pmcc).toHaveAttribute('aria-busy', 'false');
    for (const btn of [inFlight.spreads, inFlight.cc, inFlight.pmcc]) {
      expect(btn).not.toHaveTextContent('SCANNING');
    }

    // --- release the held promise and let the scan complete ---
    releaseToken('fake-token');
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    const settled = launcherButtons();
    await waitFor(() => expect(settled.csp).not.toHaveTextContent('SCANNING'));
    expect(settled.csp).toHaveTextContent('FIND CSPs');
    expect(settled.csp).toHaveAttribute('aria-busy', 'false');
    expect(settled.csp).toHaveAttribute('aria-pressed', 'true');
    expect(settled.csp.className).toMatch(/bg-white/);
    expect(settled.csp.className).toMatch(/text-black/);
  });

  it('3. after completion, FIND CSPs returns to its normal label, stays aria-pressed and uses the white/black selected treatment; Spreads is outlined', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    const { csp, spreads } = launcherButtons();
    await waitFor(() => expect(csp).toHaveTextContent('FIND CSPs'));
    expect(csp).not.toHaveTextContent('SCANNING');
    expect(csp).toHaveAttribute('aria-pressed', 'true');
    expect(csp).toHaveAttribute('aria-busy', 'false');
    expect(csp.className).toMatch(/bg-white/);
    expect(csp.className).toMatch(/text-black/);
    expect(spreads).toHaveAttribute('aria-pressed', 'false');
    expect(spreads.className).not.toMatch(/bg-white/);
  });

  it('4. opening the Spread configuration modal alone never produces a scanning label or busy state', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    expect(await screen.findByRole('button', { name: /RUN/ })).toBeInTheDocument();

    const { spreads } = launcherButtons();
    expect(spreads).not.toHaveTextContent('SCANNING');
    expect(spreads).toHaveAttribute('aria-busy', 'false');
    expect(spreads).toHaveAttribute('aria-pressed', 'false');
  });

  it('5. confirming RUN SCREENER makes only FIND SPREADS complete with the selected white/black treatment; CSP/CC/PMCC stay outlined and never show SCANNING', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NVDA');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('button', { name: /RUN/ }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    const { spreads, csp, cc, pmcc } = launcherButtons();
    await waitFor(() => expect(spreads).toHaveAttribute('aria-pressed', 'true'));
    expect(spreads).not.toHaveTextContent('SCANNING');
    expect(spreads.className).toMatch(/bg-white/);
    for (const btn of [csp, cc, pmcc]) {
      expect(btn).not.toHaveTextContent('SCANNING');
      expect(btn).toHaveAttribute('aria-busy', 'false');
    }
  });

  it('6. a failed scan invocation restores the normal label and clears aria-busy', async () => {
    renderScreener();
    await addToUniverse('NKE');
    getAccessTokenMock.mockRejectedValueOnce(new Error('auth failed'));
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));

    const { csp } = launcherButtons();
    await waitFor(() => expect(csp).toHaveTextContent('FIND CSPs'));
    expect(csp).not.toHaveTextContent('SCANNING');
    expect(csp).toHaveAttribute('aria-busy', 'false');
  });

  it('7. a completed CC session and a completed PMCC session both receive the same white/black selected treatment', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    const { cc } = launcherButtons();
    await waitFor(() => expect(cc).toHaveAttribute('aria-pressed', 'true'));
    expect(cc.className).toMatch(/bg-white/);
    expect(cc.className).toMatch(/text-black/);
    // No leftover strategy-colored selected fill (the old bug this
    // corrects) survives alongside the new white treatment.
    expect(cc.className).not.toMatch(/bg-cyan-500(?!\/)/);

    getMarketMetricsMock.mockClear();
    await addToUniverse('AAPL');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN PMCC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    const { pmcc } = launcherButtons();
    await waitFor(() => expect(pmcc).toHaveAttribute('aria-pressed', 'true'));
    expect(pmcc.className).toMatch(/bg-white/);
    expect(pmcc.className).toMatch(/text-black/);
  });

  it('8. no checkmark glyph remains anywhere in the launcher DOM', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    const { csp } = launcherButtons();
    await waitFor(() => expect(csp).toHaveAttribute('aria-pressed', 'true'));
    expect(csp.textContent).not.toMatch(/✓/);
    expect(csp.querySelector('span')).toBeNull();
  });

  it('9. FIND LEAPS remains disabled and unchanged by this pass', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    const leaps = await screen.findByRole('button', { name: /FIND LEAPS/i });
    expect(leaps).toBeDisabled();
    expect(leaps).toHaveTextContent('FIND LEAPS — COMING SOON');
    expect(leaps).not.toHaveAttribute('aria-pressed');
    expect(leaps).not.toHaveAttribute('aria-busy');
  });

  it('10. existing click handlers and disabled conditions remain intact', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    renderScreener();
    // Empty universe: Spreads/CSP/PMCC stay disabled; Covered Call remains
    // enabled (it scans verified owned shares, not the universe) -- same
    // restriction as before this pass.
    expect(await screen.findByRole('button', { name: 'FIND SPREADS' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND CSPs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND CCs' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getCoveredCallCapacityReportMock).toHaveBeenCalled());
  });
});
