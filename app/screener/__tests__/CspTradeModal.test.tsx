// app/screener/__tests__/CspTradeModal.test.tsx
//
// CSP-ORDERS-0001 -- the CSP "TRADE THIS" button now opens a real,
// dedicated CspTradeModal (not the generic multi-leg TradeModal). Proves
// Diane's mock fields render and the modal is genuinely reachable from the
// result card, without exercising the live broker dry-run/submit network
// calls (covered instead by the pure unit tests in
// lib/scans/__tests__/cspOrderMath.test.ts and cspOrderSubmission.test.ts).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';

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

function expDate(): string { const d = new Date(); d.setDate(d.getDate() + 32); return d.toISOString().slice(0, 10); }

// Reuses the exact proven-good strike from CspDefaultDeltaFilter.test.tsx /
// CspCandidateDiscovery.test.tsx's AMD fixture (STRONG liquidity, real
// bestCandidate, known to render and expand correctly) rather than a new,
// undebugged single-strike fixture.
function chain() {
  const exp = expDate();
  return {
    expirations: [exp],
    chains: { [exp]: [{
      strikePrice: 235, expirationDate: exp, optionType: 'P' as const, delta: -0.24, bid: 6.90, ask: 7.60,
      openInterest: 1000, occSymbol: `MRVL_${exp}_P235`,
    }] },
  };
}

async function runCspScan() {
  getChainMock.mockResolvedValue(chain());
  getMarketMetricsMock.mockResolvedValue([{ symbol: 'MRVL', price: 263.58, ivRank: 35, earningsExpectedDate: null, expirationIvxMap: {} }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) }));

  render(<TaskProvider><CommandProvider><ScreenerPage /></CommandProvider></TaskProvider>);
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, 'MRVL');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.click(await screen.findByRole('button', { name: /Find CSPs/i }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN CSP SCAN/i }));
  await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByText(/QUALIFIED/).length).toBeGreaterThan(0));
  // The result card's detail (including the action buttons) is collapsed
  // until the card itself is clicked.
  const cards = screen.getAllByText('MRVL');
  await userEvent.click(cards[cards.length - 1]);
  await waitFor(() => expect(screen.getByRole('button', { name: /TRADE THIS/ })).toBeInTheDocument());
}

describe('CSP-ORDERS-0001: the CSP result card offers real trade placement', () => {
  it('shows a real "TRADE THIS" button for CSP, not the old "not yet wired up" message', async () => {
    await runCspScan();
    await waitFor(() => expect(screen.getByRole('button', { name: /TRADE THIS/ })).toBeInTheDocument());
    expect(screen.queryByText(/CSP trade placement.*not yet wired up/)).not.toBeInTheDocument();
    // "Find Better" for CSP is still explicitly deferred, separate scope.
    expect(screen.getByText('"Find Better" for CSP is not yet wired up')).toBeInTheDocument();
  });

  it('opens CspTradeModal with Diane\'s mocked fields: strike line, Cash Required (not Max Loss as the label), and the assignment warning verbatim', async () => {
    await runCspScan();
    await userEvent.click(await screen.findByRole('button', { name: /TRADE THIS/ }));

    expect(await screen.findByText('PLACE CSP ORDER — MRVL')).toBeInTheDocument();
    const modal = screen.getByText('PLACE CSP ORDER — MRVL').closest('div[class*="rounded-2xl"]') as HTMLElement;
    expect(within(modal).getByText(/235P exp .* · Δ0\.24/)).toBeInTheDocument();
    expect(within(modal).getByText('Cash Required')).toBeInTheDocument();
    expect(within(modal).getByText('$23,500')).toBeInTheDocument();
    expect(within(modal).getByText(/Cash-secured — assignment would mean buying 100 shares\/contract at \$235\./)).toBeInTheDocument();
    expect(within(modal).getByText('Net Credit Limit · GTC')).toBeInTheDocument();
  });

  it('quantity and entry-limit controls work, and DRY RUN is the first action (matching the spread modal\'s confirm -> dry run flow)', async () => {
    await runCspScan();
    await userEvent.click(await screen.findByRole('button', { name: /TRADE THIS/ }));
    await screen.findByText('PLACE CSP ORDER — MRVL');

    const modal = screen.getByText('PLACE CSP ORDER — MRVL').closest('div[class*="rounded-2xl"]') as HTMLElement;
    expect(within(modal).getByRole('button', { name: 'DRY RUN' })).toBeInTheDocument();
    expect(within(modal).getByText('$23,500')).toBeInTheDocument();
    // Bump quantity to 2 -> cash required doubles. The quantity stepper's
    // "+" is the second one in the modal (the first is the entry-limit "+").
    const plusButtons = within(modal).getAllByText('+');
    await userEvent.click(plusButtons[plusButtons.length - 1]);
    await waitFor(() => expect(within(modal).getByText('$47,000')).toBeInTheDocument());
  });

  it('closes without side effects', async () => {
    await runCspScan();
    await userEvent.click(await screen.findByRole('button', { name: /TRADE THIS/ }));
    await screen.findByText('PLACE CSP ORDER — MRVL');
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    await waitFor(() => expect(screen.queryByText('PLACE CSP ORDER — MRVL')).not.toBeInTheDocument());
  });
});
