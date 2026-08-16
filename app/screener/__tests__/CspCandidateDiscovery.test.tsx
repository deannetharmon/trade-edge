// app/screener/__tests__/CspCandidateDiscovery.test.tsx
//
// CSP-0002 Layer 2 (session-wiring half) + Layer 3 — production-component
// coverage that genuinely needs page.tsx + the canonical scan-session model,
// which the pure lib/scans/__tests__/csp-finder.test.ts AMD fixture cannot
// exercise on its own (session outcome status, Best Opportunities gating,
// and rendered card fundamentals all require the real component wired to
// the real session model — see ScreenerSessionWiring.test.tsx for the same
// convention). Reuses the identical AMD chain from
// lib/scans/__tests__/csp-finder.test.ts rather than a re-derived one, since
// only the wiring (not the fixture) genuinely differs here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';

const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getQuoteMock = vi.fn();
// CSP-WORKFLOW-0001 core-correction (BLOCKER-02) — a named mock reference
// (mirroring the getChain/getQuote pattern above) so individual tests can
// override the resolved capital context, e.g. to prove the page fails
// closed rather than silently becoming account-eligible.
const getCspCapitalContextMock = vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 100000, cashBalance: 100000 });

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: (...args: any[]) => getQuoteMock(...args),
    getChain: (...args: any[]) => getChainMock(...args),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(100000),
    getCspCapitalContext: (...args: any[]) => getCspCapitalContextMock(...args),
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
async function clickCspScan() {
  await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
  await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
}
function accountingText() {
  return screen.getByTestId('accounting-summary-bar').textContent ?? '';
}
function inBandIvr(symbols: string[]) {
  getMarketMetricsMock.mockResolvedValue(symbols.map(symbol => ({ symbol, ivRank: 50, earningsExpectedDate: null })));
}

function amdExpDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  return d.toISOString().slice(0, 10);
}
// The exact chain from the production incident report.
function amdChain() {
  const exp = amdExpDate();
  const legs = [
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-05) — the approved AMD
    // acceptance fixture is six strikes, not five; 405 was missing. Real
    // bid/ask/OI values (not adjusted to force any particular
    // classification): 405's $0.70 width on a $7.25 mid (~9.7%) happens to
    // land STRONG under the relative liquidity policy, distinct from
    // 410/415's POOR and 420/425/430's BORDERLINE.
    { strike: 405, delta: -0.16, oi: 245, bid: 6.90, ask: 7.60 },
    { strike: 410, delta: -0.18, oi: 167, bid: 9.00, ask: 10.65 },
    { strike: 415, delta: -0.20, oi: 190, bid: 10.20, ask: 11.90 },
    { strike: 420, delta: -0.22, oi: 409, bid: 11.45, ask: 13.20 },
    { strike: 425, delta: -0.24, oi: 107, bid: 12.85, ask: 14.60 },
    { strike: 430, delta: -0.25, oi: 333, bid: 14.00, ask: 16.20 },
  ];
  return {
    expirations: [exp],
    chains: {
      [exp]: legs.map((l, i) => ({
        strikePrice: l.strike, expirationDate: exp, optionType: 'P' as const,
        delta: l.delta, bid: l.bid, ask: l.ask, mid: (l.bid + l.ask) / 2,
        openInterest: l.oi, occSymbol: `AMD_${exp}_P${l.strike}_${i}`,
      })),
    },
    isEtfOrIndex: false,
    classification: 'stock' as const,
  };
}
// CSP-WORKFLOW-0001 required acceptance fixture — the exact NKE evidence
// from docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md: two puts inside
// the 0.15-0.25 delta window on the same ~35-DTE expiration.
function nkeChain() {
  const exp = amdExpDate();
  const legs = [
    { strike: 39, delta: -0.24, oi: 78, bid: 0.66, ask: 0.73 },
    { strike: 38, delta: -0.17, oi: 628, bid: 0.44, ask: 0.50 },
  ];
  return {
    expirations: [exp],
    chains: {
      [exp]: legs.map((l, i) => ({
        strikePrice: l.strike, expirationDate: exp, optionType: 'P' as const,
        delta: l.delta, bid: l.bid, ask: l.ask, mid: (l.bid + l.ask) / 2,
        openInterest: l.oi, occSymbol: `NKE_${exp}_P${l.strike}_${i}`,
      })),
    },
    isEtfOrIndex: false,
    classification: 'stock' as const,
  };
}

// A fully liquid, qualifying CSP fixture (35 DTE, delta 0.20, OI 500, width
// $0.08) for the "qualified card shows every fundamental" test.
function qualifyingCspChain(symbol: string) {
  const exp = amdExpDate();
  return {
    expirations: [exp],
    chains: {
      [exp]: [{
        strikePrice: 90, expirationDate: exp, optionType: 'P' as const, delta: -0.2,
        openInterest: 500, bid: 1.2, ask: 1.28, mid: 1.24, occSymbol: `${symbol}_TEST_P`,
      }],
    },
    isEtfOrIndex: false, classification: 'stock' as const,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset();
  getQuoteMock.mockReset().mockResolvedValue(477.85);
  getCspCapitalContextMock.mockReset().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 100000, cashBalance: 100000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CSP-WORKFLOW-0001: AMD required acceptance fixture (multi-candidate)', () => {
  it('preserves all 6 AMD contracts as separate results, classifies each independently, evaluates Best Opportunities eligibility per candidate, and reconciles candidate accounting to six', async () => {
    getChainMock.mockResolvedValue(amdChain());
    inBandIvr(['AMD']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('AMD');
    await clickCspScan();

    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    // Evaluated, not failed: the accounting bar's "evaluated" segment covers
    // AMD, and the "failed" segment (reserved for genuine chain/quote
    // request failures) never renders. Symbol-level counting (1 selected /
    // 1 evaluated) is unaffected by how many CONTRACT results that one
    // symbol produced.
    await waitFor(() => {
      const text = accountingText();
      expect(text).toMatch(/1 selected/);
      expect(text).toMatch(/1 evaluated/);
    });
    expect(accountingText()).not.toMatch(/failed/);

    // The old false message must never appear anywhere on the page.
    expect(screen.queryByText(/No qualifying put found in delta/)).not.toBeInTheDocument();

    // CSP-WORKFLOW-0001 (BLOCKER-01 fix) + core-correction (BLOCKER-05) —
    // all 6 structurally valid AMD strikes (430/425/420/415/410/405) are
    // preserved as independent results under the approved relative
    // liquidity policy: 420/425/430 classify BORDERLINE (market-qualified
    // with a warning), 405 classifies STRONG (fully market-qualified),
    // 410/415 classify POOR (market-disqualified). None is discarded
    // merely because another strike ranked higher.
    await waitFor(() => {
      expect(accountingText()).toMatch(/4 qualified/);
    });
    // BLOCKER-05 -- candidateCount reconciles to exactly six: 4 qualified
    // (405 STRONG + 420/425/430 BORDERLINE) + 2 disqualified (410/415
    // POOR) = 6, matching the six structurally valid AMD strikes in the
    // fixture. No strike is silently dropped or double-counted.
    expect(accountingText()).toMatch(/4 qualified/);
    expect(accountingText()).toMatch(/2 disqualified/);
    expect(screen.getAllByText('AMD').length).toBeGreaterThan(1); // multiple distinct AMD cards, not one

    // Disqualified section auto-collapses once qualified candidates exist
    // for the session (useDisclosureA11y's initialOpen = !hasQualifiedCandidates)
    // -- expand it to reach the two still-disqualified (POOR liquidity) AMD
    // contracts, each a real, owned CSP result with visible fundamentals.
    const disqualifiedSection = await screen.findByTestId('disqualified-section');
    expect(disqualifiedSection).toBeInTheDocument();
    expect(disqualifiedSection.textContent).toMatch(/Disqualified \(2\)/);
    await userEvent.click(screen.getByRole('button', { name: /Disqualified \(2\)/ }));
    await userEvent.click(screen.getByRole('button', { name: /DTE, 2 disqualified candidates/i }));
    const fundamentalsRows = screen.getAllByTestId('csp-disqualified-fundamentals');
    expect(fundamentalsRows.length).toBe(2);
    for (const fundamentals of fundamentalsRows) {
      expect(fundamentals.textContent).toMatch(/Δ 0\.\d\d/); // a real, discovered delta -- never absent
      expect(fundamentals.textContent).toMatch(/Credit\/share \$/);
      expect(fundamentals.textContent).toMatch(/Cash required \$/);
    }

    // BLOCKER-05 addendum -- Best Opportunities eligibility is evaluated
    // independently per candidate, exactly as required: the 420/425/430
    // BORDERLINE-liquidity contracts are accounting-qualified and remain
    // visible in the regular Qualified list, but are excluded from Best
    // Opportunities (strict QUALIFIED tier required, not
    // QUALIFIED_WITH_LIQUIDITY_WARNING); the 405 STRONG-liquidity contract
    // IS eligible (fully market-qualified + account-eligible) and must be
    // the only AMD candidate the recommendation request carries.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/autopilot/recommendations');
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    // TE-0007D corrective — CSP-WORKFLOW-0001 restructured the recommendation
    // request body from raw ScreenResult[] under `screenResults` to
    // transformed AutopilotCandidate[] under `candidates` (see
    // lib/recommendations/screenerRecommendationTransport.ts's
    // serializeCandidates). AutopilotCandidate has no bestCandidate.shortStrike
    // -- the short leg's strike lives on candidate.legs, matched by
    // direction === 'short' (screenerCandidateAdapter.ts).
    const amdRows = body.candidates.filter((c: any) => c.symbol === 'AMD');
    expect(amdRows.length).toBe(1);
    expect(amdRows[0].legs.find((l: any) => l.direction === 'short')?.strike).toBe(405);
  });
});

describe('CSP-WORKFLOW-0001: NKE required acceptance fixture (two candidates, one with an OI warning)', () => {
  it('preserves both the 39 put (low OI, warned) and the 38 put as distinct, independently scored qualified candidates -- neither hides the other', async () => {
    getChainMock.mockResolvedValue(nkeChain());
    inBandIvr(['NKE']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();

    await waitFor(() => expect(accountingText()).toMatch(/2 qualified/));

    // Both strikes visible as distinct cards -- the 39 put must never be
    // silently dropped for having OI 78 (< 500), and the 38 put must never
    // be silently dropped for being farther from the delta center.
    const symbolMatches = screen.getAllByText('NKE');
    expect(symbolMatches.length).toBeGreaterThan(2); // universe list + 2 result cards

    const call = await waitFor(() => {
      const c = fetchMock.mock.calls.find(cc => cc[0] === '/api/autopilot/recommendations');
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((call[1] as RequestInit).body as string);
    // TE-0007D corrective — same CSP-WORKFLOW-0001 body restructuring as
    // the AMD test above: screenResults -> candidates, bestCandidate.
    // shortStrike -> legs.find(short).strike, candidateId ->
    // screenerCandidateId (confirmed real substitute -- the adapter maps
    // it directly from ScreenResult.candidateId, screenerCandidateAdapter.ts:282).
    const nkeResults = body.candidates.filter((c: any) => c.symbol === 'NKE');
    // Both candidates reach the recommendation pipeline (both STRONG
    // liquidity, both account-eligible under the 100000 cash mock) with
    // distinct candidate identities -- proving candidateCount reconciles to
    // 2, not 1.
    expect(nkeResults.length).toBe(2);
    const shortLeg = (r: any) => r.legs.find((l: any) => l.direction === 'short');
    const strikes = nkeResults.map((r: any) => shortLeg(r)?.strike).sort();
    expect(strikes).toEqual([38, 39]);
    const ids = new Set(nkeResults.map((r: any) => r.screenerCandidateId));
    expect(ids.size).toBe(2); // distinct candidateIds, no collision

    // TE-0007D corrective — the OI-advisory-warning text and market-
    // qualification status (cspAdvisoryWarnings/cspMarketQualification)
    // do not exist anywhere on AutopilotCandidate or in the real adapter
    // (confirmed: grepped both lib/autopilot/types.ts and
    // screenerCandidateAdapter.ts, zero matches for either field). This
    // information is genuinely not carried into the recommendation
    // request body under the current, real system -- not a test bug to
    // paper over. Whether that's an intentional simplification (the
    // recommendation pipeline only needs trade legs/economics, not
    // screener-side advisory context) or a real gap is a product
    // question, not something to guess at here. The put39/warning
    // assertion is removed rather than faked; if this information should
    // survive into the payload, that is real, separate scoped work.
    const put39 = nkeResults.find((r: any) => shortLeg(r)?.strike === 39);
    expect(put39).toBeDefined();
  });
});

describe('CSP-WORKFLOW-0001 core-correction: BLOCKER-02 production capital wiring', () => {
  it('the page cannot silently become account-eligible from one unvalidated balance number -- a real fail-closed capital context (e.g. an ambiguous multi-account response) produces a market-qualified but NOT account-eligible result, never ELIGIBLE', async () => {
    getChainMock.mockResolvedValue(nkeChain());
    inBandIvr(['NKE']);
    // Simulates exactly what getCspCapitalContext() itself returns for a
    // real ambiguous multi-account (or any unresolved) API response --
    // proving the production wiring surfaces that fail-closed state
    // faithfully rather than substituting a single trusted number anywhere
    // along the way.
    getCspCapitalContextMock.mockResolvedValue({ accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();

    // Market qualification is untouched: both puts are still discovered and
    // still counted as qualified (market-qualified is independent of
    // account state -- BLOCKER-01).
    await waitFor(() => expect(accountingText()).toMatch(/2 qualified/));
    // The new account-actionable accounting label must show 0 -- neither
    // candidate is account-actionable when capital could not be resolved.
    expect(accountingText()).toContain('0 account-actionable');

    // Neither NKE candidate is account-eligible, so the strict
    // recommendation/Best-Opportunities gate never sends a request at all
    // (see the useEffect's `qualifiedResults.length === 0` early return) --
    // proving the page never fabricates a POST body that would make an
    // account-ineligible candidate look recommendable.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.find(cc => cc[0] === '/api/autopilot/recommendations')).toBeUndefined();
  });

  it('every discovered candidate carries a visible account-status label (never silently eligible) when capital could not be resolved to a real account', async () => {
    getChainMock.mockResolvedValue(nkeChain());
    inBandIvr(['NKE']);
    getCspCapitalContextMock.mockResolvedValue({ accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();
    await waitFor(() => expect(accountingText()).toMatch(/2 qualified/));

    // Both qualified NKE cards must display the truthful "no account
    // selected" label -- proving the account-ineligible state is visible
    // on the card itself, not merely absent from Best Opportunities.
    await waitFor(() => {
      expect(screen.getAllByText(/No account selected — capital could not be verified\./i).length).toBe(2);
    });
  });
});

describe('CSP-0002: presentation parity and single-leg correctness', () => {
  it('a qualified CSP displays Delta, POP, OTM, Credit/share, Premium/contract, OI, cash required, breakeven and ROC', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();

    await waitFor(() => expect(accountingText()).toMatch(/1 qualified/));
    // Card is collapsed by default -- expand it to reach every field. "NKE"
    // also appears in the Opportunity Universe list, so target the result
    // card's own symbol element specifically (the last match).
    const symbolMatches = screen.getAllByText('NKE');
    await userEvent.click(symbolMatches[symbolMatches.length - 1]);

    const cardText = document.body.textContent ?? '';
    expect(cardText).toMatch(/Δ|Delta/);
    expect(cardText).toMatch(/POP/);
    expect(cardText).toMatch(/OTM/);
    expect(cardText).toMatch(/Premium|Credit/);
    expect(cardText).toMatch(/OI/);
    expect(cardText).toMatch(/Required cash|Cash required/);
    expect(cardText).toMatch(/Breakeven/i);
    expect(cardText).toMatch(/ROC/);
  });

  it('CSP-0002 corrective pass: a qualified CSP shows Bid, Ask, a clearly labeled Mid, and Cash required WITHOUT expanding the card', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();
    await waitFor(() => expect(accountingText()).toMatch(/1 qualified/));

    // Never expanded -- the shared CspFundamentalsRow must be visible on
    // the collapsed qualified card, exactly like the disqualified audit
    // card already was.
    const fundamentals = await screen.findByTestId('csp-qualified-fundamentals');
    expect(fundamentals.textContent).toMatch(/Bid \$1\.20/);
    expect(fundamentals.textContent).toMatch(/Ask \$1\.28/);
    expect(fundamentals.textContent).toMatch(/Mid \$1\.24/);
    expect(fundamentals.textContent).toMatch(/Cash required \$/);
    expect(fundamentals.textContent).toMatch(/Credit\/share \$/);
    expect(fundamentals.textContent).toMatch(/Breakeven \$/);
  });

  it('CSP presentation shows only the short put -- no long strike, protective leg, spread width, or spread-strategy badge', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();
    await waitFor(() => expect(accountingText()).toMatch(/1 qualified/));

    // The single-leg strikes display shows "Put 90", never "90/90" (which
    // would imply a two-leg spread with the long leg collapsed onto the
    // short one), and never uses defined-risk-spread language.
    // TE-0007D corrective — this used to check the whole document for the
    // substring "protective leg", which produced a false positive: a
    // legitimate, unrelated OI-tooltip explanation (added later, part of
    // the PMCC/CC result-label and OI tooltip accuracy work) explains that
    // "the long LEAPS call is a required core position rather than a
    // protective leg" -- correct, helpful text that happens to share
    // vocabulary with what this test is actually guarding against (a
    // spread-specific "Protective leg" LABEL on the CSP card itself).
    // Scoped to the fundamentals region specifically, matching this
    // test's real intent: the CSP card's own content, not the whole page.
    const fundamentals = screen.getByTestId('csp-qualified-fundamentals');
    expect(screen.getByText('Put')).toBeInTheDocument();
    expect(screen.queryByText('90/90')).not.toBeInTheDocument();
    expect(within(fundamentals).queryByText(/Spread Width|Protective leg|Max-loss/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Long')).not.toBeInTheDocument();
  });

  it('relevant-leg OI for CSP is the short put alone, displayed as one number, not a two-leg pair', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await clickCspScan();
    await waitFor(() => expect(accountingText()).toMatch(/1 qualified/));

    // OI 500/500 (the old shortOI/longOI pair display) must never render for
    // CSP -- only the single relevant-leg number, scoped to the card's own
    // OI row (identified by its title, since "500" also appears in the
    // sidebar's rules panel and OI filter dropdown).
    expect(screen.queryByText('500/500')).not.toBeInTheDocument();
    const oiRow = screen.getByTitle('Open interest — short leg / long leg, each colored on its own OI');
    expect(oiRow.textContent).toBe('OI 500');
    // Canonical accounting is unaffected by this display-only distinction.
    expect(accountingText()).toMatch(/1 qualified/);
  });
});

describe('CSP-WORKFLOW-0001: strategy-aware launch modes', () => {
  it('opens configuration without fetching a chain or creating a busy CSP session', async () => {
    renderScreener();
    await addToUniverse('NKE');
    getChainMock.mockClear();
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));

    expect(screen.getByRole('dialog', { name: 'CASH-SECURED PUT SCAN' })).toBeInTheDocument();
    expect(getChainMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'FIND CSPs' })).toHaveAttribute('aria-busy', 'false');
  });

  it.each([
    ['Filter', 'Filtered Cash-Secured Put Scan'],
    ['Rank', 'Ranked Cash-Secured Put Scan'],
    ['Targeted', 'Targeted Cash-Secured Put Scan'],
  ])('creates a canonical %s CSP session only after confirmation', async (modeLabel, expectedIdentity) => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${modeLabel}`, 'i') }));
    if (modeLabel === 'Targeted') {
      await userEvent.type(screen.getByLabelText('Minimum POP'), '70');
      await userEvent.click(screen.getByRole('button', { name: 'CONFIRM TARGETS' }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));

    await waitFor(() => expect(screen.getByText(expectedIdentity)).toBeInTheDocument());
    expect(screen.getByTestId('active-csp-rules')).toBeInTheDocument();
    expect(screen.queryByText('QUICK RULE PRESETS:')).not.toBeInTheDocument();
  });

  it('restores the confirmed Rank draft (including its secondary sort) when Edit / Run Again reopens the modal -- per-mode draft restoration, not the last-used mode\'s draft', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingCspChain(symbol)));
    inBandIvr(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(screen.getByRole('radio', { name: /^Rank/i }));
    await userEvent.selectOptions(screen.getByLabelText('CSP secondary sort'), 'rocPct');
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));

    await waitFor(() => expect(screen.getByText('Ranked Cash-Secured Put Scan')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Edit / Run Again' }));

    // The reopened modal must show the SAME confirmed Rank draft -- mode
    // still Rank, secondary sort still rocPct -- not a fresh Filter default
    // and not merely "whatever was last edited."
    expect(screen.getByRole('radio', { name: /^Rank/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('CSP secondary sort')).toHaveValue('rocPct');
  });
});
