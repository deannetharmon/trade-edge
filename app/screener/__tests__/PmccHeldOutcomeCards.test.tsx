// app/screener/__tests__/PmccHeldOutcomeCards.test.tsx
//
// PMCC-HELD-BREAKEVEN-0001B-1 (Mock 3c): held-LEAP outcome states on the existing held pair card, the
// per-symbol header row and ordering, and the discovery-time pre-modal block. PmccResultCard is an
// unexported function in app/screener/page.tsx, so (like PmccResultCardFields.test.tsx) this renders
// the real ScreenerPage from a seeded session. Fixtures come from the real runPmccProduction path so
// the engine, not the test, decides every state.
//
// Order path: that a rejected held pair can never become ready or build an order body is already
// proved server-side by PR1's W2 (lib/leaps-analysis/__tests__/heldTradeReviewFloor.test.ts) and the
// pairing tests in lib/scans/__tests__/pmccHeldBreakeven.test.ts. Not duplicated here; this file only
// proves the card exposes no order or promote control and that no best-pair callout can name it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { createScanSession, recordSymbolEvaluated, completeSession } from '@/lib/screener/scanSession';
import { SCAN_SESSION_CACHE_KEY } from '@/lib/screener/scanSessionCache';
import { pairPmccCandidates } from '@/lib/scans/pmccPairing';
import { runPmccProduction } from '@/lib/scans/pmccProduction';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '@/lib/scans/pmccConfig';
import type { PmccChainLeg, PmccPairingCriteria } from '@/lib/scans/pmccTypes';
import type { HeldPmccLongCandidate } from '@/lib/scans/pmccHeldLeaps';
import { PMCC_DECISION_POLICY_VERSION } from '@/lib/scans/pmccDecision';
import type { ScreenResult } from '@/lib/scans/types';
import type { Position } from '@/lib/portfolio-data/types';

const harness = vi.hoisted(() => ({ positions: [] as unknown[], refresh: null as null | (() => Promise<unknown>) }));

vi.mock('@/components/portfolio-data/PortfolioDataProvider', () => ({
  usePortfolioData: () => ({ snapshot: null }),
  useOptionalPortfolioData: () => ({ snapshot: null, positions: harness.positions, refresh: harness.refresh }),
}));

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
  };
});

// Same minimal fake IndexedDB as PmccResultCardFields.test.tsx.
function installFakeIndexedDB(): Map<string, unknown> {
  const kv = new Map<string, unknown>();
  class FakeRequest { onsuccess: (() => void) | null = null; onerror: (() => void) | null = null; result: unknown = undefined; }
  class FakeObjectStore {
    get(key: string) { const req = new FakeRequest(); queueMicrotask(() => { req.result = kv.has(key) ? kv.get(key) : undefined; req.onsuccess?.(); }); return req; }
    put(value: unknown, key: string) { kv.set(key, value); return new FakeRequest(); }
    delete(key: string) { kv.delete(key); return new FakeRequest(); }
  }
  class FakeTransaction {
    oncomplete: (() => void) | null = null; onerror: (() => void) | null = null;
    objectStore(_name: string) { queueMicrotask(() => queueMicrotask(() => this.oncomplete?.())); return new FakeObjectStore(); }
  }
  class FakeDB { transaction(_s: string, _m: string) { return new FakeTransaction(); } close() {} }
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open(_name: string, _version?: number) { const req = new FakeRequest(); queueMicrotask(() => { req.result = new FakeDB(); req.onsuccess?.(); }); return req; },
  };
  return kv;
}

let kv: Map<string, unknown>;
const refreshMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  kv = installFakeIndexedDB();
  refreshMock.mockReset().mockResolvedValue(undefined);
  harness.positions = [];
  harness.refresh = refreshMock;
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
});

const asOf = new Date('2026-08-14T15:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const snapshot = { asOf: asOf.toISOString(), marketSession: 'open' as const, criteria, decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION };
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
const leg = (role: 'long' | 'short', strike: number, overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => {
  const expiration = role === 'long' ? '2027-06-18' : '2026-09-18';
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: role === 'long' ? 0.8 : 0.25, openInterest: 500,
    bid: role === 'long' ? 320 : 8, ask: role === 'long' ? 322 : 8.2,
    occSymbol: occ(expiration, strike), quoteTimestamp: '2026-08-14T14:59:30.000Z', delayed: false, ...overrides,
  };
};
const context = { symbol: 'GS', price: 1037.55, ivr: 35, underlyingType: 'stock' as const };

/** One held LEAP at the given strike. */
function held(strike: number, avgOpenPrice: number | null, quantity = 1): HeldPmccLongCandidate {
  return {
    accountNumber: '5WT00001', positionKey: `held-${strike}`, underlyingSymbol: 'GS',
    occSymbol: occ('2027-06-18', strike), expiration: '2027-06-18', dte: 308, strike, quantity, avgOpenPrice,
  };
}

/** Real production path: engine + annotate decide every state. Short 1070 bid 8 => Ks + bid = 1078. */
function produce(candidates: HeldPmccLongCandidate[], shortLegs: PmccChainLeg[] = [leg('short', 1070)]): ScreenResult[] {
  // Ask keeps 4.45 of extrinsic over intrinsic at every strike (720 => 320 / 322, as in the pmccProduction fixtures).
  const longLegs = candidates.map(c => { const ask = Number((1037.55 - c.strike + 4.45).toFixed(2)); return leg('long', c.strike, { bid: ask - 2, ask }); });
  return runPmccProduction(
    { shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot,
    { adapt: () => ({ longLegs, shortLegs }), pair: pairPmccCandidates }, candidates,
  );
}

function seed(results: ScreenResult[]) {
  let session = createScanSession({
    mode: 'filter', requestedStrategy: 'pmcc',
    scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot,
  });
  session = completeSession(recordSymbolEvaluated(session, 'GS', results));
  kv.set(SCAN_SESSION_CACHE_KEY, { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() });
  kv.set('results', results);
}

function renderScreener() {
  return render(<TaskProvider><CommandProvider><ScreenerPage /></CommandProvider></TaskProvider>);
}

/** Held floor-failed and not-checked cards are DISQUALIFIED, so they live in the collapsed near-miss group. */
async function openNearMissGroup() {
  const toggle = await screen.findByRole('button', { name: /GS.*short-call candidate/i });
  fireEvent.click(toggle);
}

const NEVER = /no short calls found/i;

/** The audit toggle lives in the card's expanded body. */
function openAudit(card: HTMLElement) {
  fireEvent.click(within(card).getByRole('button', { name: /Expand GS PMCC details/i }));
  fireEvent.click(within(card).getByRole('button', { name: /show qualification and audit detail/i }));
}

function expectNoOrderOrPromote(card: HTMLElement) {
  expect(within(card).queryByRole('button', { name: /SELL SHORT CALL/i })).toBeNull();
  expect(within(card).queryByRole('button', { name: /REVIEW PMCC/i })).toBeNull();
  expect(within(card).queryByText(/Best (Conservative|Balanced|Aggressive)|Why this is Best/i)).toBeNull();
}

describe('production fixtures reach the states this file asserts (guards the tests themselves)', () => {
  it('maps avgOpen and quantity to the engine codes', () => {
    const codes = (r: ScreenResult[]) => Array.from(new Set(r.flatMap(x => x.pmccPair?.failureReasons.map(f => f.message) ?? [])));
    expect(produce([held(720, 400)]).every(r => r.pmccPair?.heldLongLeg?.avgOpenPrice === 400)).toBe(true);
    expect(codes(produce([held(720, 400)]))).toContain('Short strike plus bid must exceed held LEAP strike plus cost basis');
    expect(codes(produce([held(720, null)]))).toContain('cost basis unavailable');
    expect(codes(produce([held(720, 345, 2)]))).toContain('multi-lot LEAP: cost averaging unverified');
    expect(codes(produce([held(720, 3450)]))).toContain('cost basis unit suspect');
  });
});

describe('held-LEAP outcome cards (Mock 3c)', () => {
  it('floor not met: caption, banner with the arithmetic, reason, Rejected tag, inert, detail above Pairing/accounting', async () => {
    seed(produce([held(720, 400)]));
    renderScreener();
    await openNearMissGroup();
    const card = await screen.findByTestId('pmcc-result-card');

    expect(card).toHaveAttribute('data-held-outcome', 'floor-not-met');
    expect(within(card).getByTestId('held-outcome-caption')).toHaveTextContent('Floor $1120.00 (LEAP strike + cost)');
    expect(within(card).getByTestId('held-outcome-banner')).toHaveTextContent(
      'No short calls cleared the floor. A short must satisfy strike + bid > LEAP strike + your cost: 720 + 400.00 = $1120.00.');
    expect(within(card).getByTestId('held-outcome-reason')).toHaveTextContent('Reason: SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    expect(within(card).queryByRole('button', { name: /Refresh Portfolio/i })).toBeNull();

    // Rejected styling: neutral grey tag with the reason code, neutral border, no score, no near-miss colors.
    expect(within(card).getByTestId('held-rejected-tag')).toHaveTextContent('Short call not eligible · SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    expect(within(card).getByTestId('held-rejected-tag').className).toContain('border-neutral-700');
    expect(card.className).toContain('border-neutral-700');
    expect(card.className).not.toMatch(/border-(amber|red|emerald)/);
    expect(within(card).queryByText(/PMCC Structure Quality/)).toBeNull();
    expectNoOrderOrPromote(card);
    expect(card.textContent).not.toMatch(NEVER);

    openAudit(card);
    const detail = within(card).getByTestId('held-outcome-detail');
    expect(detail).toHaveTextContent('Detail: no short cleared the floor.');
    expect(within(card).getByText('Rejection reasons:')).toBeInTheDocument();
    expect(within(card).queryByText('Qualification and near-miss reasons:')).toBeNull();
    // First row of the toggle, above the untouched Pairing/accounting row.
    const accounting = within(card).getByText('Pairing/accounting:');
    expect(detail.compareDocumentPosition(accounting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detail.parentElement!.firstElementChild).toBe(detail);
    expect(card.textContent).not.toMatch(NEVER);
  });

  it('cost basis unavailable: not checked, no SELL column, Refresh Portfolio works, never "no short calls found"', async () => {
    seed(produce([held(720, null)]));
    renderScreener();
    await openNearMissGroup();
    const card = await screen.findByTestId('pmcc-result-card');

    expect(card).toHaveAttribute('data-held-outcome', 'not-checked');
    expect(within(card).getByTestId('held-outcome-caption')).toHaveTextContent('Cost basis unavailable');
    expect(within(card).getByTestId('held-outcome-banner')).toHaveTextContent('Short calls were not checked. Cost basis for GS could not be read from your broker.');
    expect(within(card).getByTestId('held-outcome-reason')).toHaveTextContent('Reason: COST_BASIS_UNAVAILABLE');
    expect(within(card).queryByText('SELL')).toBeNull();
    expect(within(card).getByText('HELD')).toBeInTheDocument();
    // Fixable read failure is not a rejection: no Rejected tag.
    expect(within(card).queryByTestId('held-rejected-tag')).toBeNull();
    expectNoOrderOrPromote(card);
    expect(card.textContent).not.toMatch(NEVER);

    openAudit(card);
    expect(within(card).getByTestId('held-outcome-detail')).toHaveTextContent('Detail: cost basis unavailable. Avg open price missing or unusable.');

    fireEvent.click(within(card).getByRole('button', { name: 'Refresh Portfolio' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(await within(card).findByText(/Portfolio refreshed\. Run FIND PMCCs again to re-check\./)).toBeInTheDocument();
    // Clicking the action must not toggle the card's expand button. openAudit expanded the card, so the
    // label is "Collapse"; a stray toggle would flip it back to "Expand".
    expect(within(card).getByLabelText('Collapse GS PMCC details')).toBeInTheDocument();
    expect(within(card).queryByLabelText('Expand GS PMCC details')).toBeNull();
  });

  it('multi-lot: exact banner with the engine integer, no action, rejected, held contract line unchanged', async () => {
    seed(produce([held(720, 345, 2)]));
    renderScreener();
    await openNearMissGroup();
    const card = await screen.findByTestId('pmcc-result-card');

    expect(within(card).getByTestId('held-outcome-caption')).toHaveTextContent('Multi-lot LEAP: cost unverified');
    expect(within(card).getByTestId('held-outcome-banner')).toHaveTextContent(
      'Short calls were not checked. This LEAP has 2 contracts, and cost averaging across lots is unverified.');
    expect(within(card).getByTestId('held-outcome-reason')).toHaveTextContent('Reason: COST_BASIS_UNAVAILABLE');
    expect(within(card).queryByRole('button', { name: /Refresh Portfolio/i })).toBeNull();
    expect(within(card).getByTestId('held-rejected-tag')).toHaveTextContent('Short call not eligible · COST_BASIS_UNAVAILABLE');
    expect(within(card).getByText(/Held contract · 2 contract\(s\)/)).toBeInTheDocument();
    expect(within(card).queryByText('SELL')).toBeNull();
    expectNoOrderOrPromote(card);
    expect(card.textContent).not.toMatch(NEVER);
    openAudit(card);
    expect(within(card).getByTestId('held-outcome-detail')).toHaveTextContent('Detail: multi-lot LEAP: cost averaging unverified.');
  });

  it('unit suspect: in results with the "looks wrong" banner, Refresh shown, rejected', async () => {
    seed(produce([held(720, 3450)]));
    renderScreener();
    await openNearMissGroup();
    const card = await screen.findByTestId('pmcc-result-card');

    expect(within(card).getByTestId('held-outcome-caption')).toHaveTextContent('Cost basis unavailable');
    expect(within(card).getByTestId('held-outcome-banner')).toHaveTextContent(
      'Short calls were not checked. Cost basis for GS looks wrong or could not be read from your broker.');
    expect(within(card).getByRole('button', { name: 'Refresh Portfolio' })).toBeInTheDocument();
    expect(within(card).getByTestId('held-rejected-tag')).toBeInTheDocument();
    expect(within(card).queryByText('SELL')).toBeNull();
    expectNoOrderOrPromote(card);
    openAudit(card);
    expect(within(card).getByTestId('held-outcome-detail')).toHaveTextContent('Detail: cost basis unit suspect. Avg open price looks mis-scaled.');
  });

  it('multi-LEAP symbol: one summary row, counts sum to n, floor-not-met before not-checked, one card per rejected LEAP', async () => {
    // 720 clears the floor (345), 700 has no basis, 680 fails the floor (400: 1080 >= 1078).
    seed(produce([held(700, null), held(680, 400), held(720, 345)]));
    renderScreener();
    const summaries = await screen.findAllByTestId('held-leap-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent('GS · 3 held LEAPs · 1 with results · 1 no shorts cleared · 1 not checked');

    const nearMiss = screen.queryByRole('button', { name: /GS.*short-call candidate/i });
    if (nearMiss) fireEvent.click(nearMiss);
    const cards = await screen.findAllByTestId('pmcc-result-card');
    const outcomes = cards.map(c => c.getAttribute('data-held-outcome')).filter(Boolean);
    // Input order was not-checked, floor; display order is floor-not-met, then not-checked; one card each.
    expect(outcomes).toEqual(['floor-not-met', 'not-checked']);
    // A failing LEAP never hides another card: the LEAP with results is still on the page.
    expect(screen.getAllByText(/720C/).length).toBeGreaterThan(0);
  });

  it('two shorts on one LEAP, one clears the floor and one does not: both render; only the failing one is rejected, with no "no short calls cleared" banner', async () => {
    // LEAP 720 at cost 345 => floor 1065. Short 1070 bid 8 => 1078 clears. Short 1060 bid 4 => 1064 fails.
    const results = produce([held(720, 345)], [leg('short', 1070), leg('short', 1060, { bid: 4, ask: 4.1 })]);
    expect(results).toHaveLength(2);
    seed(results);
    renderScreener();
    await openNearMissGroup();
    const cards = await screen.findAllByTestId('pmcc-result-card');
    expect(cards).toHaveLength(2);
    const rejected = cards.filter(c => c.getAttribute('data-held-rejected') === 'true');
    const passing = cards.filter(c => c.getAttribute('data-held-rejected') !== 'true');
    expect(rejected).toHaveLength(1);
    expect(passing).toHaveLength(1);
    expect(within(rejected[0]).getByTestId('held-rejected-tag')).toHaveTextContent('Short call not eligible · SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    expect(within(rejected[0]).queryByTestId('held-outcome-banner')).toBeNull();
    expect(rejected[0].textContent).not.toMatch(/No short calls cleared/i);
    openAudit(rejected[0]);
    expect(within(rejected[0]).getByTestId('held-outcome-detail')).toHaveTextContent('Detail: this short did not clear the floor.');
    expect(passing[0]).not.toHaveAttribute('data-held-rejected');
    expect(within(passing[0]).queryByTestId('held-rejected-tag')).toBeNull();
    expect(within(passing[0]).queryByTestId('held-outcome-banner')).toBeNull();
  });

  it('two shorts on one LEAP that both fail the floor: exactly one card renders', async () => {
    const results = produce([held(720, 345)], [leg('short', 1060, { bid: 4, ask: 4.1 }), leg('short', 1050, { bid: 3, ask: 3.1 })]);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.pmccPair?.failureReasons.some(f => f.code === 'SHORT_NOT_ABOVE_HELD_BREAKEVEN'))).toBe(true);
    seed(results);
    renderScreener();
    await openNearMissGroup();
    const cards = await screen.findAllByTestId('pmcc-result-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-held-outcome', 'floor-not-met');
    expect(within(cards[0]).getByTestId('held-outcome-banner')).toHaveTextContent('No short calls cleared the floor.');
    openAudit(cards[0]);
    expect(within(cards[0]).getByTestId('held-outcome-detail')).toHaveTextContent('Detail: no short cleared the floor.');
  });

  it('card Refresh Portfolio with no refresh function wired shows the failure text, never "Portfolio refreshed"', async () => {
    harness.refresh = null;
    seed(produce([held(720, null)]));
    renderScreener();
    await openNearMissGroup();
    const card = await screen.findByTestId('pmcc-result-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Refresh Portfolio' }));
    expect(await within(card).findByText('Portfolio refresh failed. Try again.')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/Portfolio refreshed/);
  });

  it('a symbol with a single held LEAP shows no summary row', async () => {
    seed(produce([held(720, null)]));
    renderScreener();
    await openNearMissGroup();
    await screen.findByTestId('pmcc-result-card');
    expect(screen.queryByTestId('held-leap-summary')).toBeNull();
  });
});

describe('discovery-time pre-modal cost-basis block', () => {
  const position = (over: Partial<Position> & { avgOpenPrice?: number | null; quantity?: number; strike?: number; symbol?: string } = {}): Position => {
    const strike = over.strike ?? 60;
    const symbol = over.symbol ?? 'UBER';
    return {
      key: `pos-${symbol}-${strike}`, symbol, expDate: '2027-06-18', dte: 300, accountNumber: '5WT00001',
      structureAmbiguous: false, identity: {} as Position['identity'],
      legs: [{
        symbol: `${symbol.padEnd(6, ' ')}270618C${String(strike * 1000).padStart(8, '0')}`, optionType: 'C', strikePrice: strike, direction: 'Long',
        quantity: over.quantity ?? 1, avgOpenPrice: over.avgOpenPrice === undefined ? null : over.avgOpenPrice, currentPrice: 15,
      }],
    } as unknown as Position;
  };

  it('every selected LEAP unreadable: closes the modal, shows the error, Details only for invalid quantity, Refresh reopens once per click', async () => {
    harness.positions = [position({ symbol: 'UBER', avgOpenPrice: null }), position({ symbol: 'NFLX', strike: 90, avgOpenPrice: null })];
    renderScreener();
    fireEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));

    const alert = await screen.findByText(/Could not read cost basis\. Cost basis for 2 held LEAPs could not be read from your broker: UBER, NFLX\. Refresh Portfolio and try again\./);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RUN PMCC SCAN →' })).toBeNull();
    expect(screen.queryByText(/Details: COST_BASIS_UNAVAILABLE, held quantity invalid/)).toBeNull();
    // discovery refreshed the portfolio once; there is no auto-loop
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Portfolio' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(2));
    // still unreadable: the error stays, exactly one more discovery ran
    expect(await screen.findByText(/Could not read cost basis\./)).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('single LEAP: single-symbol copy', async () => {
    harness.positions = [position({ symbol: 'UBER', avgOpenPrice: null })];
    renderScreener();
    fireEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    expect(await screen.findByText('Could not read cost basis. Cost basis for UBER could not be read from your broker. Refresh Portfolio and try again.', { exact: false })).toBeInTheDocument();
  });

  it('invalid held quantity adds the collapsed Details line (positive case)', async () => {
    // Quantity 1.5 with a readable cost: candidate selection keeps it (only quantity <= 0 is dropped), the engine calls it invalid.
    harness.positions = [position({ symbol: 'UBER', avgOpenPrice: 5, quantity: 1.5 })];
    renderScreener();
    fireEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    expect(await screen.findByText(/Could not read cost basis\. Cost basis for UBER/)).toBeInTheDocument();
    expect(screen.getByText('Details: COST_BASIS_UNAVAILABLE, held quantity invalid')).toBeInTheDocument();
  });

  it('deselected symbols are excluded from the all-unreadable check', async () => {
    // UBER unreadable, NFLX readable: the modal opens. Deselect NFLX, reopen: the only selected LEAP is unreadable, so it blocks.
    harness.positions = [position({ symbol: 'UBER', avgOpenPrice: null }), position({ symbol: 'NFLX', strike: 90, avgOpenPrice: 20.85 })];
    renderScreener();
    fireEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    await screen.findByRole('button', { name: 'RUN PMCC SCAN →' });
    const chips = await screen.findByTestId('pmcc-held-leaps-selection');
    fireEvent.click(within(chips).getByRole('button', { name: 'NFLX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'FIND PMCCs' }));
    expect(await screen.findByText('Could not read cost basis. Cost basis for UBER could not be read from your broker. Refresh Portfolio and try again.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RUN PMCC SCAN →' })).toBeNull();
  });

  it('does not block when any selected LEAP is readable, multi-lot, or unit-suspect: the modal opens', async () => {
    for (const other of [
      position({ symbol: 'NFLX', strike: 90, avgOpenPrice: 20.85 }),
      position({ symbol: 'NFLX', strike: 90, avgOpenPrice: 20.85, quantity: 3 }),
      position({ symbol: 'NFLX', strike: 90, avgOpenPrice: 9999 }),
    ]) {
      harness.positions = [position({ symbol: 'UBER', avgOpenPrice: null }), other];
      const view = renderScreener();
      fireEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
      expect(await screen.findByRole('button', { name: 'RUN PMCC SCAN →' })).toBeInTheDocument();
      expect(screen.queryByText(/Could not read cost basis\./)).toBeNull();
      view.unmount();
    }
  });
});
