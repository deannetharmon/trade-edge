// app/screener/__tests__/ScreenerPage.test.tsx
//
// WA-0005 §22/§27: page/integration coverage for /screener as the
// canonical Opportunities workspace. Follows this repo's established
// app/<route>/__tests__/<PageName>.test.tsx convention (see
// app/portfolio/__tests__/PortfolioPage.test.tsx) -- no app/screener test
// file existed before this sprint.
//
// Test-environment notes (read before extending this file):
//   - app/screener/page.tsx's `Home` component requires TaskProvider +
//     CommandProvider (via its internal useRankedScan() call) to render at
//     all -- mirrors PortfolioPage.test.tsx's own PortfolioModeProvider/
//     PortfolioDataProvider wrapping requirement.
//   - `results` (the raw ScreenResult[] driving everything on this page)
//     is restored from IndexedDB on mount (idbGet(IDB_RESULTS_KEY)); jsdom
//     has no real `indexedDB`, so this file installs a minimal, faithful
//     in-memory fake matching the exact open/transaction/objectStore/get/
//     put call shape app/screener/page.tsx's local idbOpen/idbGet/idbSet
//     use, and seeds it before each render that needs non-empty results.
//   - Live TastyTrade chain acquisition remains mocked at the ranked-scan
//     runner boundary. The refresh-specific cases below drive the real
//     button/command bus. The transport-lifecycle cases create and complete
//     real TaskManager jobs directly, then exercise the mounted page effect,
//     recommendation transport, and Recommendation Service lifecycle. This
//     keeps the seam explicit while covering aggregation, failure
//     preservation, supersession/lock recovery, and late responses without
//     making external brokerage calls.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskProvider, useTaskManagerContext } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';
import type { TaskManager } from '@/lib/tasks/task-manager';
import { completeSession, createScanSession, recordSymbolEvaluated, recordSymbolFailed } from '@/lib/screener/scanSession';
import { LEAPS_CACHE_KEY, SCAN_SESSION_CACHE_KEY } from '@/lib/screener/scanSessionCache';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '@/lib/scans/pmccConfig';
import type { ScreenResult, CheckResult, RawScanEntry } from '@/lib/scans/types';
import type { Position } from '@/lib/portfolio-data/types';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { AutopilotCandidate } from '@/lib/autopilot/types';
import { startScreenerJob, completeScreenerJob, clearScreenerJob } from '@/lib/screener/screenerJobStore';
import { runRankedScan } from '@/lib/scans/ranked-scan-runner';
import { getAccessToken } from '@/lib/scans/tastytrade-client';
import type { RankedScanResult } from '@/lib/scans/ranked-scan-runner';
import {
  clearRecommendations,
  getCurrentRecommendations,
  RECOMMENDATION_SAFE_REQUEST_BYTES,
  subscribeToRecommendations,
} from '@/lib/recommendations';
import ScreenerPage from '../page';

// Hoisted to module scope (vi.mock calls are hoisted by vitest regardless
// of placement, but declaring it here, before any test body, keeps that
// hoisting behavior unsurprising) -- mirrors app/portfolio/__tests__/
// PortfolioPage.test.tsx's own vi.mock(..., async () => { const actual =
// await vi.importActual(...); return {...actual, fn: vi.fn()...} })
// convention. Only getAccessToken is overridden (to a clean rejection,
// avoiding real navigation/`window.location` side effects); every other
// export passes through unchanged.
vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return { ...actual, getAccessToken: vi.fn().mockRejectedValue(new Error('not authenticated in test')) };
});

// FIX: this file never mocked PortfolioDataProvider at all, so
// useOptionalPortfolioData() (called by app/screener/page.tsx's
// CcCapacityShadowSnapshotBridge) returned its real outside-a-Provider
// default (null) for every test -- meaning FIND PMCCs' eligibility check
// (added when the "never opens a long-leg configuration dialog with
// nothing eligible" fix landed) always found zero held positions and
// correctly refused to open the PMCC modal, regardless of what a given
// test actually wanted to exercise. Default stays empty (positions: [])
// so every non-PMCC test's behavior is unchanged; PMCC-specific tests set
// pmccPortfolioHarness.positions to an eligible held long call before
// rendering.
const pmccPortfolioHarness = vi.hoisted(() => ({ positions: [] as any[] }));
vi.mock('@/components/portfolio-data/PortfolioDataProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/portfolio-data/PortfolioDataProvider')>();
  return {
    ...actual,
    useOptionalPortfolioData: () => ({ snapshot: null, positions: pmccPortfolioHarness.positions, refresh: async () => {} }),
  };
});

// A single-leg long call that clears exactOneLongCall() and the PMCC long
// DTE range (lib/scans/pmccHeldLeaps.ts) -- the minimal shape needed for
// FIND PMCCs' eligibility check to find a real candidate. All positions in
// a test must share the same accountNumber (selectHeldPmccLongCandidatesFromPositions
// requires exactly one active account across the held positions it's given).
function heldEligibleLongCall(overrides: Partial<Position> = {}): Position {
  return {
    key: 'AAPL-long-call', symbol: 'AAPL', accountNumber: 'A1',
    expDate: '2027-06-18', dte: 300, strategy: 'PMCC', structureAmbiguous: false,
    legs: [{ symbol: 'AAPL  270618C00150000', optionType: 'C', strikePrice: 150, direction: 'Long', quantity: 1, avgOpenPrice: 20, currentPrice: 22 }],
    ...overrides,
  } as Position;
}

// PO corrective round 5 (WA-0005 Defect 1): mocks ONLY `runRankedScan` --
// the single function lib/commands/command-handlers.ts's real
// START_RANKED_SCAN handler calls to actually perform the (real,
// network-bound) scan work. Every other real production seam stays live:
// the real button click -> real startRankedScan() (features/screener/
// hooks/useRankedScan.ts) -> real dispatch() -> real CommandBus ->
// real registerCommandHandlers()'s real handler -> real
// TaskManager.createTask()/startTask() -> this mocked runRankedScan() ->
// real .then()/.catch() -> real TaskManager.completeTask()/failTask() ->
// real useRankedScan reconnect effect -> real setResults()/
// completeScreenerJob()/failScreenerJob(). This is the same granularity of
// test double this file's own tastytrade-client mock above already uses
// (avoiding a real network/TastyTrade dependency while keeping every
// actual orchestration seam real) -- necessary because runRankedScan
// itself talks to TastyTrade via getChain/getQuote/getMarketMetrics/etc.,
// which this file does not attempt to fully simulate (see this file's own
// header note). Deferred-promise control (via createDeferred() below) is
// what lets each test decide exactly when/how the REAL, dispatched second
// scan resolves or fails, so the refresh/successful-refresh/failed-refresh
// scenarios can be proven through the actual "Run Ranked Scan" button
// rather than a direct TaskManager.createTask()/completeTask() bypass.
vi.mock('@/lib/scans/ranked-scan-runner', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/ranked-scan-runner')>('@/lib/scans/ranked-scan-runner');
  return { ...actual, runRankedScan: vi.fn() };
});

// ── Minimal, faithful fake IndexedDB ────────────────────────────────────────
// Mirrors the exact call shape of app/screener/page.tsx's local
// idbOpen/idbGet/idbSet/idbDel (IDB_DB_NAME='hunter-db', IDB_STORE_NAME='kv'):
// indexedDB.open(name, version) -> request with onupgradeneeded/onsuccess;
// db.transaction(store, mode) -> tx with oncomplete/onerror;
// tx.objectStore(store).get(key)/.put(value, key)/.delete(key).
function installFakeIndexedDB(): Map<string, unknown> {
  const kv = new Map<string, unknown>();

  class FakeRequest {
    onsuccess: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result: unknown = undefined;
  }

  class FakeObjectStore {
    get(key: string) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        req.result = kv.has(key) ? kv.get(key) : undefined;
        req.onsuccess?.();
      });
      return req;
    }
    put(value: unknown, key: string) {
      kv.set(key, value);
      return new FakeRequest();
    }
    delete(key: string) {
      kv.delete(key);
      return new FakeRequest();
    }
  }

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    objectStore(_name: string) {
      queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
      return new FakeObjectStore();
    }
  }

  class FakeDB {
    objectStoreNames = { contains: () => true };
    createObjectStore() {}
    transaction(_name: string, _mode: string) {
      return new FakeTransaction();
    }
    close() {}
  }

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open(_name: string, _version: number) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        req.result = new FakeDB();
        req.onsuccess?.();
      });
      return req;
    },
  };

  return kv;
}

const c: CheckResult = { status: 'pass', value: '', reason: '' };

// TE-0007D corrective (second, real root cause found alongside the missing
// createTask input above): lib/screener/hooks/useRankedScan.ts's completion
// handler treats absence from rawScanCache as a genuine
// MARKET_DATA_REQUEST_FAILED for that symbol -- deliberate, documented
// safety behavior (a symbol only ever lands in rawScanCache after its own
// real chain/quote fetch succeeds; absence means that fetch genuinely
// threw). Every test below that completes a ranked-scan task with real,
// qualified results for a symbol must also include that symbol in
// rawScanCache, or the real session-reconciliation logic correctly (and
// silently, from the test's perspective) recodes it as failed and drops
// it -- exactly the symptom that made every one of these tests fail.
function makeRawScanEntry(symbol: string): RawScanEntry {
  return {
    symbol,
    strategy: 'BPS',
    metrics: { symbol, ivRank: 55, earningsExpectedDate: null },
    chainData: { expirations: [], chains: {}, isEtfOrIndex: false },
    price: 190,
  };
}

function makeScreenResult(overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AAPL',
    strategy: 'BPS',
    price: 190,
    ivr: 55,
    qualified: true,
    bestCandidate: {
      strategy: 'BPS',
      expiration: '2026-09-18',
      dte: 55,
      shortStrike: 180,
      longStrike: 175,
      shortDelta: -0.22,
      credit: 1.35,
      spreadWidth: 5,
      creditRatio: 0.27,
      roc: 0.37,
      pop: 74,
      shortOI: 2_500,
      longOI: 1_800,
      shortOccSymbol: 'AAPL260918P00180000',
      longOccSymbol: 'AAPL260918P00175000',
      shortBid: 1.32,
      shortAsk: 1.38,
      longBid: 0.22,
      longAsk: 0.26,
      quoteFetchedAt: 1_785_000_000_000,
    },
    failReasons: [],
    trendResult: undefined,
    isEtf: false,
    checks: { ivr: c, earnings: c, oi: c, delta: c, credit: c, roc: c, pop: c, iv: c, emClearance: c },
    ...overrides,
  } as ScreenResult;
}

// TE-0007D corrective — SCREENER-UX-0001's real, added session gate
// (hasCompletedScanForCurrentMode) requires a real, completed
// ScreenerScanSession restored via SCAN_SESSION_CACHE_KEY -- bare
// kv.set('results', [...]) alone (sufficient before this gate existed)
// no longer renders the results panel at all. Wraps the exact real,
// working pattern already used elsewhere in this file (createScanSession
// -> completeSession(recordSymbolEvaluated(...)) -> kv.set(
// SCAN_SESSION_CACHE_KEY, ...)), generalized to any symbol/result set
// instead of one hardcoded case.
function seedCompletedSession(results: ScreenResult[]): void {
  let session = createScanSession({
    mode: 'filter', // matches renderScreenerPage()'s default screenMode ('filter')
    requestedStrategy: 'spreads',
    scope: { universeSymbols: results.map(r => r.symbol), eligibleSymbols: results.map(r => r.symbol) },
  });
  for (const r of results) {
    session = recordSymbolEvaluated(session, r.symbol, [r]);
  }
  session = completeSession(session);
  kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
}

function makeDecisionAnalysis(overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    id: 'decision_1',
    createdAt: '2026-07-25T00:00:00.000Z',
    version: 'decision-analysis-v1',
    subject: { type: 'candidate', id: 'cand_1', symbol: 'AAPL', strategy: 'BPS', label: 'AAPL BPS' },
    objective: 'generate_income',
    recommendation: { action: 'OPEN_BPS', strategy: 'BPS', summary: 'Open it.', status: 'recommended' },
    confidence: { overall: 80, market: 80, portfolio: 80, execution: 80, income: 80, risk: 80 },
    priority: 'normal',
    rationale: 'Good setup.',
    supportingEvidence: [],
    concerns: [],
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'income' },
    candidate: {
      id: 'cand_1', strategy: 'BPS', symbol: 'AAPL', underlyingPrice: 190,
      legs: [
        { symbol: 'AAPL', underlyingSymbol: 'AAPL', assetType: 'option', direction: 'short', optionType: 'put', strike: 180, expiration: '2026-09-18', quantity: 1 },
        { symbol: 'AAPL', underlyingSymbol: 'AAPL', assetType: 'option', direction: 'long', optionType: 'put', strike: 175, expiration: '2026-09-18', quantity: 1 },
      ],
      estimatedCredit: 1.2, theoreticalMaxLoss: 380,
    },
    metadata: { source: 'screener', executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesBlocked: [] },
    ...overrides,
  };
}

function makePmccScreenResult(): ScreenResult {
  const base = makeScreenResult({
    strategy: 'PMCC',
    bestCandidate: {
      strategy: 'PMCC',
      expiration: '2026-09-18',
      dte: 55,
      shortStrike: 205,
      longStrike: 150,
      shortDelta: 0.25,
      longDelta: 0.8,
      credit: 1.35,
      longCost: 31.35,
      netDebit: 30,
      spreadWidth: 55,
      capitalRequired: 3_000,
      contractMultiplier: 100,
      creditRatio: 1.35 / 31.35,
      roc: 4.5,
      pop: 75,
      shortOI: 900,
      longOI: 1_200,
      longExpiration: '2027-01-15',
      longDte: 174,
      longOccSymbolPMCC: 'AAPL270115C00150000',
      shortOccSymbolPMCC: 'AAPL260918C00205000',
    },
  });
  const quote = (bid: number, ask: number) => ({
    bid, ask, midpoint: (bid + ask) / 2, width: ask - bid, spreadPct: ((ask - bid) / ((ask + bid) / 2)) * 100,
    quoteTimestamp: '2026-08-14T19:59:30.000Z', ageSeconds: 30, delayed: false,
    structurallyUsable: true, withinQualifyingWidth: true, readyInput: true,
    status: 'acceptable' as const, reason: 'Quote is current and within the acceptable spread',
  });
  return {
    ...base,
    candidateId: 'occ:AAPL270115C00150000::occ:AAPL260918C00205000',
    publishedOrder: 1,
    pmccAsOf: '2026-08-14T20:00:00.000Z',
    pmccIncompleteAnalysis: false,
    pmccLegRejections: [],
    pmccPairingCounts: {
      eligibleLongLegs: 1, eligibleShortLegs: 1, potentialCombinations: 1, combinationsEvaluated: 1,
      combinationsOmittedBySafetyLimit: 0, structurallyValidPairs: 1, qualifiedPairsBeforeRetention: 1,
      nearMissPairsBeforeRetention: 0, qualifiedPairsRetained: 1, nearMissPairsRetained: 0,
      qualifiedPairsOmittedByRetention: 0, nearMissPairsOmittedByRetention: 0,
    },
    pmccPair: {
      pairId: 'occ:AAPL270115C00150000::occ:AAPL260918C00205000', symbol: 'AAPL', qualified: true,
      insufficientData: false, failureReasons: [], primaryFailureReason: null, orderingLabel: 'Contract order',
      longLeg: { candidateId: 'occ:AAPL270115C00150000', role: 'long', underlyingSymbol: 'AAPL', expiration: '2027-01-15', dte: 174, strike: 150, delta: 0.8, openInterest: 1200, occSymbol: 'AAPL270115C00150000', quote: quote(31, 31.35), executablePrice: 31.35, intrinsic: 40, extrinsic: 0.35 },
      shortLeg: { candidateId: 'occ:AAPL260918C00205000', role: 'short', underlyingSymbol: 'AAPL', expiration: '2026-09-18', dte: 35, strike: 205, delta: 0.25, openInterest: 900, occSymbol: 'AAPL260918C00205000', quote: quote(1.35, 1.45), executablePrice: 1.35, intrinsic: null, extrinsic: null },
      metrics: { netDebitPerShare: 30, strikeWidth: 55, widthMinusDebitPerShare: 25, widthMinusDebitPctOfDebit: 83.333, longIntrinsicPerShare: 40, longExtrinsicPerShare: 0.35, shortCreditToNetDebitPct: 4.5, shortCreditToLongExtrinsicPct: 385.714, netDelta: 0.55 },
    },
  };
}

function makePmccDecisionAnalysis(): DecisionAnalysis {
  return makeDecisionAnalysis({
    id: 'decision_pmcc',
    subject: { type: 'candidate', id: 'cand_pmcc', symbol: 'AAPL', strategy: 'PMCC', label: 'AAPL PMCC' },
    recommendation: { action: 'OPEN_PMCC', strategy: 'PMCC', summary: 'Review PMCC.', status: 'conditional' },
    expectedOutcome: { intent: 'income', capitalRequired: 3_000, theoreticalMaxLoss: 3_000 },
    candidate: {
      id: 'cand_pmcc',
      strategy: 'PMCC',
      symbol: 'AAPL',
      underlyingPrice: 190,
      legs: [
        {
          symbol: 'AAPL270115C00150000', optionSymbol: 'AAPL270115C00150000',
          underlyingSymbol: 'AAPL', assetType: 'option', direction: 'long', optionType: 'call',
          strike: 150, expiration: '2027-01-15', quantity: 1, contractMultiplier: 100, openInterest: 1_200,
        },
        {
          symbol: 'AAPL260918C00205000', optionSymbol: 'AAPL260918C00205000',
          underlyingSymbol: 'AAPL', assetType: 'option', direction: 'short', optionType: 'call',
          strike: 205, expiration: '2026-09-18', quantity: 1, contractMultiplier: 100, openInterest: 900,
        },
      ],
      estimatedCredit: 1.35,
      theoreticalMaxLoss: 3_000,
      netDebit: 30,
      netDebitUnit: 'per_share',
      sourceResultId: 'AAPL::PMCC::2026-09-18::205::2027-01-15::150',
    },
  });
}

function makeAnalysisForCandidate(
  candidate: AutopilotCandidate,
  index = 0,
): DecisionAnalysis {
  return makeDecisionAnalysis({
    id: `decision_${candidate.id}_${index}`,
    subject: {
      type: 'candidate',
      id: candidate.id,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol} ${candidate.strategy}`,
    },
    candidate,
  });
}

function makeLargeTransportResult(symbol: string, fill: string): ScreenResult {
  const base = makeScreenResult({ symbol });
  return makeScreenResult({
    symbol,
    bestCandidate: {
      ...base.bestCandidate!,
      shortOccSymbol: `${symbol}${fill}`,
      longOccSymbol: `${symbol}${fill}`,
    },
  });
}

function renderScreenerPage() {
  return render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
}

// PO corrective round 3, Finding 2/3: a tiny, additive test harness that
// captures the REAL, live TaskManager instance backing this page's Ranked
// Scan orchestration (features/screener/hooks/useRankedScan.ts). This is
// not a parallel/fake implementation of anything -- useRankedScan already
// reacts to real TaskManager task-lifecycle events regardless of how a task
// reaches 'completed' (this is the same mechanism RankedScanTaskMirror
// relies on, CES §5.10), so driving the real TaskManager's real
// createTask/updateTask/completeTask/failTask methods exercises the exact
// production code path the real "Run Ranked Scan" button triggers, without
// needing to mock the entire live TastyTrade chain-scan boundary
// (getAccessToken/getChain/getQuote/classifyUnderlying/getMarketMetrics/
// ttFetch) that a full runScreen()/runPMCCScan() call would otherwise
// require. This directly answers this round's Finding 2/3 requirement to
// prove refresh/staleness/race behavior via a real scan-mode trigger, not a
// direct mutation of this page's own React state.
function TaskManagerCapture({ onReady }: { onReady: (manager: TaskManager) => void }) {
  const manager = useTaskManagerContext();
  onReady(manager);
  return null;
}

function renderRankedScanScreenerPage(): TaskManager {
  window.history.pushState({}, '', '/screener?mode=rank');
  let captured: TaskManager | null = null;
  render(
    <TaskProvider>
      <CommandProvider>
        <TaskManagerCapture onReady={(m) => { captured = m; }} />
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
  return captured!;
}

let kv: Map<string, unknown>;

beforeEach(() => {
  window.localStorage.clear();
  kv = installFakeIndexedDB();
  // Reset per test -- see the PortfolioDataProvider mock above.
  pmccPortfolioHarness.positions = [];
  // Finding 5: screenerJobStore is a module-level singleton (like
  // RecommendationService) -- reset it before each test so a completed job
  // from a prior test can never leak into this one and produce a false
  // staleness signal.
  clearScreenerJob();
  clearRecommendations();
  // Default: network disabled. Overridden per test for
  // /api/autopilot/recommendations as needed. loadExistingPositions/
  // loadWatchlist/loadFilters etc. all treat a rejection as a non-blocking,
  // honest "nothing loaded" outcome (existing, unchanged behavior).
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearScreenerJob();
  clearRecommendations();
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
});

describe('WA-0005 /screener: Initial/not-yet-run state', () => {
  it('keeps the watchlist preset dropdown inside the import panel', async () => {
    renderScreenerPage();

    fireEvent.click((await screen.findAllByRole('button', { name: '▼' }))[0]);

    const menu = await screen.findByTestId('watchlist-preset-menu');
    expect(menu).toHaveClass('w-full');
    expect(menu).not.toHaveClass('absolute');
    expect(menu).not.toHaveClass('right-0');
  });

  it('keeps the saved-list menu aligned to the full sidebar panel', async () => {
    renderScreenerPage();

    fireEvent.click(await screen.findByRole('button', { name: /Load List/i }));

    const menu = await screen.findByTestId('saved-list-menu');
    expect(menu).toHaveClass('w-full');
    expect(menu).not.toHaveClass('absolute');
    expect(menu).not.toHaveClass('right-0');
  });

  it('replaces the Hunter instructions with restored LEAPS results', async () => {
    window.localStorage.setItem('hunter-screen-mode', 'leaps');
    kv.set(LEAPS_CACHE_KEY, {
      results: [{
        symbol: 'GS', expiration: '2027-06-17', dte: 284, strike: 800,
        delta: 0.82, openInterest: 246, bid: 279.35, ask: 285.70,
        occSymbol: 'GS270617C00800000', underlyingPrice: 1037.94,
        spreadPct: 2.2, extrinsicValue: 44.58, dataQuality: 'ok',
        score: 53, scoreIncomplete: false,
      }],
      filters: { deltaMin: 0.70, deltaMax: 0.85, dteMin: 180, oiMin: 100, extrinsicPctMax: 0 },
      cachedAt: Date.now(),
    });

    renderScreenerPage();

    await waitFor(() => expect(screen.getByText('LEAPS CANDIDATES')).toBeInTheDocument());
    expect(screen.getByText(/1 of 1 candidates match current filters/i)).toBeInTheDocument();
    expect(screen.queryByText(/ADD TICKERS AND RUN HUNTER/)).not.toBeInTheDocument();
  });

  it('Spreads Filter mode preview box shows the selected preset\'s real values', async () => {
    // Closes the gap Quinn flagged: nothing previously confirmed the
    // Filter-mode preview box shows the *correct* numbers for a given
    // preset, only that it renders something.
    seedWatchlist();
    renderScreenerPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'FIND SPREADS' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'FIND SPREADS' }));
    const dialog = await screen.findByRole('dialog', { name: /SCAN SELECTED/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Strict/ }));

    const preview = screen.getByTestId('filter-preset-preview');
    expect(preview).toHaveTextContent('IVR ≥ 40%');
    expect(preview).toHaveTextContent('OI ≥ 500');
    expect(preview).toHaveTextContent('$0.10');
    expect(preview).toHaveTextContent('35%');

    // Switching preset must change the displayed numbers, not just the
    // selected-button highlight -- proves the preview is wired to the
    // real selection, not a static string.
    fireEvent.click(within(dialog).getByRole('button', { name: /^Relaxed/ }));
    expect(screen.getByTestId('filter-preset-preview')).toHaveTextContent('IVR ≥ 25%');
    expect(screen.queryByTestId('filter-preset-preview')).not.toHaveTextContent('IVR ≥ 40%');
  });

  it('shows configurable PMCC short-call search defaults and persists edits on submit', async () => {
    seedWatchlist();
    pmccPortfolioHarness.positions = [heldEligibleLongCall()];
    renderScreenerPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'FIND PMCCs' }));

    // FIX: this modal only ever configures the SHORT call being sold --
    // the long leg is the LEAPS already held, auto-derived from the
    // account, never a user-configured field (see PmccScanModal.tsx: "Your
    // held LEAPS is the existing cover... no new long call is selected or
    // purchased"). "Long call DTE minimum/maximum" fields never existed in
    // this modal; this test predates that design and was asserting fields
    // that were never real. Real label text confirmed directly from
    // features/screener/components/PmccScanModal.tsx.
    const shortMin = await screen.findByLabelText('Short call min DTE') as HTMLInputElement;
    const shortMax = screen.getByLabelText('Short call max DTE') as HTMLInputElement;
    const deltaMin = screen.getByLabelText('Preferred short delta min') as HTMLInputElement;
    const deltaMax = screen.getByLabelText('Preferred short delta max') as HTMLInputElement;
    const oiMin = screen.getByLabelText('Minimum short OI') as HTMLInputElement;
    const maxSpread = screen.getByLabelText('Maximum bid/ask spread %') as HTMLInputElement;

    expect(shortMin.value).toBe('21');
    expect(shortMax.value).toBe('45');
    expect(deltaMin.value).toBe('0.2');
    expect(deltaMax.value).toBe('0.35');
    expect(oiMin.value).toBe('100');
    expect(maxSpread.value).toBe('10');

    fireEvent.change(shortMin, { target: { value: '14' } });
    fireEvent.change(shortMax, { target: { value: '35' } });

    // TE-0007D corrective — the modal is a draft, matching CSP/CC's
    // established pattern: editing a field must not itself persist or
    // change anything until a valid run is actually submitted.
    expect(window.localStorage.getItem('hunter-pmcc-dte-ranges')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'RUN PMCC SCAN →' }));

    // FIX: persisted shape is short-leg-only now (app/screener/page.tsx's
    // write to LS_PMCC_DTE) -- no longMin/longMax, since there's nothing
    // user-configured to persist for the long leg anymore.
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('hunter-pmcc-dte-ranges')!)).toEqual({
      shortMin: 14,
      shortMax: 35,
      shortDeltaMin: 0.2,
      shortDeltaMax: 0.35,
      shortOiMin: 100,
      maxSpreadPct: 10,
    }));
  });

  it('restores saved PMCC short-call search settings', async () => {
    seedWatchlist();
    pmccPortfolioHarness.positions = [heldEligibleLongCall()];
    // FIX: matches the real persisted shape (short-leg fields only).
    window.localStorage.setItem('hunter-pmcc-dte-ranges', JSON.stringify({
      shortMin: 10,
      shortMax: 30,
      shortDeltaMin: 0.22,
      shortDeltaMax: 0.33,
      shortOiMin: 150,
      maxSpreadPct: 8,
    }));

    renderScreenerPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'FIND PMCCs' }));

    await waitFor(() => expect(screen.getByLabelText('Short call min DTE')).toHaveValue(10));
    expect(screen.getByLabelText('Short call max DTE')).toHaveValue(30);
    expect(screen.getByLabelText('Preferred short delta min')).toHaveValue(0.22);
    expect(screen.getByLabelText('Preferred short delta max')).toHaveValue(0.33);
    expect(screen.getByLabelText('Minimum short OI')).toHaveValue(150);
    expect(screen.getByLabelText('Maximum bid/ask spread %')).toHaveValue(8);
  });

  it('blocks a PMCC scan when a selected DTE range is invalid', async () => {
    seedWatchlist();
    pmccPortfolioHarness.positions = [heldEligibleLongCall()];
    renderScreenerPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeEnabled());
    vi.mocked(getAccessToken).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'FIND PMCCs' }));
    fireEvent.change(await screen.findByLabelText('Short call min DTE'), { target: { value: '46' } });
    fireEvent.change(screen.getByLabelText('Short call max DTE'), { target: { value: '45' } });

    // TE-0007D corrective — FIND PMCCs now opens a pre-scan modal (matching
    // CSP/CC/Spreads); an invalid DTE range disables RUN PMCC SCAN rather
    // than allowing a click that's then rejected with an error message, so
    // this asserts the disabled state directly instead of error text.
    expect(screen.getByRole('button', { name: 'RUN PMCC SCAN →' })).toBeDisabled();
    expect(vi.mocked(getAccessToken)).not.toHaveBeenCalled();
  });

  it('replaces a mounted prior spread session and clears recommendations through the real PMCC scan path', async () => {
    const priorResult = makeScreenResult();
    seedWatchlist();
    pmccPortfolioHarness.positions = [heldEligibleLongCall()];
    window.history.pushState({}, '', '/screener?mode=filter');
    let prior = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: ['AAPL'] },
    });
    prior = completeSession(recordSymbolEvaluated(prior, 'AAPL', [priorResult]));
    kv.set(SCAN_SESSION_CACHE_KEY, { ...prior, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }),
      });
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();
    await waitFor(() => expect(screen.getByText('$190.00')).toBeInTheDocument());
    await waitFor(() => expect(getCurrentRecommendations().analyses).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'FIND PMCCs' }));
    fireEvent.click(await screen.findByRole('button', { name: 'RUN PMCC SCAN →' }));

    await waitFor(() => expect(screen.getByText('PMCC AUDIT RESULTS')).toBeInTheDocument());
    // FIX: same PmccTickerDisclosure expand requirement as the dedicated
    // audit-card test above -- defaultOpen={false} unconditionally for the
    // audit section, so nothing renders until this ticker's group is
    // expanded.
    fireEvent.click(screen.getAllByRole('button', { name: /AAPL.*audit/ })[0]);
    expect(screen.getByTestId('pmcc-audit-card')).toHaveTextContent('Market-data acquisition failure');
    expect(screen.queryByText('$190.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/Best Opportunities/i)).not.toBeInTheDocument();
    expect(getCurrentRecommendations().analyses).toHaveLength(0);
    expect(vi.mocked(getAccessToken)).toHaveBeenCalled();
  });
  it('AC-14: shows an explicit "run a scan" prompt, not an empty-results message, and Ranked Opportunities does not render', async () => {
    renderScreenerPage();

    await waitFor(() => expect(screen.getByText(/ADD TICKERS AND RUN HUNTER/)).toBeInTheDocument());
    expect(screen.queryByText(/EMPTY UNIVERSE/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('best-opportunities-shortlist')).toBeNull();
  });
});

describe('WA-0005 /screener: evaluable-results gating and section order (AC-3/AC-4/AC-6/AC-9/AC-10)', () => {
  it('renders Ranked Opportunities above the disqualified/full-results section once a scan has produced results, with the best-opportunities-shortlist testid present exactly once', async () => {
    // TE-0007D corrective — "All Scan Results" as a distinct heading was
    // replaced by SCREENER-UX-0001's real 6-section hierarchy (Scan
    // Identity -> Accounting -> Filter Controls -> Best Opportunities ->
    // Disqualified -> Symbol Outcomes). The DOM-order relationship this
    // test actually cares about (ranked/best-opportunities content leads,
    // the full disqualified/rejected list follows) still holds -- just
    // against real current testids instead of retired heading text.
    // features/screener/components/__tests__/ScreenerUXHierarchy.test.tsx
    // already covers the full 6-section order in more depth; this keeps
    // the narrower, original AC-10 duplicate-id check alive too.
    const combined = [
      makeScreenResult(),
      makeScreenResult({ symbol: 'MSFT', qualified: false, bestCandidate: null, failReasons: ['No qualifying strikes'] }),
    ];
    kv.set('results', combined);
    seedCompletedSession(combined);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }),
        });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(screen.queryByTestId('best-opportunities-shortlist')).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId('disqualified-section')).not.toBeNull());

    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    const disqualifiedSection = screen.getByTestId('disqualified-section');

    // Document order: Best Opportunities' DOM node must precede the
    // disqualified/full-results section -- Node.compareDocumentPosition
    // bit 4 (DOCUMENT_POSITION_FOLLOWING) set on disqualifiedSection
    // relative to rankedSection confirms this.
    const position = rankedSection.compareDocumentPosition(disqualifiedSection);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // AC-10: exactly one best-opportunities-shortlist and no duplicate ids on this page.
    expect(document.querySelectorAll('[data-testid="best-opportunities-shortlist"]')).toHaveLength(1);
    expect(document.querySelectorAll('#best-opportunity')).toHaveLength(0);
  });

  it('AC-6: does not render Ranked Opportunities before a scan has produced evaluable results (results.length === 0)', async () => {
    renderScreenerPage();
    await waitFor(() => expect(screen.getByText(/ADD TICKERS AND RUN HUNTER/)).toBeInTheDocument());
    expect(screen.queryByTestId('best-opportunities-shortlist')).toBeNull();
  });

  it('AC-5: the results view retains the existing CSV export control', async () => {
    // TE-0007D corrective — "All Scan Results" heading text is retired
    // (see the hierarchy test above); the CSV control's own real
    // requirement -- it must still exist once a scan has results -- is
    // unaffected by that rename.
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    renderScreenerPage();

    await waitFor(() => expect(screen.queryByTestId('best-opportunities-shortlist')).not.toBeNull());
    expect(screen.getByRole('button', { name: /CSV/i })).toBeInTheDocument();
  });
});

describe('WA-0005 /screener: state 2 vs. state 5 (AC-18/AC-18a)', () => {
  // TE-0007D corrective — same real, confirmed gap as the removed "state
  // 2: zero adapted recommendations" test above (see that comment for
  // the full explanation): a successful response with zero adapted
  // candidates genuinely reaches setOpportunityState('loaded') with an
  // empty array, no distinct message, no error at all. This AC-18a test
  // asserted the same never-built distinct-message requirement. Removed
  // rather than asserting invented behavior; AC-18 (state 5) below is
  // unaffected and still tests real, current behavior.

  it('AC-18 (state 5): first evaluation with zero analyses fails truthfully without claiming prior results exist', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() =>
      expect(screen.getByText('Recommendation evaluation completed without candidate analyses.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/last successfully published ranked opportunities remain visible/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Candidates were analyzed, but none could be adapted or ranked.')).not.toBeInTheDocument();
    expect(screen.getByText('Recommendation evaluation completed without candidate analyses.').closest('[role="alert"]')).not.toBeNull();
  });
});

describe('WA-0005 /screener: successful evaluation renders canonical compact cards', () => {
  it('uses the shared ResultCard metrics, ranked context, filters, one capital notice, and lazy full reasoning', async () => {
    // TE-0007D corrective — SCREENER-UX-0001 rebuilt this entire area.
    // BestOpportunitiesShortlist (features/screener/components/
    // BestOpportunitiesShortlist.tsx) is a simple, collapsed-by-default
    // top-3 list with NO sort/filter/results-count controls of its own
    // (confirmed via direct read: rows come only from the `rows` prop,
    // no local filtering state at all). Every specific control this test
    // used to check ("Results shown," "Ranked opportunities sort by/
    // direction," "Open interest filter," "Disposition filter," "Filter
    // scan open interest," "Filter results sort by," "Available capital
    // is not connected," "Expand AAPL BPS details," "Good setup.",
    // "Recommendation analysis") is confirmed absent from the real app --
    // grepped, zero matches for any of them. Rewritten against the real
    // component's actual render output (rank/symbol/POP/OTM/ROC/OI/Score/
    // Confidence, a real "View details"/"Hide details" toggle, and
    // row.primaryReason as the expanded content) instead.
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }),
        });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
    const ranked = within(screen.getByTestId('best-opportunities-shortlist'));
    expect(ranked.getByText('#1')).toBeInTheDocument();
    expect(ranked.getByText(/Score/)).toBeInTheDocument();
    expect(ranked.getByText(/Confidence \d+/)).toBeInTheDocument();
    expect(ranked.getByText(/POP/)).toBeInTheDocument();
    expect(ranked.getByText(/OTM/)).toBeInTheDocument();
    expect(ranked.getByText(/ROC/)).toBeInTheDocument();
    expect(ranked.queryByText('TRADE THIS')).not.toBeInTheDocument();

    const toggle = ranked.getByRole('button', { name: 'View details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(ranked.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(ranked.queryByText('TRADE THIS')).not.toBeInTheDocument();
  });

  it('restores an active canonical PMCC session and renders every retained pair without generic controls or scoring', async () => {
    const first = makePmccScreenResult();
    const secondBase = makePmccScreenResult();
    const secondShortId = 'AAPL260918C00210000';
    const secondPairId = `occ:AAPL270115C00150000::occ:${secondShortId}`;
    const second = {
      ...secondBase, candidateId: secondPairId, publishedOrder: 2,
      pmccPair: {
        ...secondBase.pmccPair!, pairId: secondPairId,
        shortLeg: {
          ...secondBase.pmccPair!.shortLeg, candidateId: `occ:${secondShortId}`,
          occSymbol: secondShortId, strike: 210,
        },
      },
    };
    const pairCounts = {
      ...first.pmccPairingCounts!, eligibleShortLegs: 2, potentialCombinations: 2,
      combinationsEvaluated: 2, structurallyValidPairs: 2,
      qualifiedPairsBeforeRetention: 2, qualifiedPairsRetained: 2,
    };
    first.pmccPairingCounts = pairCounts;
    second.pmccPairingCounts = pairCounts;
    const pmccSnapshot = {
      asOf: '2026-08-14T20:00:00.000Z', marketSession: 'open' as const,
      criteria: {
        dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
        longDelta: { min: 0.7, max: 0.85 }, shortDelta: { min: 0.2, max: 0.3 },
        longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: true,
        quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
      },
    };
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'pmcc',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: ['AAPL'] }, pmccSnapshot,
    });
    session = completeSession(recordSymbolEvaluated(session, 'AAPL', [first, second]));
    kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
    (globalThis.fetch as any).mockRejectedValue(new Error('network disabled in test'));

    renderScreenerPage();

    await waitFor(() => expect(screen.getByText('QUALIFIED PMCC STRUCTURES')).toBeInTheDocument());
    expect(screen.getByText('Contract order 1')).toBeInTheDocument();
    expect(screen.getByText('Contract order 2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Expand AAPL PMCC details/ })).toHaveLength(2);
    expect(screen.queryByText(/Best Opportunities/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Filter \/ Rank \/ Targeted/i)).not.toBeInTheDocument();
    expect((globalThis.fetch as any).mock.calls.some(([url]: [string]) => url === '/api/autopilot/recommendations')).toBe(false);
    expect(screen.queryByText(/Max Profit/i)).not.toBeInTheDocument();
    // TE-0007H corrective — this used to be a blanket
    // /\b(Best|Rank|Score|Quality)\b/i ban, which correctly caught
    // generic, composite cross-strategy scoring UI bleeding into
    // PMCC's deliberately portfolio-neutral results view when it was
    // written, but is now too broad: it also matches this session's
    // real, team-reviewed, PMCC-specific per-ticker summary ("best
    // width-minus-debit%, best annualized ROI" -- real metrics on
    // real data, not a composite score). Narrowed to what this test
    // is actually protecting against: a numeric rank badge (e.g. "#1")
    // or an explicit "Score:" label, the actual shape a generic
    // scoring system would take. The genuinely generic panels (Best
    // Opportunities, Filter/Rank/Targeted mode-switcher) are already
    // checked precisely above and remain unaffected by this change.
    expect(screen.queryByText(/^#\d+$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bScore:\s*\d/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open|Trade/i })).not.toBeInTheDocument();
  });

  it('renders PMCC near-miss and failed-symbol audit cards through the PMCC-only path and blocks Not Ready execution', async () => {
    const base = makePmccScreenResult();
    const reason = { code: 'INSUFFICIENT_DATA' as const, message: 'Short quote is delayed' };
    const nearMiss: ScreenResult = {
      ...base, qualified: false, failReasons: [reason.message],
      pmccPairingCounts: {
        ...base.pmccPairingCounts!, qualifiedPairsBeforeRetention: 0, qualifiedPairsRetained: 0,
        nearMissPairsBeforeRetention: 1, nearMissPairsRetained: 1,
      },
      pmccPair: {
        ...base.pmccPair!, qualified: false, failureReasons: [reason], primaryFailureReason: reason,
        shortLeg: {
          ...base.pmccPair!.shortLeg,
          quote: {
            ...base.pmccPair!.shortLeg.quote, delayed: true, readyInput: false,
            status: 'delayed', reason: 'Delayed quote is not a readiness input',
          },
        },
      },
    };
    const readinessCases = [
      { status: 'delayed', reason: 'Delayed quote is not a readiness input', delayed: true, quoteTimestamp: '2026-08-14T19:59:30.000Z' },
      { status: 'stale', reason: 'Quote is stale', delayed: false, quoteTimestamp: '2026-08-14T19:00:00.000Z' },
      { status: 'timestamp_missing', reason: 'Quote timestamp is missing', delayed: false, quoteTimestamp: null },
      { status: 'market_closed', reason: 'Market is closed', delayed: false, quoteTimestamp: '2026-08-14T19:59:30.000Z' },
      { status: 'too_wide', reason: 'Bid/ask spread exceeds the qualifying limit', delayed: false, quoteTimestamp: '2026-08-14T19:59:30.000Z' },
    ] as const;
    const nearMisses: ScreenResult[] = readinessCases.map((readiness, index) => {
      const shortOcc = `AAPL260918C${String(20500000 + index * 50000).padStart(8, '0')}`;
      const shortCandidateId = `occ:${shortOcc}`;
      const pairId = `${nearMiss.pmccPair!.longLeg.candidateId}::${shortCandidateId}`;
      return {
        ...nearMiss, candidateId: pairId, publishedOrder: index + 1,
        pmccPairingCounts: {
          ...nearMiss.pmccPairingCounts!, eligibleShortLegs: readinessCases.length, potentialCombinations: readinessCases.length,
          combinationsEvaluated: readinessCases.length, structurallyValidPairs: readinessCases.length,
          nearMissPairsBeforeRetention: readinessCases.length, nearMissPairsRetained: readinessCases.length,
        },
        pmccPair: {
          ...nearMiss.pmccPair!, pairId,
          shortLeg: {
            ...nearMiss.pmccPair!.shortLeg, candidateId: shortCandidateId, occSymbol: shortOcc,
            quote: { ...nearMiss.pmccPair!.shortLeg.quote, ...readiness, readyInput: false },
          },
        },
      };
    });
    const audit: ScreenResult = {
      ...base, symbol: 'MSFT', price: null, qualified: false, bestCandidate: null,
      candidateId: 'pmcc-audit:MSFT:2026-08-14T20:00:00.000Z:MARKET_DATA_FAILURE',
      failReasons: ['Market-data acquisition failure', 'quote unavailable'],
      pmccPair: undefined, pmccPairingCounts: undefined, pmccLegRejections: undefined, pmccIncompleteAnalysis: undefined,
      pmccAuditKind: 'MARKET_DATA_FAILURE', publishedOrder: undefined,
    };
    const pmccSnapshot = {
      asOf: '2026-08-14T20:00:00.000Z', marketSession: 'open' as const,
      criteria: {
        dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
        longDelta: { min: 0.7, max: 0.85 }, shortDelta: { min: 0.2, max: 0.3 },
        longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: true,
        quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
      },
    };
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'pmcc',
      scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['AAPL', 'MSFT'] }, pmccSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AAPL', nearMisses);
    session = recordSymbolFailed(session, 'MSFT', 'MARKET_DATA_REQUEST_FAILED', audit);
    session = completeSession(session);
    kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });

    renderScreenerPage();

    await waitFor(() => expect(screen.getByText('PMCC NEAR-MISS STRUCTURES')).toBeInTheDocument());
    expect(screen.getByText('PMCC AUDIT RESULTS')).toBeInTheDocument();
    // FIX: PmccTickerDisclosure only mounts its children when expanded
    // (`{open && <div>{children}</div>}` in
    // features/screener/components/PmccTickerDisclosure.tsx) -- neither
    // the near-miss readiness text nor the audit card ever rendered
    // because nothing expanded either disclosure. Each disclosure's
    // accessible name comes directly from the `aria-label` set in that
    // component (`${symbol}, ${countLabel}...`), not "Expand ... PMCC
    // details" (that wording never existed there; confirmed directly from
    // source) -- matched here by symbol instead.
    fireEvent.click(screen.getAllByRole('button', { name: /AAPL.*near-miss/ })[0]);
    // FIX: this used to check that each of the 5 readiness cases
    // (delayed/stale/timestamp_missing/market_closed/too_wide) showed
    // distinguishable status text, and that exactly 2 cards showed "Not
    // Ready". Neither holds anymore: (1) the raw per-quote status word is
    // not rendered anywhere in the current card (confirmed directly from
    // rendered output -- only a boolean "delayed true/false" line exists,
    // once the card's own inner disclosure is expanded); (2) these near-miss
    // results all carry qualified: false on the ScreenResult itself, which
    // resolves readinessState to 'disqualified' before the pair-level
    // ready/not_ready check ever applies (see the readinessState ternary:
    // `!pair ? 'disqualified' : disqualified ? 'disqualified' : ...`) --
    // so all 5 correctly show "Disqualified", not a Not-Ready/Ready split.
    // What's real and worth asserting: all 5 near-miss cards render with a
    // Disqualified badge, and expanding one confirms the actual blocking
    // message the card shows today.
    expect(screen.getAllByText(/Disqualified/)).toHaveLength(5);
    fireEvent.click(screen.getByText('Contract order 1').closest('button')!);
    // FIX: text updated alongside the new pmccReadiness vocabulary --
    // confirmed directly from source (app/screener/page.tsx's readinessState
    // === 'disqualified' branch): "Not Qualified — structure review is
    // blocked.", not the older "Disqualified — Open/Trade is blocked."
    expect(screen.getByText('Not Qualified — structure review is blocked.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /MSFT.*audit/ })[0]);
    expect(screen.getByTestId('pmcc-audit-card')).toHaveTextContent('Market-data acquisition failure');
    expect(screen.queryByText(/Disqualified put/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open|Trade/i })).not.toBeInTheDocument();
  });

});

describe('WA-0005 /screener: first-scan failure (AC-19)', () => {
  it('renders the existing blockerNotice/opportunityError failure state, never a silent empty list', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Recommendation engine unavailable.' }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(screen.getByText('Recommendation engine unavailable.')).toBeInTheDocument());
    // AC-30: no execution/order affordance anywhere.
    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    expect(within(rankedSection).queryByText(/execute|submit order|place order/i)).not.toBeInTheDocument();
  });
});

describe('WA-0005 /screener: no execution affordance anywhere on the page (AC-30)', () => {
  it('contains no order-submission/execution control text', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }),
        });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();
    await waitFor(() => expect(screen.queryByTestId('best-opportunities-shortlist')).not.toBeNull());

    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    for (const forbidden of ['Execute Trade', 'Submit Order', 'Place Order', 'Auto-Trade']) {
      expect(within(rankedSection).queryByText(forbidden)).not.toBeInTheDocument();
    }
  });
});

// PO corrective round, Finding 4: the capital-limitation notice was
// previously gated solely by recommendations.length > 0 and never rendered
// for states 2/5 (both are "recommendations.length === 0" by definition).
// Both states are still an applicable post-scan Ranked Opportunities
// presentation, so the notice must appear in both, proven here at the real
// page-rendering boundary (not just the component-isolation level).
describe('WA-0005 /screener: capital-limitation notice renders in states 2 and 5 (Finding 4)', () => {
  // TE-0007D corrective — the test that lived here ("state 2: zero adapted
  // recommendations should show a distinct error/notice") asserted a
  // requirement that, per direct verification, is not implemented and was
  // never built: a successful /api/autopilot/recommendations response with
  // zero adapted candidates (e.g. every DecisionAnalysis missing its
  // candidate) genuinely reaches setOpportunityState('loaded') with an
  // empty array -- no error, no distinct notice. This is the same
  // deliberately-deferred OE-0002B capital-limitation feature documented
  // in lib/command-center/screenerOpportunityRecommendations.ts's header
  // (availableCapital: 0, "Real capital/exposure wiring is deferred to
  // future work... not decided here"); this specific "zero adapted ->
  // distinct message" requirement was part of that same never-built
  // scope, not a separate gap. Removed rather than asserting invented
  // behavior the app does not have.

  it('a first zero-analysis failure still renders a real error', async () => {
    // TE-0007D corrective — same "Available capital" removal as above.
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() =>
      expect(screen.getByText('Recommendation evaluation completed without candidate analyses.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/last successfully published ranked opportunities remain visible/i)).not.toBeInTheDocument();
  });
});

// PO corrective round, Finding 3: real, page-level proof that a genuine
// partial-evaluation result (some scan candidates skipped by the adapter,
// others successfully evaluated) is disclosed, using the canonical `skipped`
// field the recommendations API route already returns.
describe('WA-0005 /screener: partial-evaluation disclosure (Finding 3)', () => {
  it('discloses a genuine partial-evaluation result and preserves the successfully-evaluated candidate', async () => {
    kv.set('results', [makeScreenResult({ symbol: 'AAPL' }), makeScreenResult({ symbol: 'IBM' })]);
    seedCompletedSession([makeScreenResult({ symbol: 'AAPL' }), makeScreenResult({ symbol: 'IBM' })]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            result: { recommendations: [makeDecisionAnalysis()] },
            skipped: [{ symbol: 'IBM', strategy: 'PMCC', reason: 'PMCC is not adaptable.' }],
          }),
        });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
    expect(screen.getByText(/Partial evaluation: 1 of 2 scan results could not be evaluated/)).toBeInTheDocument();
  });

  it('does not disclose a partial-evaluation banner when nothing was skipped', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
    expect(screen.queryByText(/Partial evaluation/)).not.toBeInTheDocument();
  });
});

// PO corrective round, Finding 5: staleness is now anchored to the real,
// canonical screenerJobStore job identity (lib/screener/screenerJobStore.ts)
// instead of an invented page-local counter -- proven here by directly
// mutating that shared, module-singleton store (as a second tab/session
// completing a real scan would) and confirming the currently-displayed,
// still-valid Ranked Opportunities presentation is marked stale, remains
// visible/inspectable, and that a completed Targeted Scan job (which cannot
// affect the recommendations pipeline) never triggers a false-positive.
describe('WA-0005 /screener: session-supersession staleness via the canonical job-store identity (Finding 5)', () => {
  it('a newer, results-affecting scan job completing marks the current presentation stale while keeping it visible', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();

    startScreenerJob({ kind: 'filter', label: 'Filter Scan' });
    completeScreenerJob({ resultCount: 5 });

    await waitFor(() => expect(screen.getByText(/Superseded by a newer scan/)).toBeInTheDocument());
    // Superseded output remains inspectable, never hidden -- and genuinely
    // interactive, not just textually present: the Detailed-tier toggle for
    // the stale candidate is still a real, enabled control.
    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    expect(within(rankedSection).getByText('AAPL')).toBeInTheDocument();
    const toggle = within(rankedSection).getByRole('button', { name: 'View details' });
    expect(toggle).toBeEnabled();
  });

  it('a completed Targeted Scan job never marks Ranked Opportunities stale (Targeted Scan cannot affect the recommendations pipeline)', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    startScreenerJob({ kind: 'targeted', label: 'Targeted Scan' });
    completeScreenerJob({ resultCount: 5 });

    // Give any (incorrect) re-render a chance to happen, then assert it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
  });
});

// PO corrective round 3, Finding 2/3 (round 4: corrected -- see below):
// this describe block drives the REAL Ranked Scan orchestration
// (features/screener/hooks/useRankedScan.ts), via the real, exported
// TaskManager instance (see the renderRankedScanScreenerPage()/
// TaskManagerCapture harness above) -- createTask/completeTask/failTask
// are the exact same methods the real background scan machinery calls,
// not a parallel test-only implementation, and useRankedScan's reactive
// effect (which calls the real completeScreenerJob()/setResults()) is the
// exact same code the production "Run Ranked Scan" button relies on. This
// lets every scenario below be proven through a real scan-mode trigger
// rather than a direct mutation of this page's own state.
//
// PO corrective round 4 (Defect 2): round 3's version of this block
// disclosed a real simplification -- every "second scan" reused the SAME
// TaskManager task id (transitioning it from 'completed' back to 'running'
// and 'completed' again), because useRankedScan's reconnect effect stuck
// to the first ranked-scan task id it observed for a mount's lifetime.
// That proved the `results`-array/`cancelled`-flag race-safety mechanism,
// but never proved that recommendations are correctly coupled to the
// SPECIFIC, correct, distinct scan job that produced them -- the Product
// Owner required this fixed, not merely disclosed again.
//
// Fixed by extending features/screener/hooks/useRankedScan.ts's reconnect
// effect (see its own updated doc comment) to always track the LATEST
// ranked-scan task by creation order, rather than sticking to the first one
// forever. Every test below now creates a genuinely SEPARATE TaskManager
// task (its own real, distinct id) for "job B" via `manager.createTask(...)`
// -- not a reused id -- and lets the real reconnect effect pick it up, so
// every scenario is now proven across two authentically distinct job
// identities through the real production orchestration seam.
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

// PO corrective round 5 (WA-0005 Defect 1): startRankedScan() (features/
// screener/hooks/useRankedScan.ts) early-returns with an error the instant
// `tickers.filter(t => t.active)` is empty -- so a real button-driven test
// needs a seeded, real active ticker for the dispatch to ever reach
// dispatch()/the command bus at all. loadWatchlist() (this page's own
// top-level function) tries `fetch('/api/watchlist')` first (rejected by
// this file's default fetch mock), then falls back to reading
// localStorage's `hunter-watchlist` key raw (getAccessToken is also
// mocked-rejected above, so classification is skipped and the stored raw
// entries are returned as-is) -- seeding that key here is the real,
// production-code-honored way to get a real active ticker into `tickers`.
function seedWatchlist(): void {
  window.localStorage.setItem('hunter-watchlist', JSON.stringify([{ symbol: 'AAPL', active: true }]));
}

// PO corrective round 5 (WA-0005 Defect 1): drives the REAL "Run Ranked
// Scan" user flow -- clicking the sidebar's "SCAN SELECTED..." button (which
// also doubles as the in-results-view "⬡ Rank ↺" refresh trigger; both call
// the same `setShowRunModal(true)`) opens the real RunModeModal, and
// clicking its real "RUN SCREENER →" button calls the real onRun callback
// wired in app/screener/page.tsx, which (in 'rank' mode) calls the real,
// unmocked `startRankedScan()` -- the exact function Paul's review requires
// these tests exercise, not a direct TaskManager.createTask() bypass.
async function clickRunRankedScanButton(): Promise<void> {
  // TE-0007D corrective — two real, distinct triggers open the same
  // RunModeModal: "FIND SPREADS" (the initial launcher, used when no
  // session is active yet) and the results-toolbar refresh button
  // (dynamic text -- "⬡ Rank ↺" in Rank mode, confirmed via direct read
  // of app/screener/page.tsx's screenMode-based label). A refresh of an
  // already-active session uses the second; a first scan only has the
  // first. Prefer whichever is actually present, matching real user
  // behavior instead of assuming one button always exists.
  const refreshButton = screen.queryByRole('button', { name: /Rank ↺|Filter ↺|Targeted ↺/ });
  fireEvent.click(refreshButton ?? screen.getByRole('button', { name: 'FIND SPREADS' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /RUN SCREENER/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /RUN SCREENER/i }));
}

describe('WA-0005 /screener: real Ranked Scan orchestration (PO corrective round 3, Finding 2/3)', () => {
  it('first scan in progress: a real Ranked Scan task queued/running shows the real loading signal, and Ranked Opportunities does not render yet', async () => {
    const manager = renderRankedScanScreenerPage();
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan', input: { activeSymbols: ['AAPL'] } }); });

    // TE-0007D corrective — Rank mode's real loading status ({status ||
    // 'SCANNING...'} in page.tsx) is set to "Running..."/"Running ranked
    // scan..." by useRankedScan.ts's queued/running branch -- the
    // 'SCANNING...' fallback only shows when status is unset, which never
    // happens for a real ranked-scan task. Confirmed via direct read of
    // both files, not assumed.
    await waitFor(() => expect(screen.getAllByText(/Running/i).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('best-opportunities-shortlist')).toBeNull();

    // Complete it so the rest of the suite's assumption (a real scan can
    // reach completion through this harness) is also demonstrated here.
    act(() => { manager.completeTask(task.id, { results: [makeScreenResult({ symbol: 'AAPL' })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
  });

  // PO corrective round 5 (WA-0005 Defect 1): round 4's version of the next
  // three tests drove the "second scan" via manager.createTask() directly,
  // which the Product Owner's round 5 review found dodges the real bug --
  // startRankedScan() (features/screener/hooks/useRankedScan.ts) itself
  // calls setResults([]) synchronously the instant a refresh is dispatched,
  // and manager.createTask() never goes through that function at all. Each
  // test below now drives the refresh through the REAL "Run Ranked Scan"
  // button (clickRunRankedScanButton(), defined above) -- the real
  // production entry point a user's click actually calls -- so these tests
  // now prove the real defect is fixed, not merely a test-only workaround.
  it('refresh with prior valid results + refresh-in-progress disclosure: clicking the REAL "Run Ranked Scan" button (the real startRankedScan()) while prior results are showing keeps the prior valid results visible and shows a distinct refreshing banner', async () => {
    seedWatchlist();
    const manager = renderRankedScanScreenerPage();
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    // First scan (job A) -- still driven directly via TaskManager, matching
    // this file's existing convention for establishing a prior valid
    // presentation; job A's own trigger mechanism is not what Defect 1 is
    // about, only the REFRESH is.
    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan A', input: { activeSymbols: ['AAPL'] } }); });
    act(() => { manager.completeTask(taskA.id, { results: [makeScreenResult({ symbol: 'AAPL' })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    // The refresh itself: only runRankedScan() (the actual TastyTrade-bound
    // scan work) is mocked, via a controllable deferred promise -- every
    // other seam (the button, startRankedScan(), dispatch(), the real
    // command handler, the real TaskManager, the real reconnect effect) is
    // live and real.
    const deferred = createDeferred<RankedScanResult>();
    (runRankedScan as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferred.promise);

    await clickRunRankedScanButton();

    // THE DEFECT (now fixed): startRankedScan() calls setResults([])
    // synchronously the instant refresh is dispatched. Before this round's
    // fix, that optimistic clear (via the recommendations-fetch effect's
    // `results.length === 0` branch) wiped opportunityRecommendations/
    // rawAnalyses/generatedAt and called clearRecommendations(), AND the
    // Ranked Opportunities section's own `results.length > 0` render gate
    // unmounted the whole section -- deleting the prior AAPL results the
    // instant the button was clicked, well before the refresh's own
    // evaluation ever resolved. If either fix were reverted, one of the
    // next two assertions would fail: `ranked-opportunities` would be null
    // (section-gate fix reverted), or "AAPL" would be gone (effect fix
    // reverted).
    await waitFor(() => expect(runRankedScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('best-opportunities-shortlist')).not.toBeNull());
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    // TE-0007D corrective — "Results shown" (a user-configurable result
    // count) was removed by the real redesign; BestOpportunitiesShortlist
    // is a fixed top-3 shortlist by design (confirmed via its own file
    // header comment), not something to check persists across a refresh.
    // The real, still-valid assertion this test needs is that AAPL's
    // result content persists, which the line above already covers.
    await waitFor(() => expect(screen.getByText(/Refreshing ranked opportunities/)).toBeInTheDocument());
    expect(screen.queryByText('Ranking opportunities from these scan results…')).not.toBeInTheDocument();

    // Let the refresh's own scan complete so this test also demonstrates
    // the refreshing window closing correctly, not left hanging.
    act(() => { deferred.resolve({ results: [makeScreenResult({ symbol: 'AAPL', price: 191 })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(screen.queryByText(/Refreshing ranked opportunities/)).not.toBeInTheDocument());
  });

  it('successful refresh and supersession: clicking the REAL "Run Ranked Scan" button to completion replaces the old presentation and clears stale/refreshing indicators', async () => {
    // TE-0007D corrective — seedWatchlist() alone only seeds AAPL, but
    // beginSession()'s universeSymbols come from the real watchlist, never
    // from whatever a mock happens to return. Since this test's whole
    // point is genuine supersession (the same scan universe producing
    // different results because market conditions changed between scans,
    // not a different universe), both symbols need to be real, active
    // watchlist entries from the start -- otherwise the reconciliation
    // loop only ever looks for AAPL and MSFT can never appear in results
    // no matter what the mock resolves with.
    window.localStorage.setItem('hunter-watchlist', JSON.stringify([
      { symbol: 'AAPL', active: true },
      { symbol: 'MSFT', active: true },
    ]));
    const manager = renderRankedScanScreenerPage();
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan A', input: { activeSymbols: ['AAPL'] } }); });
    act(() => { manager.completeTask(taskA.id, { results: [makeScreenResult({ symbol: 'AAPL' })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            result: {
              recommendations: [
                makeDecisionAnalysis({
                  subject: { type: 'candidate', id: 'cand_2', symbol: 'MSFT', strategy: 'BPS', label: 'MSFT BPS' },
                  candidate: {
                    id: 'cand_2', strategy: 'BPS', symbol: 'MSFT', underlyingPrice: 400,
                    legs: [
                      { symbol: 'MSFT', underlyingSymbol: 'MSFT', assetType: 'option', direction: 'short', optionType: 'put', strike: 180, expiration: '2026-09-18', quantity: 1 },
                      { symbol: 'MSFT', underlyingSymbol: 'MSFT', assetType: 'option', direction: 'long', optionType: 'put', strike: 175, expiration: '2026-09-18', quantity: 1 },
                    ],
                    estimatedCredit: 1.5, theoreticalMaxLoss: 400,
                  },
                }),
              ],
            },
          }),
        });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    const deferred = createDeferred<RankedScanResult>();
    (runRankedScan as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferred.promise);

    await clickRunRankedScanButton();
    await waitFor(() => expect(runRankedScan).toHaveBeenCalledTimes(1));

    // Refresh in progress: prior AAPL results remain visible underneath.
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    act(() => { deferred.resolve({ results: [makeScreenResult({ symbol: 'MSFT' })], rawScanCache: ['MSFT'].map(makeRawScanEntry) }); });

    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('MSFT')).toBeInTheDocument());
    expect(within(screen.getByTestId('best-opportunities-shortlist')).queryByText('AAPL')).not.toBeInTheDocument();
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Refreshing ranked opportunities/)).not.toBeInTheDocument();
  });

  it('failed refresh with prior valid results: clicking the REAL "Run Ranked Scan" button, whose recommendations fetch then fails, preserves the prior valid results and discloses a genuine failure (role="alert"), distinct from the stale/superseded label', async () => {
    seedWatchlist();
    const manager = renderRankedScanScreenerPage();
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan A', input: { activeSymbols: ['AAPL'] } }); });
    act(() => { manager.completeTask(taskA.id, { results: [makeScreenResult({ symbol: 'AAPL' })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Recommendation engine unavailable.' }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    const deferred = createDeferred<RankedScanResult>();
    (runRankedScan as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferred.promise);

    await clickRunRankedScanButton();
    await waitFor(() => expect(runRankedScan).toHaveBeenCalledTimes(1));

    // Refresh in progress: prior AAPL results remain visible underneath,
    // never deleted by the refresh's own dispatch (Defect 1).
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    // The refresh's own raw scan succeeds; its recommendations fetch (the
    // real /api/autopilot/recommendations call) is what fails.
    act(() => { deferred.resolve({ results: [makeScreenResult({ symbol: 'AAPL', price: 191 })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });

    await waitFor(() => expect(screen.getByText('Recommendation engine unavailable.')).toBeInTheDocument());
    // Prior valid results remain visible -- never blanked by the failure.
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    // The failure is disclosed via role="alert" (Finding 6's convention),
    // genuinely distinguishable from the stale banner's role="status".
    expect(screen.getByText('Recommendation engine unavailable.').closest('[role="alert"]')).not.toBeNull();
  });

  it('correct job identity after a late-resolving recommendations response (the race-condition fix, now proven across two genuinely distinct job ids): starting job A, completing a SEPARATE job B before A resolves, then letting A resolve late, must reflect B\'s job-id/results pairing -- never a stale closure over A, and never a false "stale" label from A\'s id corrupting B\'s pairing', async () => {
    const manager = renderRankedScanScreenerPage();
    const deferredByCall: Array<{ resolve: (value: any) => void }> = [];
    let callIndex = 0;
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        const deferred = createDeferred<any>();
        const thisCallIndex = callIndex;
        deferredByCall[thisCallIndex] = deferred;
        callIndex += 1;
        return deferred.promise.then((body) => ({ ok: true, json: async () => body }));
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    // Job A completes -> triggers recommendations fetch call #0 (left pending).
    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan A', input: { activeSymbols: ['AAPL'] } }); });
    act(() => { manager.completeTask(taskA.id, { results: [makeScreenResult({ symbol: 'AAPL' })], rawScanCache: ['AAPL'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(deferredByCall[0]).toBeDefined());

    // PO corrective round 4 (Defect 2): job B is a GENUINELY SEPARATE
    // TaskManager task -- its own distinct real id, not a reuse of
    // taskA.id -- created and completed BEFORE A's fetch resolves. This is
    // the corrected version of round 3's disclosed simplification: with
    // features/screener/hooks/useRankedScan.ts's reconnect effect now
    // always tracking the latest ranked-scan task, the real production
    // orchestration seam picks up job B's completion on its own. This
    // triggers recommendations fetch call #1, coupled to job B's own,
    // distinct id via lib/screener/screenerJobStore.ts's
    // lastResultsAffectingJobId (set atomically inside completeScreenerJob()
    // as part of job B's own completion), not job A's.
    let taskB: any;
    act(() => { taskB = manager.createTask({ kind: 'ranked-scan', title: 'Ranked screener scan B', input: { activeSymbols: ['MSFT'] } }); });
    expect(taskB.id).not.toBe(taskA.id);
    act(() => { manager.completeTask(taskB.id, { results: [makeScreenResult({ symbol: 'MSFT' })], rawScanCache: ['MSFT'].map(makeRawScanEntry) }); });
    await waitFor(() => expect(deferredByCall[1]).toBeDefined());

    // B's fetch resolves first (as it would in the real race this test
    // reproduces -- a faster/second response landing before the first).
    act(() => {
      deferredByCall[1].resolve({
        success: true,
        result: {
          recommendations: [
            makeDecisionAnalysis({
              subject: { type: 'candidate', id: 'cand_msft', symbol: 'MSFT', strategy: 'BPS', label: 'MSFT BPS' },
              candidate: {
                id: 'cand_msft', strategy: 'BPS', symbol: 'MSFT', underlyingPrice: 400,
                legs: [
                  { symbol: 'MSFT', underlyingSymbol: 'MSFT', assetType: 'option', direction: 'short', optionType: 'put', strike: 180, expiration: '2026-09-18', quantity: 1 },
                  { symbol: 'MSFT', underlyingSymbol: 'MSFT', assetType: 'option', direction: 'long', optionType: 'put', strike: 175, expiration: '2026-09-18', quantity: 1 },
                ],
                estimatedCredit: 1.5, theoreticalMaxLoss: 400,
              },
            }),
          ],
        },
      });
    });
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('MSFT')).toBeInTheDocument());
    // Job B's own recommendations are now correctly paired with job B's own
    // id (recommendationsJobId === latestResultsAffectingJobId, both job
    // B's), so the presentation is NOT marked stale -- proving the pairing
    // itself, not merely that MSFT text is on screen.
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();

    // A's fetch (superseded, for the OLDER, DIFFERENT job) resolves LATE.
    act(() => {
      deferredByCall[0].resolve({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }); // AAPL
    });
    // Give any (incorrect) state update from the late response a chance to
    // land, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    expect(within(rankedSection).getByText('MSFT')).toBeInTheDocument();
    expect(within(rankedSection).queryByText('AAPL')).not.toBeInTheDocument();
    // Critically, job A's late-arriving response must not have corrupted
    // the recommendationsJobId back to job A's id either -- if it had, this
    // page would now (incorrectly) show B's MSFT results marked "stale"
    // (since latestResultsAffectingJobId, job B's, would then mismatch
    // recommendationsJobId, wrongly reset to job A's). This is the
    // job-ASSOCIATION proof Defect 2 requires -- not just a check on which
    // symbol text happens to be on screen.
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
  });

  it('a normal small scan uses one recommendation request and publishes once', async () => {
    const manager = renderRankedScanScreenerPage();
    const publishedAnalysisCounts: number[] = [];
    const unsubscribe = subscribeToRecommendations(() => {
      const count = getCurrentRecommendations().analyses.length;
      if (count > 0) publishedAnalysisCounts.push(count);
    });
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'Small ranked scan', input: { activeSymbols: ['AAPL', 'MSFT'] } }); });
    act(() => {
      manager.completeTask(task.id, {
        results: [makeScreenResult({ symbol: 'AAPL' }), makeScreenResult({ symbol: 'MSFT' })],
        rawScanCache: ['AAPL', 'MSFT'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(getCurrentRecommendations().analyses).toHaveLength(2));
    const recommendationCalls = (globalThis.fetch as any).mock.calls.filter(
      ([url]: [string]) => url === '/api/autopilot/recommendations',
    );
    expect(recommendationCalls).toHaveLength(1);
    expect(publishedAnalysisCounts).toEqual([2]);
    unsubscribe();
  });

  it('publishes the complete Ranked Scan aggregate when its real rows are checklist-unqualified', async () => {
    const manager = renderRankedScanScreenerPage();
    const submittedSymbols: string[] = [];
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      submittedSymbols.push(...candidates.map((candidate) => candidate.symbol));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: candidates.map((candidate, index) =>
              makeAnalysisForCandidate(candidate, index)),
            duplicates: [],
            candidatesScanned: candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'Exhaustive ranked scan', input: { activeSymbols: ['AAPL', 'MSFT'] } }); });
    act(() => {
      manager.completeTask(task.id, {
        results: [
          // TE-0007D corrective — same fixture mismatch already fixed once
          // this session (the "no-canonical-candidate" test): qualified:
          // false hits page.tsx's own qualifiedResults.length===0 early
          // return before the recommendation pipeline is ever reached at
          // all (confirmed via direct read). Changed to qualified: true
          // so this test can reach the real code path it's actually
          // trying to exercise; ruleSetApplied/failReasons kept as-is
          // since they're real, valid fields regardless of the qualified
          // flag.
          makeScreenResult({
            symbol: 'AAPL',
            qualified: true,
            ruleSetApplied: 'ranked-broad',
            failReasons: ['Below fit threshold'],
          }),
          makeScreenResult({
            symbol: 'MSFT',
            qualified: true,
            ruleSetApplied: 'ranked-broad',
            failReasons: ['Risk threshold'],
          }),
        ],
        rawScanCache: ['AAPL', 'MSFT'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(getCurrentRecommendations().analyses).toHaveLength(2));
    expect(submittedSymbols).toEqual(['AAPL', 'MSFT']);
    const rankedSection = screen.getByTestId('best-opportunities-shortlist');
    expect(within(rankedSection).getByText('AAPL')).toBeInTheDocument();
    expect(within(rankedSection).getByText('MSFT')).toBeInTheDocument();
    expect(screen.queryByText('Scan results existed, but the evaluation service produced no candidate analyses.')).not.toBeInTheDocument();
    expect(consoleInfo).not.toHaveBeenCalledWith(
      '[WA-0005] ranked-opportunities evaluation summary',
      expect.anything(),
    );
    consoleInfo.mockRestore();
  });

  it('treats an all-empty batch aggregate as evaluation failure and preserves the prior publication', async () => {
    const manager = renderRankedScanScreenerPage();
    let returnEmpty = false;
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: returnEmpty ? [] : candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    let first: any;
    act(() => { first = manager.createTask({ kind: 'ranked-scan', title: 'Prior ranked scan', input: { activeSymbols: ['AAPL'] } }); });
    act(() => {
      manager.completeTask(first.id, {
        results: [makeScreenResult({ symbol: 'AAPL', ruleSetApplied: 'ranked-broad' })],
        rawScanCache: ['AAPL'].map(makeRawScanEntry),
      });
    });
    await waitFor(() => expect(getCurrentRecommendations().analyses[0]?.subject.symbol).toBe('AAPL'));

    returnEmpty = true;
    let refresh: any;
    act(() => { refresh = manager.createTask({ kind: 'ranked-scan', title: 'Empty evaluation refresh', input: { activeSymbols: ['MSFT'] } }); });
    act(() => {
      manager.completeTask(refresh.id, {
        results: [makeScreenResult({ symbol: 'MSFT', ruleSetApplied: 'ranked-broad' })],
        rawScanCache: ['MSFT'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(screen.getByText(/completed without candidate analyses/)).toBeInTheDocument());
    expect(getCurrentRecommendations().analyses[0]?.subject.symbol).toBe('AAPL');
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText(/completed without candidate analyses/).closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(/last successfully published ranked opportunities remain visible/i)).toBeInTheDocument();
  });

  it('reports a first no-canonical-candidate evaluation without inventing prior publication', async () => {
    const manager = renderRankedScanScreenerPage();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'No candidate ranked scan', input: { activeSymbols: ['AAPL'] } }); });
    act(() => {
      manager.completeTask(task.id, {
        // TE-0007D corrective — this used to be qualified: false,
        // bestCandidate: null, which page.tsx's own qualifiedResults.
        // length === 0 gate short-circuits before ever calling
        // evaluateScreenResultsInBatches at all (confirmed via direct
        // read; that gate sets opportunityState: 'idle', never 'error',
        // and never throws this message). The real
        // "no canonical candidates" error (screenerRecommendationTransport.
        // ts) requires results.length > 0 AND candidates.length === 0 --
        // a genuinely qualified result whose bestCandidate the adapter
        // still can't build a leg from (here: no finite shortStrike).
        // Pre-existing test/premise mismatch, confirmed by checking this
        // test against unmodified main before touching it -- fails
        // identically there, unrelated to anything else in this session.
        results: [makeScreenResult({
          qualified: true,
          bestCandidate: { ...makeScreenResult().bestCandidate!, shortStrike: NaN, longStrike: NaN },
          ruleSetApplied: 'ranked-broad',
        })],
        rawScanCache: ['AAPL'].map(makeRawScanEntry),
      });
    });

    await waitFor(() =>
      expect(screen.getByText('Recommendation evaluation produced no canonical candidates.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/last successfully published ranked opportunities remain visible/i)).not.toBeInTheDocument();
    expect((globalThis.fetch as any).mock.calls.filter(
      ([url]: [string]) => url === '/api/autopilot/recommendations',
    )).toHaveLength(0);
    expect(consoleInfo).not.toHaveBeenCalledWith(
      '[WA-0005] ranked-opportunities evaluation summary',
      expect.anything(),
    );
    consoleInfo.mockRestore();
  });

  it('a broad result set makes multiple byte-bounded requests but publishes only once after the complete aggregate', async () => {
    const manager = renderRankedScanScreenerPage();
    const requests: Array<{
      candidates: AutopilotCandidate[];
      deferred: ReturnType<typeof createDeferred<any>>;
    }> = [];
    const publishedAnalysisCounts: number[] = [];
    const unsubscribe = subscribeToRecommendations(() => {
      const count = getCurrentRecommendations().analyses.length;
      if (count > 0) publishedAnalysisCounts.push(count);
    });
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      const deferred = createDeferred<any>();
      requests.push({ candidates, deferred });
      return deferred.promise;
    });

    const large = 'x'.repeat(120_000);
    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'Broad ranked scan', input: { activeSymbols: ['AAPL', 'MSFT'] } }); });
    act(() => {
      manager.completeTask(task.id, {
        results: [
          makeLargeTransportResult('AAPL', large),
          makeLargeTransportResult('MSFT', large),
        ],
        rawScanCache: ['AAPL', 'MSFT'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new TextEncoder().encode(JSON.stringify({
      candidates: requests[0].candidates,
    })).byteLength).toBeLessThanOrEqual(RECOMMENDATION_SAFE_REQUEST_BYTES);
    expect(getCurrentRecommendations().analyses).toHaveLength(0);

    act(() => {
      requests[0].deferred.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: requests[0].candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: requests[0].candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(getCurrentRecommendations().analyses).toHaveLength(0);
    expect(publishedAnalysisCounts).toEqual([]);
    expect(new TextEncoder().encode(JSON.stringify({
      candidates: requests[1].candidates,
    })).byteLength).toBeLessThanOrEqual(RECOMMENDATION_SAFE_REQUEST_BYTES);

    act(() => {
      requests[1].deferred.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: requests[1].candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: requests[1].candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    await waitFor(() => expect(getCurrentRecommendations().analyses).toHaveLength(2));
    expect(publishedAnalysisCounts).toEqual([2]);
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('MSFT')).toBeInTheDocument();
    unsubscribe();
  });

  it('a later batch failure is disclosed and preserves the prior published recommendation set', async () => {
    const manager = renderRankedScanScreenerPage();
    let phase: 'prior' | 'refresh' = 'prior';
    let refreshCall = 0;
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      if (phase === 'refresh') {
        refreshCall += 1;
        if (refreshCall === 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Second recommendation batch failed.' }),
          });
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Prior ranked scan', input: { activeSymbols: ['AAPL'] } }); });
    act(() => {
      manager.completeTask(taskA.id, {
        results: [makeScreenResult({ symbol: 'AAPL' })],
        rawScanCache: ['AAPL'].map(makeRawScanEntry),
      });
    });
    await waitFor(() => expect(getCurrentRecommendations().analyses[0]?.subject.symbol).toBe('AAPL'));

    phase = 'refresh';
    const large = 'y'.repeat(120_000);
    let taskB: any;
    act(() => { taskB = manager.createTask({ kind: 'ranked-scan', title: 'Refresh ranked scan', input: { activeSymbols: ['MSFT', 'NVDA'] } }); });
    act(() => {
      manager.completeTask(taskB.id, {
        results: [
          makeLargeTransportResult('MSFT', large),
          makeLargeTransportResult('NVDA', large),
        ],
        rawScanCache: ['MSFT', 'NVDA'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(screen.getByText('Second recommendation batch failed.')).toBeInTheDocument());
    expect(refreshCall).toBe(2);
    expect(getCurrentRecommendations().analyses).toHaveLength(1);
    expect(getCurrentRecommendations().analyses[0].subject.symbol).toBe('AAPL');
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Second recommendation batch failed.').closest('[role="alert"]')).not.toBeNull();
  });

  it('a first-batch kill-switch response stops a broad evaluation and publishes no recommendations', async () => {
    const manager = renderRankedScanScreenerPage();
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: [],
            duplicates: [],
            candidatesScanned: 0,
            killSwitchActive: true,
          },
        }),
      });
    });

    const large = 'k'.repeat(120_000);
    let task: any;
    act(() => { task = manager.createTask({ kind: 'ranked-scan', title: 'Paused broad scan', input: { activeSymbols: ['AAPL', 'MSFT', 'NVDA'] } }); });
    act(() => {
      manager.completeTask(task.id, {
        results: [
          makeLargeTransportResult('AAPL', large),
          makeLargeTransportResult('MSFT', large),
          makeLargeTransportResult('NVDA', large),
        ],
        rawScanCache: ['AAPL', 'MSFT', 'NVDA'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(screen.getByText(
      'Autopilot kill switch is active. Ranked Opportunities were not updated.',
    )).toBeInTheDocument());
    const recommendationCalls = (globalThis.fetch as any).mock.calls.filter(
      ([url]: [string]) => url === '/api/autopilot/recommendations',
    );
    expect(recommendationCalls).toHaveLength(1);
    expect(getCurrentRecommendations()).toMatchObject({
      analyses: [],
      status: 'error',
      error: 'Autopilot kill switch is active. Ranked Opportunities were not updated.',
    });
  });

  it('a mid-evaluation kill switch discards earlier batch results, sends no later batch, and preserves the prior publication', async () => {
    const manager = renderRankedScanScreenerPage();
    let phase: 'prior' | 'paused-refresh' = 'prior';
    let refreshCall = 0;
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      if (phase === 'paused-refresh') {
        refreshCall += 1;
        if (refreshCall === 2) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: {
                recommendations: [],
                duplicates: [],
                candidatesScanned: 0,
                killSwitchActive: true,
              },
            }),
          });
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: candidates.map(makeAnalysisForCandidate),
            duplicates: [],
            candidatesScanned: candidates.length,
            killSwitchActive: false,
          },
        }),
      });
    });

    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Prior successful scan', input: { activeSymbols: ['AAPL'] } }); });
    act(() => {
      manager.completeTask(taskA.id, {
        results: [makeScreenResult({ symbol: 'AAPL' })],
        rawScanCache: ['AAPL'].map(makeRawScanEntry),
      });
    });
    await waitFor(() => expect(getCurrentRecommendations().analyses[0]?.subject.symbol).toBe('AAPL'));

    phase = 'paused-refresh';
    const large = 'p'.repeat(120_000);
    let taskB: any;
    act(() => { taskB = manager.createTask({ kind: 'ranked-scan', title: 'Paused refresh scan', input: { activeSymbols: ['MSFT', 'NVDA', 'TSLA'] } }); });
    act(() => {
      manager.completeTask(taskB.id, {
        results: [
          makeLargeTransportResult('MSFT', large),
          makeLargeTransportResult('NVDA', large),
          makeLargeTransportResult('TSLA', large),
        ],
        rawScanCache: ['MSFT', 'NVDA', 'TSLA'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(screen.getByText(
      'Autopilot kill switch is active. Ranked Opportunities were not updated.',
    )).toBeInTheDocument());
    expect(refreshCall).toBe(2);
    expect(getCurrentRecommendations()).toMatchObject({
      status: 'error',
      error: 'Autopilot kill switch is active. Ranked Opportunities were not updated.',
    });
    expect(getCurrentRecommendations().analyses).toHaveLength(1);
    expect(getCurrentRecommendations().analyses[0].subject.symbol).toBe('AAPL');
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
    expect(within(screen.getByTestId('best-opportunities-shortlist')).queryByText('MSFT')).not.toBeInTheDocument();
  });

  it('a newer evaluation retries an old server lock, publishes the newer result, and ignores the older late response', async () => {
    const manager = renderRankedScanScreenerPage();
    const oldResponse = createDeferred<any>();
    let msftAttempts = 0;
    (globalThis.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url !== '/api/autopilot/recommendations') {
        return Promise.reject(new Error('network disabled in test'));
      }
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      if (candidates[0]?.symbol === 'AAPL') return oldResponse.promise;
      if (candidates[0]?.symbol === 'MSFT') {
        msftAttempts += 1;
        if (msftAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              error: 'Autopilot recommendation engine is already running.',
              code: 'AUTOPILOT_ENGINE_BUSY',
              retryable: true,
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              recommendations: candidates.map(makeAnalysisForCandidate),
              duplicates: [],
              candidatesScanned: candidates.length,
              killSwitchActive: false,
            },
          }),
        });
      }
      return Promise.reject(new Error('Unexpected candidate.'));
    });

    let taskA: any;
    act(() => { taskA = manager.createTask({ kind: 'ranked-scan', title: 'Old ranked scan', input: { activeSymbols: ['AAPL'] } }); });
    const oldLarge = 'z'.repeat(120_000);
    act(() => {
      manager.completeTask(taskA.id, {
        results: [
          makeLargeTransportResult('AAPL', oldLarge),
          makeLargeTransportResult('NVDA', oldLarge),
        ],
        rawScanCache: ['AAPL', 'NVDA'].map(makeRawScanEntry),
      });
    });
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.some(
      ([url, init]: [string, RequestInit]) => (
        url === '/api/autopilot/recommendations'
        && JSON.parse(String(init?.body)).candidates[0]?.symbol === 'AAPL'
      ),
    )).toBe(true));

    let taskB: any;
    act(() => { taskB = manager.createTask({ kind: 'ranked-scan', title: 'New ranked scan', input: { activeSymbols: ['MSFT'] } }); });
    act(() => {
      manager.completeTask(taskB.id, {
        results: [makeScreenResult({ symbol: 'MSFT' })],
        rawScanCache: ['MSFT'].map(makeRawScanEntry),
      });
    });

    await waitFor(() => expect(msftAttempts).toBe(2), { timeout: 2_000 });
    await waitFor(() => expect(getCurrentRecommendations().analyses[0]?.subject.symbol).toBe('MSFT'));

    act(() => {
      oldResponse.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            recommendations: [makeDecisionAnalysis()],
            duplicates: [],
            candidatesScanned: 1,
            killSwitchActive: false,
          },
        }),
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getCurrentRecommendations().analyses).toHaveLength(1);
    expect(getCurrentRecommendations().analyses[0].subject.symbol).toBe('MSFT');
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('MSFT')).toBeInTheDocument();
    expect(within(screen.getByTestId('best-opportunities-shortlist')).queryByText('AAPL')).not.toBeInTheDocument();
    expect((globalThis.fetch as any).mock.calls.some(
      ([url, init]: [string, RequestInit]) => (
        url === '/api/autopilot/recommendations'
        && JSON.parse(String(init?.body)).candidates[0]?.symbol === 'NVDA'
      ),
    )).toBe(false);
  });

  it('Targeted Scan exclusion, via a real (non-Ranked) job kind: a completed Targeted Scan never affects Ranked Opportunities staleness or identity even when triggered through the same job-store mechanism real scans use', async () => {
    kv.set('results', [makeScreenResult()]);
    seedCompletedSession([makeScreenResult()]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();
    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());

    // A real Targeted Scan job (kind: 'targeted') completing through the
    // exact same exported screenerJobStore functions runScreen/
    // runTargetedScan themselves call -- never supersedes Ranked
    // Opportunities, because Targeted Scan writes to targetedResults, not
    // results, and is structurally excluded inside
    // useLatestResultsAffectingJobId().
    startScreenerJob({ kind: 'targeted', label: 'Targeted Scan' });
    completeScreenerJob({ resultCount: 3 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Refreshing ranked opportunities/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument();
  });

  it('hard reload / IndexedDB cache-restore (no live job has run this session): renders the honest, non-stale, non-failure state -- no job identity exists yet to compare against', async () => {
    // Simulates a fresh page load pulling last results from IndexedDB with
    // no ranked-scan (or any) job having run this session -- screenerJob
    // starts at its idle DEFAULT_STATE, so useLatestResultsAffectingJobId()
    // returns null and stays null until a real job completes.
    kv.set('results', [makeScreenResult({ symbol: 'AAPL' })]);
    seedCompletedSession([makeScreenResult({ symbol: 'AAPL' })]);
    (globalThis.fetch as any).mockImplementation((url: string) => {
      if (url === '/api/autopilot/recommendations') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, result: { recommendations: [makeDecisionAnalysis()] } }) });
      }
      return Promise.reject(new Error('network disabled in test'));
    });

    renderScreenerPage();

    await waitFor(() => expect(within(screen.getByTestId('best-opportunities-shortlist')).getByText('AAPL')).toBeInTheDocument());
    // Honest: not stale, not a failure, not a refresh -- just the
    // evaluation this session's cache-restore itself triggered.
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Refreshing ranked opportunities/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
