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
import { render, screen, within } from '@testing-library/react';
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
  const strike = role === 'long' ? 100 : 120;
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

function seedPmccSession(result: ScreenResult) {
  let session = createScanSession({
    mode: 'filter', requestedStrategy: 'pmcc',
    scope: { universeSymbols: ['ACME'], eligibleSymbols: ['ACME'] },
    // Required for a valid PMCC session -- restoreScanSession's own
    // validation (INVALID_PMCC_SNAPSHOT) rejects a PMCC session without
    // one, confirmed by a real, direct failure when this was omitted.
    pmccSnapshot: { asOf: asOf.toISOString(), marketSession: 'open', criteria },
  });
  session = recordSymbolEvaluated(session, 'ACME', [result]);
  session = completeSession(session);
  kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
  kv.set('results', [result]);
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

    seedPmccSession(result);
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

    seedPmccSession(result);
    renderScreener();

    const card = await screen.findByTestId('pmcc-result-card');
    expect(within(card).getByText(/Breakeven \$120\.00/)).toBeInTheDocument();
    expect(within(card).queryByText(/above short strike/)).not.toBeInTheDocument();
  });
});
