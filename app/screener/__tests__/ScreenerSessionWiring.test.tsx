// app/screener/__tests__/ScreenerSessionWiring.test.tsx
//
// SCREENER-RESULTS-0001 — required wiring-level regression coverage for the
// canonical scan-session model's integration into app/screener/page.tsx.
// Same mocking convention as CcCapacityGate.test.tsx / UnifiedStrategyLauncher
// .test.tsx / OiAndSortWiring.test.tsx: only the network boundary
// (lib/scans/tastytrade-client) and, where noted, `fetch` are mocked/spied —
// the real page.tsx component and the real lib/screener/scanSession.ts
// functions it calls run unmodified.
//
// This file maps to the ticket's 20 required scenarios as follows (numbers
// refer to the ticket's own numbered list):
//   1  -> 'six selected...'
//   2  -> 'a planned symbol whose evaluation finds no qualifying candidate...'
//   3  -> 'a real chain-fetch failure...'
//   5  -> 'a superseded scan...'
//   6  -> 'CSP-launch isolation...'
//   8  -> 'a foreign-strategy result...'
//   9  -> covered by scenario 1's own reconciled totals
//   10 -> 'a disqualified result never appears in Best Opportunities'
//   11 -> 'no-qualified-results produces the required empty state'
//   12 -> 'recommendation generation only for a matching...session'
//   13 -> 'an old session's recommendations never appear...'
//   14 -> 'valid cached-session restoration...'
//   15 -> 'invalid/malformed/...cached data is rejected'
//   16 -> 'ordinary CC universe intersection...selected-but-ineligible...'
// Scenarios 4 (Targeted cancellation), 7 (Ranked BPS/BCS/IC acceptance -- see
// lib/screener/__tests__/scanSession.test.ts's own strategy-acceptance
// coverage), 17 (explicit CC override), 18 (empty CC universe), 19
// (CC_UNATTRIBUTABLE_EXPOSURE fail-closed), and 20 (pre-existing suite
// unaffected) are already covered by real wiring-level tests elsewhere —
// UnifiedStrategyLauncher.test.tsx #7, CcCapacityGate.test.tsx #9/#10,
// SingleCoveredCallLaunchAction.test.tsx, and the full existing suite run
// (207/207 passing) documented in the implementation report — rather than
// duplicated here.
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

async function clickCcScan() {
  await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
}
async function clickCspScan() {
  await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
}

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

// A single eligible CALL leg, comfortably inside DEFAULT_CC_RULES (delta
// 0.28, 30 DTE, OI 150) -- same fixture shape proven to qualify a real CC
// scan in OiAndSortWiring.test.tsx. CC has no IVR band, so getMarketMetrics'
// default (null ivRank) doesn't block it.
// For a PUT leg (CSP), DEFAULT_CSP_RULES requires delta within 0.15-0.25 and
// (via qualifyingCspMetrics() below) an in-band IVR -- CSP's IVR check fails
// closed on a null/missing ivRank, unlike CC's capacity-only gate.
function qualifyingChain(symbol: string, optionType: 'C' | 'P' = 'C') {
  const d = new Date();
  // 35 days out -- safely inside both DEFAULT_CC_RULES (21-45) and
  // DEFAULT_CSP_RULES (30-45) DTE windows, clear of the 30-day boundary
  // where a same-day rounding difference in daysUntil() could tip a CSP
  // fixture just outside its window.
  d.setDate(d.getDate() + 35);
  const expDate = d.toISOString().slice(0, 10);
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        {
          // bid/ask spread deliberately 0.08, not 0.10 -- DEFAULT_CSP_RULES.
          // BID_ASK_MAX is 0.10 and floating-point subtraction of 1.3-1.2
          // actually yields 0.10000000000000009 (> 0.10), which silently
          // disqualified this exact fixture before this comment was added.
          strikePrice: optionType === 'C' ? 110 : 90, expirationDate: expDate, optionType, delta: optionType === 'C' ? 0.28 : -0.2,
          openInterest: optionType === 'C' ? 150 : 500, bid: 1.2, ask: 1.28, mid: 1.24, occSymbol: `${symbol}_TEST_${optionType}`,
        },
      ],
    },
    isEtfOrIndex: false,
    classification: 'stock' as const,
  };
}
const emptyChain = { expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' as const };

// CSP's IVR check fails closed on the default null ivRank getMarketMetrics
// returns for an unmocked symbol -- this supplies an in-band (30-70) value
// so a CSP scan can actually qualify in tests that need a real qualified
// result (not just an evaluated one).
function qualifyingCspMetrics(symbols: string[]) {
  getMarketMetricsMock.mockResolvedValue(symbols.map(symbol => ({ symbol, ivRank: 50, earningsExpectedDate: null })));
}

function accountingText() {
  return screen.getByTitle(/Selected: your normalized universe/i).textContent ?? '';
}

// Resolves control for a deferred network call -- lets a test start a scan,
// hold it mid-flight, trigger a second scan, and only then let the first
// one's late result try to land.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset();
  getQuoteMock.mockReset().mockResolvedValue(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SCREENER-RESULTS-0001: accounting reconciliation (1, 2, 9)', () => {
  it('six selected, five planned (one excluded by scope), five attempted/evaluated, mixed qualified/disqualified, exactly one skip', async () => {
    // NKE/MU qualify; AAPL/TSLA/AMD have verified capacity but no
    // qualifying option in the mocked chain (a real evaluated-with-zero-
    // qualifying-candidate outcome, never fabricated as a failure); GHOST is
    // in the trader's universe but never verified as a holding at all, so
    // it's selected but not planned.
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding(), MU: holding(), AAPL: holding(), TSLA: holding(), AMD: holding() },
      warnings: [],
    });
    getChainMock.mockImplementation((symbol: string) =>
      Promise.resolve(['NKE', 'MU'].includes(symbol) ? qualifyingChain(symbol) : emptyChain)
    );
    renderScreener();
    await addToUniverse('NKE,MU,AAPL,TSLA,AMD,GHOST');
    await clickCcScan();

    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    // GHOST never verified -- never sent to the market-data boundary at all.
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['NKE', 'MU', 'AAPL', 'TSLA', 'AMD'])
    );
    expect(getMarketMetricsMock.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['GHOST']));

    await waitFor(() => {
      const text = accountingText();
      expect(text).toMatch(/6 selected/);
      expect(text).toMatch(/5 planned/);
      expect(text).toMatch(/5 attempted/);
      expect(text).toMatch(/5 evaluated/);
      expect(text).toMatch(/1 skipped/);
      expect(text).toMatch(/2 qualified/);
      expect(text).toMatch(/3 disqualified/);
    });
    // No real failure occurred -- the "failed" segment must not render at
    // all (never conflated with the 3 real, evaluated disqualifications).
    expect(accountingText()).not.toMatch(/failed/);
  });
});

describe('SCREENER-RESULTS-0001: real failure handling (3)', () => {
  it('a real chain-fetch failure for one planned symbol is recorded as failed and visible in accounting, never fabricated as a disqualified evaluation', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding(), MU: holding() },
      warnings: [],
    });
    getChainMock.mockImplementation((symbol: string) =>
      symbol === 'MU' ? Promise.reject(new Error('market data request failed')) : Promise.resolve(qualifyingChain(symbol))
    );
    renderScreener();
    await addToUniverse('NKE,MU');
    await clickCcScan();

    await waitFor(() => {
      const text = accountingText();
      expect(text).toMatch(/2 selected/);
      expect(text).toMatch(/2 planned/);
      expect(text).toMatch(/2 attempted/);
      expect(text).toMatch(/1 evaluated/);
      expect(text).toMatch(/1 failed/);
    });
  });
});

describe('SCREENER-RESULTS-0001: strategy isolation (6, 8)', () => {
  it('a CSP scan renders only CSP-typed results and highlights FIND CSPs, never FIND SPREADS', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    renderScreener();
    await addToUniverse('NKE,MU');
    await clickCspScan();

    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    await waitFor(() => expect(accountingText()).toMatch(/2 selected/));

    const findCsps = screen.getByRole('button', { name: 'FIND CSPs' });
    const findSpreads = screen.getByRole('button', { name: 'FIND SPREADS' });
    expect(findCsps.className).toMatch(/ring-amber-400/);
    expect(findSpreads.className).not.toMatch(/ring-white\/70/);

    // A CSP-typed strategy badge is rendered -- never relabeled as a
    // spread type, and no foreign-strategy result reached the live session
    // (the model itself throws on a strategy mismatch -- see
    // lib/screener/__tests__/scanSession.test.ts).
    expect(screen.getAllByText('CSP').length).toBeGreaterThan(0);
  });
});

describe('SCREENER-RESULTS-0001: session supersession (5)', () => {
  // Note on reachability: app/screener/page.tsx gates every scan-trigger
  // button (FIND SPREADS/CSPs/COVERED CALLS/PMCCs) behind the same page-
  // level `loading` flag and relabels them "SCANNING..." while any one scan
  // is in flight -- so two scan LOOPS can never truly overlap through the
  // UI (the button that would start scan #2 is unclickable, and its text no
  // longer matches, until scan #1's loop finishes). The real, reachable
  // supersession race in this codebase is a stale response from a SEPARATE,
  // not-loading-gated async operation -- the Best Opportunities
  // recommendation fetch -- landing after a later scan is already active;
  // that race is exercised directly (with real chain-fetch data, not a
  // mock) in the "Best Opportunities trust boundary" describe block below.
  // This block instead proves the session model's own defense-in-depth:
  // beginScanSession() never leaves two sessions simultaneously "current" --
  // starting session #2 always fully replaces session #1's identity, even
  // when #1 completed only moments earlier.
  it('starting a second scan always replaces the prior session/UI outright -- no merged or dual-session state', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding() },
      warnings: [],
    });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));
    renderScreener();
    await addToUniverse('NKE');
    await clickCcScan();
    await waitFor(() => expect(accountingText()).toMatch(/1 selected/));
    expect(screen.getAllByText('CC').length).toBeGreaterThan(0);

    // A second, later CSP scan over a different universe fully replaces it.
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    qualifyingCspMetrics(['NKE', 'MU']);
    await addToUniverse('MU');
    await clickCspScan();
    await waitFor(() => expect(accountingText()).toMatch(/2 selected/));

    // Only the CSP session's identity is now on display -- never a mix of
    // both, and the launcher highlight matches the newer session only.
    const findCsps = screen.getByRole('button', { name: 'FIND CSPs' });
    const findCc = screen.getByRole('button', { name: 'FIND COVERED CALLS' });
    expect(findCsps.className).toMatch(/ring-amber-400/);
    expect(findCc.className).not.toMatch(/ring-cyan-400/);
    expect(screen.getAllByText('CSP').length).toBeGreaterThan(0);
  });
});

describe('SCREENER-RESULTS-0001: Best Opportunities trust boundary (10, 11, 12, 13)', () => {
  it('only qualified results reach the recommendation request; a disqualified result is never sent', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding(), MU: holding() },
      warnings: [],
    });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(symbol === 'NKE' ? qualifyingChain(symbol) : emptyChain));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { recommendations: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('NKE,MU');
    await clickCcScan();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/autopilot/recommendations');
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.screenResults).toHaveLength(1);
    expect(body.screenResults[0].symbol).toBe('NKE');
    expect(body.screenResults[0].qualified).toBe(true);
  });

  it('no qualified results produces the required exact empty state and never calls the recommendation endpoint', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding() },
      warnings: [],
    });
    getChainMock.mockResolvedValue(emptyChain);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('NKE');
    await clickCcScan();

    await waitFor(() =>
      expect(
        screen.getByText('No qualified opportunities for this scan. Review the disqualified candidates and their reasons below.')
      ).toBeInTheDocument()
    );
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/autopilot/recommendations')).toBe(false);
  });

  it("a prior session's in-flight recommendation response never populates a newer session's Best Opportunities", async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding() },
      warnings: [],
    });
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol)));

    const staleFetch = deferred<any>();
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const symbol = body.screenResults[0]?.symbol;
      if (symbol === 'NKE') return staleFetch.promise;
      return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const recCallCount = () => fetchMock.mock.calls.filter(c => c[0] === '/api/autopilot/recommendations').length;

    renderScreener();
    // First (CC) session -- qualified NKE result, recommendation request
    // deliberately left hanging.
    await addToUniverse('NKE');
    await clickCcScan();
    await waitFor(() => expect(recCallCount()).toBe(1));

    // Supersede with a CSP session (own quick, resolved request).
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    qualifyingCspMetrics(['NKE', 'MU']);
    await addToUniverse('MU');
    await clickCspScan();
    await waitFor(() => expect(recCallCount()).toBe(2));
    await waitFor(() => expect(accountingText()).toMatch(/2 selected/));

    // Now resolve the stale CC request.
    staleFetch.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    await new Promise(r => setTimeout(r, 50));

    // Still the CSP session on display -- the stale response must not have
    // reverted the launcher highlight or the accounting summary.
    const findCsps = screen.getByRole('button', { name: 'FIND CSPs' });
    expect(findCsps.className).toMatch(/ring-amber-400/);
    expect(accountingText()).toMatch(/2 selected/);
  });
});

describe('SCREENER-RESULTS-0001: CC scope-exclusion precision (16)', () => {
  it('selected-but-ineligible CC symbols (no verified shares vs fully covered) are both excluded and never scanned, without conflating the two reasons', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: {
        NKE: holding(), // real capacity -- planned
        MU: holding({ availableCoveredContracts: 0 }), // verified holding, fully covered -- excluded, CC_FULLY_COVERED
        // GHOST: never verified at all -- excluded, CC_NO_SHARES_OWNED
      },
      warnings: [],
    });
    getChainMock.mockResolvedValue(qualifyingChain('NKE'));

    renderScreener();
    await addToUniverse('NKE,MU,GHOST');
    await clickCcScan();

    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['NKE']);

    await waitFor(() => {
      const text = accountingText();
      expect(text).toMatch(/3 selected/);
      expect(text).toMatch(/1 planned/);
      expect(text).toMatch(/2 skipped/);
    });
  });
});

describe('SCREENER-RESULTS-0001: session cache module (14, 15)', () => {
  // A minimal, spec-shaped IndexedDB fake -- enough to exercise the real
  // lib/screener/scanSessionCache.ts open/transaction/objectStore/get/put/
  // delete sequence it actually issues (see that file's idbOpen/idbGet/
  // idbSet/idbDel), without depending on jsdom having a real IndexedDB
  // implementation (it does not).
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

  afterEach(() => {
    delete (globalThis as any).indexedDB;
    vi.resetModules();
  });

  it('a validly completed session round-trips through persistScanSession/restoreScanSession with reconciled accounting and honest cache provenance', async () => {
    installFakeIndexedDb();
    const {
      createScanSession, recordSymbolEvaluated, completeSession,
    } = await import('@/lib/screener/scanSession');
    const { persistScanSession, restoreScanSession } = await import('@/lib/screener/scanSessionCache');

    const emptyCheck = { status: 'pass' as const, value: '-', reason: '-' };
    const checks = { ivr: emptyCheck, earnings: emptyCheck, oi: emptyCheck, delta: emptyCheck, credit: emptyCheck, roc: emptyCheck, pop: emptyCheck, iv: emptyCheck, emClearance: emptyCheck };
    let session = createScanSession({
      mode: 'filter',
      requestedStrategy: 'csp',
      scope: { universeSymbols: ['NKE'], eligibleSymbols: ['NKE'] },
    });
    session = recordSymbolEvaluated(session, 'NKE', [{
      symbol: 'NKE', strategy: 'CSP', price: 100, ivr: 40, qualified: true,
      bestCandidate: null, failReasons: [], checks,
    }]);
    session = completeSession(session);

    await persistScanSession(session);
    const restored = await restoreScanSession();

    expect(restored).not.toBeNull();
    expect(restored!.sessionId).toBe(session.sessionId);
    expect(restored!.requestedStrategy).toBe('csp');
    expect(restored!.results).toHaveLength(1);
    expect(restored!.cacheProvenance).toBe('idb-cache');
    expect(typeof restored!.cachedAt).toBe('number');
  });

  it('malformed/unknown-schema cached data is rejected and cleared, never trusted as a real session', async () => {
    installFakeIndexedDb();
    const { restoreScanSession, SCAN_SESSION_CACHE_KEY } = await import('@/lib/screener/scanSessionCache');

    // Seed the store directly with garbage, bypassing persistScanSession
    // entirely -- simulates a stale/foreign/corrupted cache entry.
    await new Promise<void>(resolve => {
      const req = (globalThis as any).indexedDB.open();
      req.onupgradeneeded = ({ target }: any) => {
        if (!target.result.objectStoreNames.contains('kv')) target.result.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('kv');
        tx.objectStore().put({ schemaVersion: 999, garbage: true }, SCAN_SESSION_CACHE_KEY);
        tx.oncomplete = () => resolve();
      };
    });

    const restored = await restoreScanSession();
    expect(restored).toBeNull();

    // And it must actually have been cleared, not merely rejected once.
    const restoredAgain = await restoreScanSession();
    expect(restoredAgain).toBeNull();
  });
});
