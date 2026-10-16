// app/screener/__tests__/TradeLookupLauncher.test.tsx
//
// TRADE-LOOKUP-0001D: the Screener sidebar launcher that opens Trade Lookup. Real page.tsx wiring; only the network
// boundary is mocked, the same way UnifiedStrategyLauncher.test.tsx does it.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { warmScreenerPage, WARM_HOOK_TIMEOUT_MS, WARM_FLOW_TIMEOUT_MS } from './helpers/warmScreenerPage';

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getQuote: vi.fn().mockResolvedValue(100),
    getChain: vi.fn().mockResolvedValue({ expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' }),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
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

// Same cold-start warm-up the other ScreenerPage tests use (CI-FLAKY-0001): drive the same open-dialog flow once.
beforeAll(() => warmScreenerPage(async () => {
  renderScreener();
  await userEvent.click(await screen.findByRole('button', { name: 'POST LOOKUP' }));
  await screen.findByRole('dialog', { name: 'TRADE LOOKUP' }, { timeout: WARM_FLOW_TIMEOUT_MS });
}), WARM_HOOK_TIMEOUT_MS);

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
});

describe('TRADE-LOOKUP-0001D launcher', () => {
  it('POST LOOKUP opens the Trade Lookup dialog and it can be closed', async () => {
    renderScreener();
    const launcher = await screen.findByRole('button', { name: 'POST LOOKUP' });
    expect(launcher).not.toBeDisabled();
    await userEvent.click(launcher);
    expect(await screen.findByRole('dialog', { name: 'TRADE LOOKUP' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close trade lookup' }));
    expect(screen.queryByRole('dialog', { name: 'TRADE LOOKUP' })).not.toBeInTheDocument();
  }, WARM_FLOW_TIMEOUT_MS);
});
