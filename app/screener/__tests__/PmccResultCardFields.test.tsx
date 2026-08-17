// app/screener/__tests__/PmccResultCardFields.test.tsx
//
// TE-0007E — Diane/Ian/Paul/Alan-reviewed PMCC card fields (breakeven,
// promoted extrinsic, roll runway, annualized ROI, breakeven/short-strike
// sanity check). PmccResultCard is a local, unexported function inside
// app/screener/page.tsx (matching this codebase's established convention
// for strategy result cards -- see CspCandidateDiscovery.test.tsx and
// ScreenerSessionWiring.test.tsx's own header comments for the same
// reasoning), so this renders the real, full ScreenerPage via the same
// session-restore pattern ScreenerPage.test.tsx itself uses, and reuses
// pmccProduction.test.ts's real, already-tested leg()/pairPmccCandidates()/
// buildPmccScreenResults() fixture chain to construct a genuinely valid
// PmccPairResult rather than hand-rolling a fake one.
//
// Every expected value below is hand-computed independently in this
// file's own header comment (not copy-pasted from the implementation),
// using clean, round inputs chosen so the arithmetic is easy to verify
// by eye:
//   long strike 100, executable ask $25.00, underlying $110 (10 ITM)
//   short strike 120, executable bid $3.00
//   short DTE 30, long DTE 300 (expirations picked to land on these
//   exact values against a fixed asOf, verified via direct date math:
//   2026-08-14 + 30 days = 2026-09-13; + 300 days = 2027-06-10)
//
// netDebitPerShare = 25.00 - 3.00 = 22.00
// breakeven = longStrike + netDebitPerShare = 100 + 22.00 = 122.00
// (deliberately above the 120 short strike, to also exercise Ian's
// sanity check in the first test; the second test below covers the
// boundary case where breakeven lands exactly at the short strike.)
// rollRunway = floor((300 - 30) / 30) = 9
// shortCreditToNetDebitPct = (3.00 / 22.00) * 100 = 13.6364%
// annualizedRoi = 13.6364% * (365 / 30) = 165.91%

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { createScanSession, recordSymbolEvaluated, completeSession } from '@/lib/screener/scanSession';
import { SCAN_SESSION_CACHE_KEY } from '@/lib/screener/scanSessionCache';
import { pairPmccCandidates } from '@/lib/scans/pmccPairing';
import { buildPmccScreenResults } from '@/lib/scans/pmccProduction';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '@/lib/scans/pmccConfig';
import type { PmccChainLeg, PmccPairingCriteria } from '@/lib/scans/pmccTypes';
import type { ScreenResult } from '@/lib/scans/types';

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
  };
});

// Same minimal, faithful fake IndexedDB as ScreenerPage.test.tsx (mirrors
// app/screener/page.tsx's local idbOpen/idbGet/idbSet/idbDel exactly).
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
      queueMicrotask(() => { req.result = kv.has(key) ? kv.get(key) : undefined; req.onsuccess?.(); });
      return req;
    }
    put(value: unknown, key: string) { kv.set(key, value); return new FakeRequest(); }
    delete(key: string) { kv.delete(key); return new FakeRequest(); }
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
    transaction(_store: string, _mode: string) { return new FakeTransaction(); }
    close() {}
  }
  const fakeIndexedDB = {
    open(_name: string, _version?: number) {
      const req = new FakeRequest();
      queueMicrotask(() => { req.result = new FakeDB(); req.onsuccess?.(); });
      return req;
    },
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = fakeIndexedDB;
  return kv;
}

let kv: Map<string, unknown>;

beforeEach(() => {
  window.localStorage.clear();
  kv = installFakeIndexedDB();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
});

const asOf = new Date('2026-08-14T15:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: false,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

function makeLeg(role: 'long' | 'short', overrides: Partial<PmccChainLeg> = {}): PmccChainLeg {
  const expiration = role === 'long' ? '2027-06-10' : '2026-09-13';
  // TE-0007F — real, precise bug caught in this helper itself: occSymbol
  // must be derived from the FINAL strike (including any override), not
  // the default -- an OCC symbol encodes its strike price, so overriding
  // `strike` alone without recomputing occSymbol produces an internally
  // inconsistent leg the pairing engine correctly rejects
  // ("OCC identity is missing, invalid, or does not match the contract").
  // Confirmed via a real, direct test failure before this fix.
  const strike = overrides.strike ?? (role === 'long' ? 100 : 120);
  return {
    underlyingSymbol: 'ACME', optionType: 'C', expiration, strike,
    delta: role === 'long' ? 0.80 : 0.25, openInterest: 500,
    bid: role === 'long' ? 24.80 : 3.00, ask: role === 'long' ? 25.00 : 3.20,
    occSymbol: `ACME${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`,
    quoteTimestamp: '2026-08-14T14:59:30.000Z', delayed: false, ...overrides,
  };
}

function buildPmccResult(): ScreenResult {
  const pairing = pairPmccCandidates({
    symbol: 'ACME', underlyingPrice: 110, longLegs: [makeLeg('long')], shortLegs: [makeLeg('short')],
    criteria, asOf, marketSession: 'open',
  });
  const results = buildPmccScreenResults(pairing, { symbol: 'ACME', price: 110, ivr: 35, underlyingType: 'stock' });
  expect(results).toHaveLength(1);
  return results[0];
}

function seedPmccSession(results: ScreenResult[]) {
  let session = createScanSession({
    mode: 'filter', requestedStrategy: 'pmcc',
    scope: { universeSymbols: ['ACME'], eligibleSymbols: ['ACME'] },
    // Required for a valid PMCC session -- restoreScanSession's own
    // validation (INVALID_PMCC_SNAPSHOT) rejects a PMCC session without
    // one, confirmed by a real, direct failure when this was omitted.
    pmccSnapshot: { asOf: asOf.toISOString(), marketSession: 'open', criteria },
  });
  session = recordSymbolEvaluated(session, 'ACME', results);
  session = completeSession(session);
  kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
  kv.set('results', results);
}

function renderScreener() {
  return render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
}

describe('PmccResultCard — new fields (breakeven, extrinsic, roll runway, annualized ROI)', () => {
  it('renders breakeven, promoted extrinsic, roll runway, and an honestly-labeled annualized ROI with hand-verified values', async () => {
    const result = buildPmccResult();
    // Sanity-check the fixture's own real, independently-computed metrics
    // before asserting on the card -- if these don't match the header
    // comment's hand math, the fixture itself is wrong, not the card.
    expect(result.pmccPair?.metrics?.netDebitPerShare).toBeCloseTo(22.00, 2);
    expect(result.pmccPair?.metrics?.shortCreditToNetDebitPct).toBeCloseTo(13.6364, 3);

    seedPmccSession([result]);
    renderScreener();

    const card = await screen.findByTestId('pmcc-result-card');
    expect(within(card).getByText(/Extrinsic \$15\.00/)).toBeInTheDocument();
    expect(within(card).getByText(/Breakeven \$122\.00/)).toBeInTheDocument();
    expect(within(card).getByText(/Roll runway ~9 rolls/)).toBeInTheDocument();
    expect(within(card).getByText(/Annualized ROI 165\.9%, assumes level rolls/)).toBeInTheDocument();
    // This fixture's breakeven ($122.00) is genuinely above the short
    // strike ($120) -- Ian's sanity check must flag it, not silently
    // show two numbers that don't reconcile.
    expect(within(card).getByText(/above short strike/)).toBeInTheDocument();
  });

  it('does not flag the breakeven/short-strike warning for a healthy structure', async () => {
    // Same fixture shape, cheaper long ask so breakeven lands exactly at
    // the short strike: netDebit 20.00 -> breakeven 120.00. The
    // boundary case, not just an obviously-healthy one, since Ian's
    // check is specifically about "above," not "at or above."
    const pairing = pairPmccCandidates({
      symbol: 'ACME', underlyingPrice: 110,
      longLegs: [makeLeg('long', { ask: 23.00, bid: 22.80 })],
      shortLegs: [makeLeg('short')],
      criteria, asOf, marketSession: 'open',
    });
    const results = buildPmccScreenResults(pairing, { symbol: 'ACME', price: 110, ivr: 35, underlyingType: 'stock' });
    const result = results[0];
    expect(result.pmccPair?.metrics?.netDebitPerShare).toBeCloseTo(20.00, 2);

    seedPmccSession([result]);
    renderScreener();

    const card = await screen.findByTestId('pmcc-result-card');
    expect(within(card).getByText(/Breakeven \$120\.00/)).toBeInTheDocument();
    expect(within(card).queryByText(/above short strike/)).not.toBeInTheDocument();
  });
});

// TE-0007F — Ian/Paul/Alan-reviewed PMCC sort/filter wiring. Confirms two
// real, previously-dead code paths now actually work: PmccResultCard's
// results used to render in raw "Contract order" (arrival order) because
// the sortItems() call was unconditionally bypassed for PMCC sessions
// (activePmccSession ? filteredQualified : sortItems(...)), and the whole
// pmcc-result-controls section (OI floor + sort buttons) never rendered
// at all because of a separate, unrelated dead !activePmccSession guard
// wrapping the entire controls block. Both confirmed via direct code
// read and git log -S before fixing, not assumed.
describe('PMCC results — real sort and OI filter (previously dead code paths)', () => {
  // TE-0007F — second real fixture correction, found via a genuine,
  // different failure (only 1 of 2 pairs retained, wrong percentages):
  // pairPmccCandidates retains at most one long leg per symbol by
  // design (confirmed via pmccProduction.test.ts's own proven pattern
  // -- its multi-pair test varies SHORT legs against one shared long
  // leg, never the reverse). This matches real PMCC usage exactly: one
  // long LEAPS anchors the position, multiple short-strike choices get
  // evaluated against it -- exactly the shape of Dean's own original
  // screenshot (identical "BUY 185C" across all four cards, only the
  // SELL side varied). Rebuilt to match: one long leg, multiple shorts.
  function makePair(shorts: Array<{ strike: number; bid: number; oi: number }>): ScreenResult[] {
    const pairing = pairPmccCandidates({
      symbol: 'ACME', underlyingPrice: 110,
      longLegs: [makeLeg('long', { strike: 100, ask: 15.00, bid: 14.80, openInterest: 500 })],
      // TE-0007F — third real fixture correction, found via a genuine,
      // precise rejection reason (BID_ASK_TOO_WIDE): a flat +0.20
      // spread is fine on a $15 long leg (1.3%) but blows through the
      // real 10% quote-quality threshold on a cheap $1.50 short leg
      // (13.3%). Price-proportional (5%) instead of flat, so every
      // short strike stays safely under the real limit regardless of
      // how cheap the premium is.
      shortLegs: shorts.map(({ strike, bid, oi }) => makeLeg('short', { strike, bid, ask: Number((bid * 1.05).toFixed(2)), openInterest: oi })),
      criteria, asOf, marketSession: 'open',
    });
    return buildPmccScreenResults(pairing, { symbol: 'ACME', price: 110, ivr: 35, underlyingType: 'stock' });
  }

  it('sorts by width-minus-debit % by default -- the higher-quality structure renders first, not arrival order', async () => {
    // Worse structure (short strike 115, bid 1.50 -> net debit 13.50,
    // width-minus-debit 1.50 -> 11.1% of debit) evaluated as
    // publishedOrder 1; better structure (short strike 120, bid 4.00 ->
    // net debit 11.00, width-minus-debit 9.00 -> 81.8% of debit) as
    // publishedOrder 2. If the app were still showing raw arrival/
    // "Contract order" (the bug this ticket exists to fix), the worse
    // one (order 1) would render first regardless of quality.
    const [worse, better] = makePair([{ strike: 115, bid: 1.50, oi: 500 }, { strike: 120, bid: 4.00, oi: 500 }]);
    expect(worse.qualified).toBe(true);
    expect(better.qualified).toBe(true);
    expect(worse.pmccPair?.metrics?.widthMinusDebitPctOfDebit).toBeLessThan(better.pmccPair?.metrics?.widthMinusDebitPctOfDebit ?? 0);

    seedPmccSession([worse, better]);
    renderScreener();

    const cards = await screen.findAllByTestId('pmcc-result-card');
    expect(cards).toHaveLength(2);
    // The real, better structure (higher width-minus-debit%) must lead,
    // even though it has the later publishedOrder.
    expect(within(cards[0]).getByText(/81\.8%/)).toBeInTheDocument();
    expect(within(cards[1]).getByText(/11\.1%/)).toBeInTheDocument();
  });

  it('the min-OI floor is genuinely wired up and reactive for PMCC results (previously dead code)', async () => {
    // The underlying "lower of the two required legs" comparator rule
    // is already thoroughly unit-tested directly (lib/screener/
    // __tests__/screenerResultOrdering.test.ts's own "PMCC: LEAPS long
    // call fails.../short call fails..." cases) -- this test's real,
    // new job is confirming the OI floor control is actually WIRED UP
    // and reactive for PMCC's UI at all, since the whole controls
    // section (including this input) was unreachable dead code until
    // this session's fix.
    //
    // Real, precise constraint discovered while building this: the
    // scan's own criteria.shortOiMin (100 here) already excludes any
    // leg below that OI at the pairing-engine level, before a result
    // ever reaches the page at all (confirmed via a genuine rejection
    // when this test first tried OI 50). The UI's post-scan OI floor
    // is a separate, additional layer on top of already-qualified
    // results, not a re-test of the scan's own fixed criteria -- so
    // this uses two OI values that both clear shortOiMin (150 and
    // 600), then raises the UI floor to 300 to prove the CONTROL
    // itself does real, additional filtering.
    const [thin, healthy] = makePair([
      { strike: 115, bid: 1.50, oi: 150 },
      { strike: 120, bid: 4.00, oi: 600 },
    ]);
    expect(thin.qualified).toBe(true);
    expect(healthy.qualified).toBe(true);

    seedPmccSession([thin, healthy]);
    renderScreener();

    // Both visible with no floor applied (default minOi is 0 / "Any").
    expect(await screen.findAllByTestId('pmcc-result-card')).toHaveLength(2);

    const oiInput = screen.getByLabelText('Custom minimum relevant-leg OI');
    fireEvent.change(oiInput, { target: { value: '300' } });

    // The 150-OI short leg is excluded (below the 300 floor); the
    // 600-OI one survives -- proving the control is genuinely reactive,
    // not just present on screen.
    await waitFor(() => expect(screen.getAllByTestId('pmcc-result-card')).toHaveLength(1));
    expect(within(screen.getByTestId('pmcc-result-card')).getByText(/120C/)).toBeInTheDocument();
  });
});
