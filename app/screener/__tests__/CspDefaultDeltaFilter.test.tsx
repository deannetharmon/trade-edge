// app/screener/__tests__/CspDefaultDeltaFilter.test.tsx
//
// CSP-DEFAULT-DELTA-0001 (Ian) -- the CSP result view previously defaulted the
// Delta chip to "Any," so a scan's first view included every market-qualified
// strike outside the scan's own preferred delta band (i.e. the near-certain-
// assignment, low-POP contracts covered by CSP-SCORING-GATE-CARD-0001) even
// though that band is already published above the results as "ACTIVE CSP
// RULES." The result view now defaults the Delta chip to the active scan's
// own ruleSnapshot.deltaMin/deltaMax; the chip remains a one-click override,
// including an explicit "Any" that shows everything again.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { warmScreenerPage, WARM_HOOK_TIMEOUT_MS, WARM_FLOW_TIMEOUT_MS } from './helpers/warmScreenerPage';

const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getCspCapitalContextMock = vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 1_000_000, cashBalance: 1_000_000 });

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: vi.fn(),
    getChain: (...args: any[]) => getChainMock(...args),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(1_000_000),
    getCspCapitalContext: (...args: any[]) => getCspCapitalContextMock(...args),
  };
});

function expDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  return d.toISOString().slice(0, 10);
}

// The 405/420 strikes are the exact AMD acceptance-fixture numbers from
// CspCandidateDiscovery.test.tsx (proven STRONG-liquidity, in the balanced
// preset's 0.15-0.25 band). 440 is a new strike, deliberately given tight
// liquidity and ample OI so it market-qualifies STRONG too -- delta (0.30,
// outside the band) is the ONLY variable under test.
function chain() {
  const exp = expDate();
  const legs = [
    { strike: 405, delta: -0.16, oi: 245, bid: 6.90, ask: 7.60 },
    { strike: 420, delta: -0.22, oi: 409, bid: 11.45, ask: 13.20 },
    { strike: 440, delta: -0.30, oi: 600, bid: 17.00, ask: 17.90 },
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
  };
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

async function runAmdCspScan(readyTimeout?: number) {
  getChainMock.mockResolvedValue(chain());
  getMarketMetricsMock.mockResolvedValue([{ symbol: 'AMD', price: 477.85, ivRank: 40, earningsExpectedDate: null, expirationIvxMap: {} }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) }));

  renderScreener();
  const opts = readyTimeout ? { timeout: readyTimeout } : undefined;
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i, undefined, opts);
  await userEvent.type(input, 'AMD');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.click(screen.getByRole('button', { name: /Find CSPs/i }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN CSP SCAN/i }, opts));
  await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled(), opts);
}

// CI-FLAKY-0001 follow-up: the first test flaked ('RUN CSP SCAN' not found) on the ScreenerPage cold start; warm it once here.
beforeAll(() => warmScreenerPage(async () => { await runAmdCspScan(WARM_FLOW_TIMEOUT_MS); }), WARM_HOOK_TIMEOUT_MS);

/** The result-controls row containing the Delta chip (label + all its preset buttons, including "Any") -- unique via its "0.10–0.16" preset label. */
function deltaControlsRow(): HTMLElement {
  return screen.getByText('0.10–0.16').closest('div') as HTMLElement;
}

/** CSP strikes render as two sibling spans ("Put " label + the strike number), not one text node, and each
 * strike can legitimately appear more than once (e.g. also in the Best Opportunities shortlist). */
function strikeShown(strike: number): boolean {
  return screen.queryAllByText((_content, el) => el?.tagName === 'DIV' && el.textContent === `Put ${strike}`).length > 0;
}

describe('CSP-DEFAULT-DELTA-0001: the CSP result view defaults to the scan\'s own preferred delta band', () => {
  it('market-qualifies all 3 strikes, but the DEFAULT view shows only the 2 inside the preferred band -- the out-of-band strike is qualified, just not shown by default', async () => {
    await runAmdCspScan();

    await waitFor(() => expect(screen.getByText(/Showing \d+ of \d+ qualified candidates/)).toBeInTheDocument());
    expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument();
    expect(strikeShown(440)).toBe(false);
    expect(strikeShown(405)).toBe(true);
    expect(strikeShown(420)).toBe(true);
  });

  it('the Delta chip shows the scan\'s own preferred band pre-selected, with a remove affordance, on first render (no click needed)', async () => {
    await runAmdCspScan();
    await waitFor(() => expect(screen.getByText(/Showing \d+ of \d+ qualified candidates/)).toBeInTheDocument());

    // "Active filter" chip list -- proves this reads as an applied filter,
    // not just a highlighted button, matching how every other chip behaves.
    expect(screen.getByRole('button', { name: /Remove filter: Δ 0\.15–0\.25/i })).toBeInTheDocument();
    // The matching preset button itself is shown selected.
    const preset = within(deltaControlsRow()).getByRole('button', { name: '0.15–0.25' });
    expect(preset.className).toMatch(/border-amber-500/);
  });

  it('clicking "Any" reveals the previously-hidden out-of-band strike -- the default never hides data permanently', async () => {
    await runAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    await userEvent.click(within(deltaControlsRow()).getByRole('button', { name: 'Any' }));

    await waitFor(() => expect(screen.getByText('Showing 3 of 3 qualified candidates')).toBeInTheDocument());
    expect(strikeShown(440)).toBe(true);
    expect(screen.queryByRole('button', { name: /Remove filter: Δ/i })).not.toBeInTheDocument();
  });

  it('an explicit user choice always wins over the default, including narrowing to a different band entirely', async () => {
    await runAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    // 0.30-0.45 keeps only the 440 strike (delta exactly 0.30, inclusive)
    // and excludes both fixture strikes the default band had been showing.
    await userEvent.click(within(deltaControlsRow()).getByRole('button', { name: '0.30–0.45' }));

    await waitFor(() => expect(screen.getByText('Showing 1 of 3 qualified candidates')).toBeInTheDocument());
    expect(strikeShown(440)).toBe(true);
    expect(strikeShown(405)).toBe(false);
  });

  it('"Reset result filters" clears the override back to true Any, same as every other chip -- not back to the scan\'s preferred band', async () => {
    await runAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    await userEvent.click(within(deltaControlsRow()).getByRole('button', { name: '0.30–0.45' }));
    await waitFor(() => expect(screen.getByText('Showing 1 of 3 qualified candidates')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Reset result filters' }));

    await waitFor(() => expect(screen.getByText('Showing 3 of 3 qualified candidates')).toBeInTheDocument());
    expect(strikeShown(440)).toBe(true);
  });
});
