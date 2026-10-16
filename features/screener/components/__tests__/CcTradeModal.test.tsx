// features/screener/components/__tests__/CcTradeModal.test.tsx

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcTradeModal, type CcOrderInput } from '../CcTradeModal';
import type { CcOrderDeps } from '@/lib/scans/ccOrderDeps';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';

const th = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', sidebar: 'bg-[#101010]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
} as never;

const order: CcOrderInput = {
  symbol: 'BITX', occSymbol: 'BITX  261106C00016000', strike: 16, expiration: '2026-11-06', dte: 22, delta: 0.3, midPerShare: 0.4, isIndex: false,
};

function reports(over: { shares?: number; basis?: number | null } = {}): CoverageReports {
  const basis = over.basis === undefined ? 14 : over.basis;
  return {
    capacity: { status: 'ok', bySymbol: { BITX: { availableCoveredContracts: over.shares === undefined ? 2 : over.shares, costBasis: basis, costBasisComplete: basis != null } }, warnings: [] } as never,
    foundations: { status: 'ok', warnings: [], foundations: [] } as never,
  };
}

function makeDeps(over: Partial<CcOrderDeps> = {}): CcOrderDeps {
  return {
    isMarketOpen: () => true,
    fetchQuote: async () => ({ bid: 0.39, ask: 0.41, ageSeconds: 2 }),
    readCoverage: async () => reports(),
    dryRun: vi.fn(async () => ({ 'buying-power-effect': { 'change-in-buying-power': '0.00', 'change-in-buying-power-effect': 'None' } })),
    place: vi.fn(async () => ({ orderId: 'ORD-1' })),
    now: () => 1000000,
    ...over,
  };
}

async function open(deps: CcOrderDeps, o: CcOrderInput = order) {
  render(<CcTradeModal th={th} order={o} deps={deps} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('cc-coverage').textContent).not.toMatch(/Checking/));
}

describe('CcTradeModal', () => {
  it('shows proven coverage and places exactly once after a dry run, with one Buy to Close and no stop', async () => {
    const deps = makeDeps();
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    const place = await screen.findByRole('button', { name: /PLACE/ });
    expect(deps.dryRun).toHaveBeenCalledTimes(1);
    const payload: any = (deps.dryRun as any).mock.calls[0][0];
    expect(payload.type).toBe('OTO');
    expect(payload.orders).toHaveLength(1);
    expect(payload.orders[0].legs[0].action).toBe('Buy to Close');
    expect(payload['trigger-order'].legs[0].action).toBe('Sell to Open');
    expect(JSON.stringify(payload)).not.toMatch(/Stop/);
    await userEvent.click(place);
    await screen.findByText(/ORD-1/);
    expect(deps.place).toHaveBeenCalledTimes(1);
  });

  it('never places when coverage is unknown', async () => {
    const deps = makeDeps({ readCoverage: async () => { throw new Error('boom'); } });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    await screen.findByRole('alert');
    expect(deps.dryRun).not.toHaveBeenCalled();
    expect(deps.place).not.toHaveBeenCalled();
  });

  it('never places when shares do not cover the quantity', async () => {
    const deps = makeDeps({ readCoverage: async () => reports({ shares: 0 }) });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    await screen.findByRole('alert');
    expect(deps.dryRun).not.toHaveBeenCalled();
    expect(deps.place).not.toHaveBeenCalled();
  });

  it('refuses at place time if coverage disappears after the dry run', async () => {
    let n = 0;
    const deps = makeDeps({ readCoverage: async () => (++n <= 2 ? reports() : reports({ shares: 0 })) });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    await userEvent.click(await screen.findByRole('button', { name: /PLACE/ }));
    await screen.findByRole('alert');
    expect(deps.place).not.toHaveBeenCalled();
  });

  it('requires acknowledgment when the strike is below cost basis', async () => {
    const deps = makeDeps({ readCoverage: async () => reports({ basis: 20 }) });
    await open(deps);
    const btn = screen.getByRole('button', { name: /ACKNOWLEDGE/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: 'DRY RUN' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a LEAP-covered call shows the LEAP note and never asks about share cost basis', async () => {
    const leapReports: CoverageReports = {
      capacity: { status: 'ok', bySymbol: { BITX: { availableCoveredContracts: 0, costBasis: 20, costBasisComplete: true } }, warnings: [] } as never,
      foundations: { status: 'ok', warnings: [], foundations: [{ underlyingSymbol: 'BITX', expiration: '2027-01-15', strike: 10, availableShortCallContracts: 2 }] } as never,
    };
    await open(makeDeps({ readCoverage: async () => leapReports }));
    expect(screen.getByTestId('cc-leap-note')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByTestId('cc-vs-basis')).toBeNull();
    expect((screen.getByRole('button', { name: 'DRY RUN' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no basis requirement when cost basis is unknown', async () => {
    await open(makeDeps({ readCoverage: async () => reports({ basis: null }) }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/cost basis is not available/)).toBeTruthy();
  });

  it('refuses a dry run when the market is closed', async () => {
    const deps = makeDeps({ isMarketOpen: () => false });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Market is closed/);
    expect(deps.dryRun).not.toHaveBeenCalled();
  });

  it('refuses a stale quote', async () => {
    const deps = makeDeps({ fetchQuote: async () => ({ bid: 0.39, ask: 0.41, ageSeconds: 40 }) });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/older than 15 seconds/);
    expect(deps.dryRun).not.toHaveBeenCalled();
  });

  it('refuses to place when the market moved since validation', async () => {
    let bid = 0.39;
    const deps = makeDeps({ fetchQuote: async () => ({ bid, ask: bid + 0.02, ageSeconds: 1 }) });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    const place = await screen.findByRole('button', { name: /PLACE/ });
    bid = 0.3;
    await userEvent.click(place);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Market moved/);
    expect(deps.place).not.toHaveBeenCalled();
  });

  it('refuses to place when validation expired', async () => {
    let t = 1000000;
    const deps = makeDeps({ now: () => t });
    await open(deps);
    await userEvent.click(screen.getByRole('button', { name: 'DRY RUN' }));
    const place = await screen.findByRole('button', { name: /PLACE/ });
    t += 20000;
    await userEvent.click(place);
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    expect(deps.place).not.toHaveBeenCalled();
  });

  it('blocks when the option symbol is missing', async () => {
    await open(makeDeps(), { ...order, occSymbol: '' });
    expect((screen.getByRole('button', { name: 'DRY RUN' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
