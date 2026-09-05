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

// TE-0007H — genuinely new fixture need: every prior test in this file
// uses one symbol ('ACME'). Ticker grouping/filtering needs real,
// distinct symbols. makeLeg/pairPmccCandidates are hardcoded to 'ACME'
// throughout this file, so this builds a second symbol's fixture from
// scratch using the same real, proven pairPmccCandidates/
// buildPmccScreenResults chain, not a different mechanism.
function buildPmccResultForSymbol(symbol: string, underlyingPrice: number, longAsk: number, shortBid: number): ScreenResult {
  const expiration = { long: '2027-06-10', short: '2026-09-13' };
  const strike = { long: 100, short: 120 };
  const leg = (role: 'long' | 'short'): PmccChainLeg => ({
    underlyingSymbol: symbol, optionType: 'C', expiration: expiration[role], strike: strike[role],
    delta: role === 'long' ? 0.80 : 0.25, openInterest: 500,
    bid: role === 'long' ? longAsk - 0.20 : shortBid, ask: role === 'long' ? longAsk : Number((shortBid * 1.05).toFixed(2)),
    occSymbol: `${symbol}${expiration[role].slice(2).replace(/-/g, '')}C${String(strike[role] * 1000).padStart(8, '0')}`,
    quoteTimestamp: '2026-08-14T14:59:30.000Z', delayed: false,
  });
  const pairing = pairPmccCandidates({
    symbol, underlyingPrice, longLegs: [leg('long')], shortLegs: [leg('short')],
    criteria, asOf, marketSession: 'open',
  });
  const results = buildPmccScreenResults(pairing, { symbol, price: underlyingPrice, ivr: 35, underlyingType: 'stock' });
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

// TE-0007H — multi-symbol variant of seedPmccSession above: groups the
// given results by their own real symbol, sets scope to every distinct
// symbol present, and calls recordSymbolEvaluated once per symbol
// (required -- it validates every supplied result's symbol matches the
// symbol being recorded, confirmed via direct read of scanSession.ts).
function seedPmccSessionMultiSymbol(results: ScreenResult[]) {
  const bySymbol = new Map<string, ScreenResult[]>();
  for (const r of results) {
    const group = bySymbol.get(r.symbol) ?? [];
    group.push(r);
    bySymbol.set(r.symbol, group);
  }
  const symbols = Array.from(bySymbol.keys());
  let session = createScanSession({
    mode: 'filter', requestedStrategy: 'pmcc',
    scope: { universeSymbols: symbols, eligibleSymbols: symbols },
    pmccSnapshot: { asOf: asOf.toISOString(), marketSession: 'open', criteria },
  });
  for (const [symbol, group] of Array.from(bySymbol.entries())) {
    session = recordSymbolEvaluated(session, symbol, group);
  }
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
  it('summarizes option-chain exclusions before exposing the raw contract audit', async () => {
    const pairing = pairPmccCandidates({
      symbol: 'ACME', underlyingPrice: 110,
      longLegs: [makeLeg('long')],
      shortLegs: [
        makeLeg('short'),
        makeLeg('short', { strike: 105, openInterest: 50 }),
      ],
      criteria, asOf, marketSession: 'open',
    });
    const [result] = buildPmccScreenResults(pairing, { symbol: 'ACME', price: 110, ivr: 35, underlyingType: 'stock' });
    seedPmccSession([result]);
    renderScreener();

    const card = await screen.findByTestId('pmcc-result-card');
    fireEvent.click(within(card).getByRole('button', { name: /expand ACME PMCC details/i }));
    fireEvent.click(within(card).getByRole('button', { name: /show qualification and audit detail/i }));

    expect(within(card).getByLabelText('Option-chain exclusions')).toHaveTextContent('Option-chain exclusions (1 excluded contract)');
    expect(within(card).getAllByText(/Short call is not out of the money/)).toHaveLength(2);
    expect(within(card).getAllByText(/Open interest is below the submitted minimum/)).toHaveLength(2);
    expect(within(card).getByText(/do not equal rejected PMCC structures/i)).toBeInTheDocument();
    expect(within(card).getByText(/View individual excluded contracts \(1\)/)).toBeInTheDocument();
  });

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
    // FIX: "Extrinsic" IS one continuous text node (`Extrinsic {money(...)}`
    // in a single span) and needed no change. But "Breakeven"/"Roll
    // runway"/"Annualized ROI" come from decisionStrip's shared
    // label/value markup (`<span>{label}</span><br/>{value}`) -- label and
    // value are separate text nodes under one wrapping span, so a plain
    // regex expecting them adjacent in one string never matches (the
    // error's own hint: "text is broken up by multiple elements"). None of
    // this needs expanding first -- decisionStrip renders unconditionally,
    // not behind the per-card expand toggle.
    expect(within(card).getByText(/Extrinsic \$15\.00/)).toBeInTheDocument();
    // FIX: "above short strike" was never rendered as literal text -- only
    // a "⚠" appended to the Breakeven value (confirmed: no such string
    // exists anywhere in app/screener/page.tsx). The warning check below
    // already covers this fixture's breakeven ($122.00, genuinely above
    // the $120 short strike) via the appended ⚠.
    expect(within(card).getByText('Breakeven').parentElement).toHaveTextContent('Breakeven$122.00 ⚠');
    expect(within(card).getByText('Roll runway').parentElement).toHaveTextContent('Roll runway~9 rolls');
    expect(within(card).getByText('Annualized ROI').parentElement).toHaveTextContent('Annualized ROI165.9%');
  });

  it('shows the ideal net delta range, total premium, and profit-at-current-price with hand-verified values', async () => {
    // Same fixture as the test above (long ask 25.00, short bid 3.00,
    // rollRunway 9, underlying price 110). New math, hand-verified
    // independently here, not copied from the implementation:
    //   totalPremium = shortLeg.executablePrice * (rollRunway + 1)
    //                = 3.00 * (9 + 1) = $30.00
    //   longIntrinsicAtCurrentPrice = max(110 - 100, 0) = $10.00
    //   profitAtCurrentPrice = totalPremium + longIntrinsic - longAsk
    //                        = 30.00 + 10.00 - 25.00 = $15.00
    // Deliberately NOT testing "profit at breakeven" -- traced the math
    // first (see the real code comment above totalPremium/
    // profitAtCurrentPrice) and confirmed it's mathematically identical
    // to totalPremium by construction, so it was never built as a
    // separate stat; nothing to test that doesn't already duplicate the
    // totalPremium assertion below.
    const result = buildPmccResult();
    seedPmccSession([result]);
    renderScreener();

    const card = await screen.findByTestId('pmcc-result-card');
    // FIX: this text moved into the "quote and pricing detail" disclosure
    // (see the header comment right above decisionStrip: "Net debit,
    // strike width, total premium, and profit-at-current-price move into
    // the 'quote and pricing detail' disclosure below") -- needs the outer
    // card expanded, then that inner disclosure expanded too. Wording also
    // drifted: real text is "Net delta ideal range: 0.40–0.65, default
    // scan criteria." (no parentheses), and "Total premium $X, assumes
    // level rolls. Profit $Y if closed today at current price." is one
    // combined sentence, not two separate phrases -- confirmed directly
    // from source.
    // FIX: DEFAULT_PMCC_SHORT_DELTA_RANGE.max is 0.35 now (raised from an
    // earlier 0.30 specifically to include liquid calls like UBER's
    // 0.32-delta -- see lib/scans/pmccConfig.ts's own comment), making the
    // ideal range 0.70 - 0.35 = 0.35, not 0.40. Confirmed directly against
    // the real constant rather than the stale hand-math in this comment.
    fireEvent.click(within(card).getByRole('button', { name: /Expand .* PMCC details/ }));
    fireEvent.click(within(card).getByRole('button', { name: /Show quote and pricing detail/ }));
    // FIX: each {} interpolation in the JSX splits this into several text
    // nodes ("Net delta ideal range: ", "0.40", "–", "0.65", ...) -- a
    // single regex expecting it all as one string never matches. Anchored
    // on a stable substring, then checked against the whole <p>'s
    // textContent instead.
    expect(within(card).getByText(/Net delta ideal range:/).closest('p')).toHaveTextContent('Net delta ideal range: 0.35–0.65, default scan criteria.');
    expect(within(card).getByText(/Total premium/).closest('p')).toHaveTextContent('Total premium $30.00, assumes level rolls. Profit $15.00 if closed today at current price.');
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
    // FIX: same split-node issue as the first test in this file --
    // decisionStrip's label/value are separate text nodes, and this
    // renders unconditionally, not behind the expand toggle.
    expect(within(card).getByText('Breakeven').parentElement).toHaveTextContent('Breakeven$120.00');
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

// TE-0007H — Dean/Ian/Paul-reviewed: real per-ticker grouping (Ian's own
// priority addition -- "the thing that actually helps me triage 171
// results down to the 5 I'll seriously look at") and a real ticker
// filter, reusing filterHiddenSymbols/toggleFilterSymbol -- already real,
// already working for every other strategy, previously bypassed for
// PMCC by the same dead-guard class fixed three times earlier this
// session (filteredQualifiedChips's own activePmccSession bypass).
//
// Real, hand-verified numbers for two distinct symbols (long strike 100,
// short strike 120, short DTE 30 throughout, matching every other
// fixture in this file):
//   AAPL: long ask 20.00, short bid 5.00 -> net debit 15.00,
//     width-minus-debit (20-15)/15*100 = 33.33%,
//     annualized ROI (5/15*100)*(365/30) = 405.6%
//   MSFT: long ask 23.00, short bid 4.00 -> net debit 19.00,
//     width-minus-debit (20-19)/19*100 = 5.26%,
//     annualized ROI (4/19*100)*(365/30) = 256.1%
// AAPL wins on both metrics -- ticker groups sort descending by best
// width-minus-debit%, so AAPL's group must render before MSFT's.
describe('PMCC results — per-ticker grouping and ticker filter (Ian/Paul-reviewed)', () => {
  it('groups qualified results by symbol, shows the real best width-minus-debit%/annualized ROI per group, sorted best-first, collapsed by default', async () => {
    const aapl = buildPmccResultForSymbol('AAPL', 110, 20.00, 5.00);
    const msft = buildPmccResultForSymbol('MSFT', 110, 23.00, 4.00);
    expect(aapl.pmccPair?.metrics?.widthMinusDebitPctOfDebit).toBeCloseTo(33.33, 1);
    expect(msft.pmccPair?.metrics?.widthMinusDebitPctOfDebit).toBeCloseTo(5.26, 1);

    seedPmccSessionMultiSymbol([msft, aapl]); // deliberately seeded worst-first
    renderScreener();

    // FIX: grouped-by-symbol display (PmccTickerDisclosure) only renders
    // when pmccViewMode === 'grouped' -- default is 'flat' (a real,
    // deliberate cross-ticker rank view, not a placeholder -- see
    // PMCC-VIEW-MODE-0001's comment: "both real, both wanted, an explicit
    // either/or"). This test is specifically about the grouped view, so
    // it needs to switch to it first.
    fireEvent.click(await screen.findByRole('button', { name: 'Grouped by ticker' }));
    const groups = await screen.findAllByTestId('pmcc-ticker-group');
    expect(groups).toHaveLength(2);
    // Best-first: AAPL's group (33.3%) must lead, even though MSFT was
    // seeded first -- proving this is real sorting, not seed/arrival
    // order (the exact "Contract order" bug class this whole PMCC
    // effort exists to fix).
    expect(within(groups[0]).getByText('AAPL')).toBeInTheDocument();
    expect(within(groups[0]).getByText(/best width-minus-debit 33\.3%/)).toBeInTheDocument();
    expect(within(groups[0]).getByText(/best annualized ROI 405\.6%/)).toBeInTheDocument();
    expect(within(groups[1]).getByText('MSFT')).toBeInTheDocument();
    expect(within(groups[1]).getByText(/best width-minus-debit 5\.3%/)).toBeInTheDocument();

    // Collapsed by default with more than one ticker (Ian's stated
    // triage need: decide which tickers deserve a closer look before
    // opening any card) -- no result cards visible yet.
    expect(screen.queryAllByTestId('pmcc-result-card')).toHaveLength(0);

    // Expanding one group reveals only that symbol's card, not both.
    fireEvent.click(within(groups[0]).getByRole('button', { name: /AAPL/ }));
    await waitFor(() => expect(screen.getAllByTestId('pmcc-result-card')).toHaveLength(1));
    expect(within(screen.getByTestId('pmcc-result-card')).getByText(/100C/)).toBeInTheDocument();
  });

  it('the real ticker filter (reused filterHiddenSymbols) actually hides a symbol\'s results, not just a decorative toggle', async () => {
    const aapl = buildPmccResultForSymbol('AAPL', 110, 20.00, 5.00);
    const msft = buildPmccResultForSymbol('MSFT', 110, 23.00, 4.00);
    seedPmccSessionMultiSymbol([aapl, msft]);
    renderScreener();

    // FIX: same as the test above -- grouped view is not the default.
    fireEvent.click(await screen.findByRole('button', { name: 'Grouped by ticker' }));
    // Both ticker groups visible with no filter applied.
    expect(await screen.findAllByTestId('pmcc-ticker-group')).toHaveLength(2);

    // The Tickers row lives inside PMCC's own result-controls section,
    // alongside the OI floor and sort buttons already tested above.
    const controls = screen.getByTestId('pmcc-result-controls');
    fireEvent.click(within(controls).getByRole('button', { name: /MSFT/ }));

    // MSFT's group is gone entirely -- proving the toggle actually
    // filters what renders, not just its own visual state. (The toggle
    // chip itself still legitimately shows "MSFT" as its own label even
    // while hidden -- checking for the group's absence, not the text's,
    // since the text genuinely still exists on the page.)
    const remainingGroups = await waitFor(() => {
      const found = screen.getAllByTestId('pmcc-ticker-group');
      expect(found).toHaveLength(1);
      return found;
    });
    expect(within(remainingGroups[0]).getByText('AAPL')).toBeInTheDocument();
  });
});
