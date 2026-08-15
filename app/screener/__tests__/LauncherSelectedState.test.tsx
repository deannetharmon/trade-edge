// app/screener/__tests__/LauncherSelectedState.test.tsx
//
// SCREENER-LAUNCHER-0001 — required test coverage proving all four enabled
// strategy launchers (FIND SPREADS / FIND CSPs / FIND CCs /
// FIND PMCCs) share one consistent selected/unselected visual model, driven
// solely by `activeSession?.requestedStrategy` (never screenMode, hover,
// focus, or the last-clicked element), via the shared LauncherButton
// component's `aria-pressed` attribute — the canonical, color-independent
// selected-state signal.
//
// Same mocking convention as ScreenerSessionWiring.test.tsx /
// UnifiedStrategyLauncher.test.tsx: only the network boundary
// (lib/scans/tastytrade-client) is mocked, the real page.tsx component and
// the real lib/screener/scanSession.ts / scanSessionCache.ts functions run
// unmodified.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getQuoteMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
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
const emptyChain = { expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' as const };

const holding = (overrides: Partial<CoveredCallCapacityReport['bySymbol'][string]> = {}) => ({
  sharesOwned: 100,
  costBasis: 50,
  costBasisComplete: true,
  grossCoveredContracts: 1,
  existingShortCallContracts: 0,
  workingShortCallContracts: 0,
  availableCoveredContracts: 1,
  oversubscribed: false,
  hasUnclassifiedExposure: false,
  ...overrides,
});

function installFakeIndexedDb() {
  const dbData = new Map<string, Map<string, unknown>>();
  let created = false;
  const db: any = {
    objectStoreNames: { contains: (n: string) => dbData.has(n) },
    createObjectStore(name: string) { dbData.set(name, new Map()); },
    transaction(storeName: string) {
      const map = dbData.get(storeName)!;
      const tx: any = { oncomplete: null, onerror: null };
      tx.objectStore = () => ({
        get(key: string) {
          const req: any = {};
          queueMicrotask(() => { req.result = map.get(key); req.onsuccess?.(); });
          return req;
        },
        put(value: unknown, key: string) {
          map.set(key, value);
          queueMicrotask(() => { tx.oncomplete?.(); });
          return {};
        },
        delete(key: string) {
          map.delete(key);
          queueMicrotask(() => { tx.oncomplete?.(); });
          return {};
        },
      });
      return tx;
    },
    close() {},
  };
  (globalThis as any).indexedDB = {
    open() {
      const req: any = { result: db };
      queueMicrotask(() => {
        if (!created) { created = true; req.onupgradeneeded?.({ target: { result: db } }); }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function launcherButtons() {
  return {
    spreads: screen.getByRole('button', { name: 'FIND SPREADS' }),
    csp: screen.getByRole('button', { name: 'FIND CSPs' }),
    cc: screen.getByRole('button', { name: 'FIND CCs' }),
    pmcc: screen.getByRole('button', { name: 'FIND PMCCs' }),
  };
}

function expectOnlyPressed(pressedName: 'spreads' | 'csp' | 'cc' | 'pmcc' | null) {
  const { spreads, csp, cc, pmcc } = launcherButtons();
  const buttons = { spreads, csp, cc, pmcc };
  for (const [name, btn] of Object.entries(buttons)) {
    expect(btn).toHaveAttribute('aria-pressed', name === pressedName ? 'true' : 'false');
  }
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset().mockResolvedValue(emptyChain);
  getQuoteMock.mockReset().mockResolvedValue(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SCREENER-LAUNCHER-0001: launcher selected-state', () => {
  it('1. with no active session, all four enabled launchers are outlined and aria-pressed="false"', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    expectOnlyPressed(null);
  });

  it('2. a Spread session fills only FIND SPREADS, with aria-pressed="true"', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NVDA');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('button', { name: /RUN/ }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('spreads'));
  });

  it('3. a CSP session fills only FIND CSPs; FIND SPREADS is outlined', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('csp'));
  });

  it('4. a Covered Call session fills only FIND CCs', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('cc'));
  });

  it('5. a PMCC session fills only FIND PMCCs', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NVDA,AAPL');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN PMCC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('pmcc'));
  });

  it('6. a restored CSP session selects FIND CSPs, not FIND SPREADS', async () => {
    installFakeIndexedDb();
    const { createScanSession, recordSymbolEvaluated, completeSession } = await import('@/lib/screener/scanSession');
    const { persistScanSession } = await import('@/lib/screener/scanSessionCache');

    const emptyCheck = { status: 'pass' as const, value: '-', reason: '-' };
    const checks = { ivr: emptyCheck, earnings: emptyCheck, oi: emptyCheck, delta: emptyCheck, credit: emptyCheck, roc: emptyCheck, pop: emptyCheck, iv: emptyCheck, emClearance: emptyCheck };
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['NKE'], eligibleSymbols: ['NKE'] },
      ruleSnapshot: (await import('@/lib/scans/cspRuleSnapshot')).buildCspRuleSnapshot(
        (await import('@/lib/scans/constants')).DEFAULT_CSP_RULES,
      ),
    });
    // CSP-WORKFLOW-0001 core-correction pass -- a "qualified" CSP result
    // must carry a real bestCandidate with the canonical market/account/mode
    // qualification states (INVALID_CSP_QUALIFICATION now rejects a
    // qualified CSP result with no bestCandidate at cache-restore time, same
    // as production data would never produce one). Filter mode never gates
    // on mode qualification, so cspModeQualification is NOT_APPLICABLE.
    session = recordSymbolEvaluated(session, 'NKE', [{
      symbol: 'NKE', strategy: 'CSP', price: 100, ivr: 40, qualified: true,
      bestCandidate: {
        strategy: 'CSP', expiration: '2026-09-18', dte: 30,
        shortStrike: 95, longStrike: 0, shortDelta: -0.2,
        credit: 1.5, spreadWidth: 0, creditRatio: 0, roc: 5, pop: 80,
        shortOI: 500, longOI: 0,
        cspMarketQualification: 'QUALIFIED',
        cspAccountEligibility: 'ELIGIBLE',
        cspModeQualification: 'NOT_APPLICABLE',
        cspModeQualificationReasons: [],
      },
      failReasons: [], checks,
    }]);
    session = completeSession(session);
    await persistScanSession(session);

    renderScreener();
    await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);

    await waitFor(() => expectOnlyPressed('csp'));
  });

  it('7. starting a new strategy changes selection only when the canonical session changes', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    getChainMock.mockImplementation((symbol: string, optionType?: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE');

    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('csp'));

    getMarketMetricsMock.mockClear();
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    // Selection now belongs entirely to the new (CC) canonical session --
    // never both, never left on the prior CSP session.
    await waitFor(() => expectOnlyPressed('cc'));
  });

  it('8. opening the Spread configuration modal does not independently change selection', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NKE');

    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('cc'));

    // Merely opening Spreads' config modal must not fabricate a new
    // canonical session or move the selection off the still-active CC one.
    await userEvent.click(screen.getByRole('button', { name: 'FIND SPREADS' }));
    const runButton = await screen.findByRole('button', { name: /RUN/ });
    expect(runButton).toBeInTheDocument();
    expectOnlyPressed('cc');

    // Closing the modal without running a scan: still unchanged. Scope the
    // close click to the modal itself (via its dialog role) -- the page has
    // other unrelated close buttons elsewhere.
    const modal = screen.getByRole('dialog', { name: /SCAN SELECTED/ });
    await userEvent.click(within(modal).getByRole('button', { name: /close scan configuration/i }));
    await waitFor(() => expect(screen.queryByText(/SCAN SELECTED/)).not.toBeInTheDocument());
    expectOnlyPressed('cc');
  });

  it('13. a completed PMCC session survives opening and cancelling an unrelated CC modal', async () => {
    // Closes the one gap not already covered by test 8 (which checks
    // *selection state* survives an unrelated modal open/cancel) -- this
    // checks the actual *result content* survives too, not just which
    // launcher button is highlighted.
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NVDA');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN PMCC SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expectOnlyPressed('pmcc'));
    const resultCountBefore = screen.getAllByText(/NVDA/i).length;

    await userEvent.click(screen.getByRole('button', { name: 'FIND CCs' }));
    const ccModal = await screen.findByRole('dialog', { name: /COVERED CALL SCAN/i });
    await userEvent.click(within(ccModal).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /COVERED CALL SCAN/i })).not.toBeInTheDocument());

    expectOnlyPressed('pmcc');
    expect(screen.getAllByText(/NVDA/i).length).toBe(resultCountBefore);
  });

  it('9. exactly one enabled launcher can be selected at a time', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    await waitFor(() => {
      const { spreads, csp, cc, pmcc } = launcherButtons();
      const pressedCount = [spreads, csp, cc, pmcc].filter(b => b.getAttribute('aria-pressed') === 'true').length;
      expect(pressedCount).toBe(1);
    });
  });

  it('10. FIND LEAPS — COMING SOON remains disabled and does not use an active pressed state', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    const findLeaps = await screen.findByRole('button', { name: /FIND LEAPS/i });
    expect(findLeaps).toBeDisabled();
    expect(findLeaps).not.toHaveAttribute('aria-pressed', 'true');
  });

  it('11. existing scanner launch handlers and Covered Call restrictions remain unchanged', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol: { NKE: holding() }, warnings: [] });
    renderScreener();
    // Empty universe: Spreads/CSP/PMCC stay disabled (unchanged restriction),
    // but Covered Call remains enabled since it operates on verified owned
    // shares, not the Opportunity Universe.
    expect(await screen.findByRole('button', { name: 'FIND SPREADS' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND CSPs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND CCs' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getCoveredCallCapacityReportMock).toHaveBeenCalled());
  });

  it('12. keyboard focus remains available on every enabled launcher', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NVDA');
    const { spreads, csp, cc, pmcc } = launcherButtons();
    for (const btn of [spreads, csp, cc, pmcc]) {
      btn.focus();
      expect(btn).toHaveFocus();
    }
  });
});
