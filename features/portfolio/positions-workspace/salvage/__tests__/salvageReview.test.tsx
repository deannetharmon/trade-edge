// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Position } from '@/lib/portfolio-data/types';
import type { WingRow } from '@/lib/salvage/salvageCandidates';
import { salvageEligibility } from '@/lib/salvage/salvageEligibility';
import { SalvageReview } from '../SalvageReview';
import type { SalvageDeps } from '../SalvageDeps';

const OCC = 'MRNA  261120P00110000';
const pos = {
  key: 'k', symbol: 'MRNA', accountNumber: 'ACCT1', expDate: '2026-11-20', dte: 35, quantity: 1, stockPrice: 215.9,
  structureAmbiguous: false, structureBlockMessage: null, pairedShortCallKey: null, hasGtc: false,
  legs: [{ optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, currentPrice: 2.08 }],
  identity: { structureType: 'NAKED', quantity: 1, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -2574 },
} as unknown as Position;
const row: WingRow = { strike: 110, occSymbol: OCC, bid: 0.5, ask: 0.55, delta: -0.02, creditNet: 48.86, maxFromToday: 3048.86, objective: null, warnings: [], proposable: true };
const elig = salvageEligibility(pos);
if (!elig.eligible) throw new Error('fixture');

function setup(over: Partial<SalvageDeps> = {}, reloadRow: WingRow | null = row) {
  const deps: SalvageDeps = {
    fetchFreshPosition: vi.fn().mockResolvedValue(pos),
    dryRun: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [], buyingPowerChange: 0, fees: 0.15 }),
    submit: vi.fn().mockResolvedValue({ orderId: '777' }),
    ...over,
  };
  const reload = vi.fn().mockResolvedValue({ row: reloadRow, tickTable: null });
  render(<SalvageReview position={pos} eligible={elig as never} row={row} wingQuantity={1} tickTable={null} objectiveLine="Original debit $2,574: can meet only if MRNA finishes at or below $114.74." earnings={{ before: true, date: '2026-11-06', daysAway: 21 }} deps={deps} reload={reload} onBack={() => {}} onClose={() => {}} />);
  return { deps, reload };
}

describe('SalvageReview', () => {
  it('shows the order terms and keeps Submit disabled until a clean dry run', () => {
    const { deps } = setup();
    expect(screen.getByTestId('review-price').textContent).toContain('$0.50');
    expect((screen.getByTestId('review-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(deps.dryRun).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it('dry run -> Submit places exactly one order after re-reading position and quotes', async () => {
    const { deps, reload } = setup();
    fireEvent.click(screen.getByTestId('review-dry-run'));
    await waitFor(() => expect(screen.getByTestId('review-dry-ok')).toBeTruthy());
    const dryOrder = (deps.dryRun as any).mock.calls[0][0];
    expect(dryOrder.legs[0]).toMatchObject({ symbol: OCC, action: 'Sell to Open' });
    fireEvent.click(screen.getByTestId('review-submit'));
    await waitFor(() => expect(screen.getByTestId('review-done').textContent).toContain('777'));
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.fetchFreshPosition).toHaveBeenCalledWith('k');
    expect(reload).toHaveBeenCalledTimes(1);
    expect((deps.submit as any).mock.calls[0][0]).toEqual(dryOrder);
  });
  it('a failed dry run keeps Submit disabled and shows the broker message', async () => {
    const { deps } = setup({ dryRun: vi.fn().mockResolvedValue({ valid: false, errors: ['Insufficient buying power'], warnings: [], buyingPowerChange: null, fees: null }) });
    fireEvent.click(screen.getByTestId('review-dry-run'));
    await waitFor(() => expect(screen.getByTestId('review-error').textContent).toContain('Insufficient buying power'));
    expect((screen.getByTestId('review-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it('blocks at Submit when the bid moved: no order is sent', async () => {
    const { deps } = setup({}, { ...row, bid: 0.4 });
    fireEvent.click(screen.getByTestId('review-dry-run'));
    await waitFor(() => screen.getByTestId('review-dry-ok'));
    fireEvent.click(screen.getByTestId('review-submit'));
    await waitFor(() => expect(screen.getByTestId('review-error').textContent).toContain('Order not sent'));
    expect(screen.getByTestId('review-error').textContent).toContain('bid moved');
    expect(deps.submit).not.toHaveBeenCalled();
    expect((screen.getByTestId('review-submit') as HTMLButtonElement).disabled).toBe(true);
  });
  it('blocks at Submit when the position changed', async () => {
    const { deps } = setup({ fetchFreshPosition: vi.fn().mockResolvedValue({ ...pos, hasGtc: true }) });
    fireEvent.click(screen.getByTestId('review-dry-run'));
    await waitFor(() => screen.getByTestId('review-dry-ok'));
    fireEvent.click(screen.getByTestId('review-submit'));
    await waitFor(() => expect(screen.getByTestId('review-error').textContent).toContain('closing order'));
    expect(deps.submit).not.toHaveBeenCalled();
  });
});
