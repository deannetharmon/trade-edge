// app/screener/__tests__/CcEarningsAdvisory.test.tsx
//
// EARNINGS-PRECHECK-0001 (Quinn's conditional hold): checklist-level
// regression for the covered-call scan. runCcChecklist() is private to
// app/screener/page.tsx, so this drives the real page (only the network
// boundary in lib/scans/tastytrade-client is mocked) and asserts what the
// trader sees when a CC has NO eligible candidate and earnings is nearby:
// the earnings pre-check is an advisory, never an earnings failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { currentNewYorkDate } from '@/lib/scans/earningsPrecheck';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();

vi.mock('@/components/portfolio-data/PortfolioDataProvider', () => {
  const stablePositions: unknown[] = [];
  return {
    usePortfolioData: () => ({ snapshot: null }),
    useOptionalPortfolioData: () => ({ snapshot: null, positions: stablePositions, refresh: null }),
  };
});

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getCoveredCallCapacityReport: (...args: any[]) => getCoveredCallCapacityReportMock(...(args as [])),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: vi.fn().mockResolvedValue(100),
    getChain: (...args: any[]) => getChainMock(...args),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(10000),
    getCspCapitalContext: vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 10000, cashBalance: 10000 }),
  };
});

function dayOut(n: number): string {
  const [y, m, d] = currentNewYorkDate().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A chain whose single call per expiry has the given delta (0.28 is inside the 0.20-0.35 CC band). */
function ccChain(days: number[], delta: number) {
  const expirations = days.map(dayOut);
  const chains: Record<string, unknown[]> = {};
  expirations.forEach((e) => {
    chains[e] = [{ strikePrice: 105, expirationDate: e, optionType: 'C', delta, openInterest: 500, bid: 1.2, ask: 1.3, mid: 1.25, occSymbol: `NKE${e}C105` }];
  });
  return { expirations, chains, isEtfOrIndex: false, classification: 'stock' };
}

async function scanCc(earningsDate: string, chain: ReturnType<typeof ccChain>) {
  getChainMock.mockResolvedValue(chain);
  getMarketMetricsMock.mockResolvedValue([{ symbol: 'NKE', ivRank: 40, ivx: 30, earningsExpectedDate: earningsDate, expirationIvxMap: {} }]);
  getCoveredCallCapacityReportMock.mockResolvedValue({
    status: 'ok',
    bySymbol: { NKE: {
      sharesOwned: 100, costBasis: 50, costBasisComplete: true, grossCoveredContracts: 1,
      existingShortCallContracts: 0, workingShortCallContracts: 0, availableCoveredContracts: 1,
      oversubscribed: false, hasUnclassifiedExposure: false,
    } },
    warnings: [],
  });
  render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, 'NKE');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
  await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
  await waitFor(() => expect(getChainMock).toHaveBeenCalled());
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset();
  getMarketMetricsMock.mockReset();
  getChainMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Text of every red failure line on the page. */
function redFailureText(): string {
  return Array.from(document.querySelectorAll('.text-red-500')).map(el => el.textContent ?? '').join(' | ');
}

describe('EARNINGS-PRECHECK-0001: CC with no eligible candidate shows an earnings advisory, not an earnings failure', () => {
  it('earnings inside the window, nothing in the delta band: advisory copy, generic no-candidate reason, no earnings failure', async () => {
    const earnings = dayOut(30);
    await scanCc(earnings, ccChain([25, 40], 0.60)); // delta 0.60 is outside 0.20-0.35: nothing qualifies
    // Summary row reason is the generic no-candidate reason, not an earnings reason.
    expect((await screen.findAllByText(/^No qualifying call found in delta 0\.2-0\.35/)).length).toBeGreaterThan(0);
    await userEvent.click(await screen.findByLabelText('Show checks for NKE'));

    // The earnings row is the advisory: earlier expirations remain.
    expect(await screen.findByText(
      new RegExp(`Earnings in 30d \\(${earnings}\\): expirations on or after ${earnings} are excluded; earlier expirations remain\\.`),
    )).toBeInTheDocument();
    // Not an earnings failure: no contract-level failure copy, and nothing earnings-related in any red line.
    expect(screen.queryByText(/falls on or before this/)).not.toBeInTheDocument();
    expect(redFailureText()).not.toMatch(/arnings/);
  });

  it('every expiry on or after earnings: the summary row carries the no-eligible-expiration advisory (amber), never the contract-level failure copy', async () => {
    const earnings = dayOut(22);
    await scanCc(earnings, ccChain([25, 40], 0.28));
    const advisory = `Earnings in 22d (${earnings}) fall before every expiry in the 21-45d window: no eligible expiration.`;
    const summary = await screen.findByTitle(advisory);
    expect(summary).toHaveTextContent(advisory);
    expect(summary.className).toMatch(/amber/);
    expect(screen.queryByText(/falls on or before this/)).not.toBeInTheDocument();
    expect(redFailureText()).not.toMatch(/arnings/);
  });

  // The guard from the same ruling: a plain advisory while an eligible expiry remains must NOT count as an
  // earnings fail, so no post-earnings re-screen is offered.
  it('earnings inside the window with an eligible earlier expiry: no earnings block, no re-screen offer', async () => {
    const earnings = dayOut(30);
    await scanCc(earnings, ccChain([25, 40], 0.28));
    await waitFor(() => expect(getChainMock).toHaveBeenCalled());
    expect(screen.queryByTitle(/Schedule re-screen \d+ trading days after earnings/)).not.toBeInTheDocument();
  });
});
