// app/wheel/__tests__/WheelPageTabs.test.tsx
//
// WHEEL-SYSTEM-0001 (W1) -- adding the Plan tab must leave the Candidates tab exactly as it was: still rendered, and its
// data loading and searches must not re-run when the trader switches tabs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchWheelChain = vi.fn();
const getWheelQuote = vi.fn();
const getAccessToken = vi.fn();

vi.mock('@/lib/wheel/chainSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wheel/chainSearch')>();
  return { ...actual, fetchWheelChain: (...a: unknown[]) => fetchWheelChain(...a), getWheelQuote: (...a: unknown[]) => getWheelQuote(...a) };
});
vi.mock('@/lib/auth/tastytradeToken', () => ({ getAccessToken: () => getAccessToken(), LS_ACCESS_TOKEN: 'a', LS_ACCESS_TOKEN_EXPIRY: 'b' }));
vi.mock('@/lib/tastytrade/browser-token', () => ({ refreshBrowserAccessToken: vi.fn() }));
vi.mock('@/features/wheel/WheelPlanTab', () => ({ default: () => <div>PLAN TAB CONTENT</div> }));

import WheelPage from '../page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchWheelChain.mockReset().mockResolvedValue({ expirations: [], chains: {} });
  getWheelQuote.mockReset().mockResolvedValue(100);
  getAccessToken.mockReset().mockResolvedValue('token');
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (String(url).includes('wheel-config')) {
      return { json: async () => ({ config: { defaultDeltaMin: 15, defaultDeltaMax: 25, defaultDteMin: 30, defaultDteMax: 45, updatedAt: '' } }) };
    }
    return { json: async () => ({ candidates: { XLF: { symbol: 'XLF', wheelStage: 'hunting-csp', updatedAt: '' } } }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Wheel page tabs', () => {
  it('opens on Candidates, unchanged', async () => {
    render(<WheelPage />);
    expect(await screen.findByText('XLF')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Candidates' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('PLAN TAB CONTENT')).not.toBeInTheDocument();
    expect(screen.getByText(/Default delta: 15-25/)).toBeInTheDocument();
  });

  it('switching to Plan and back keeps Candidates mounted and re-runs no fetch or search', async () => {
    render(<WheelPage />);
    await screen.findByText('XLF');
    await waitFor(() => expect(fetchWheelChain).toHaveBeenCalledTimes(1));
    const fetchCalls = fetchMock.mock.calls.length;

    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByText('PLAN TAB CONTENT')).toBeInTheDocument();
    expect(screen.getByTestId('wheel-candidates-panel')).toHaveClass('hidden');
    expect(screen.getByText('XLF')).toBeInTheDocument(); // still mounted, just hidden

    await userEvent.click(screen.getByRole('tab', { name: 'Candidates' }));
    expect(screen.queryByText('PLAN TAB CONTENT')).not.toBeInTheDocument();
    expect(screen.getByTestId('wheel-candidates-panel')).not.toHaveClass('hidden');

    expect(fetchWheelChain).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBe(fetchCalls);
  });
});
