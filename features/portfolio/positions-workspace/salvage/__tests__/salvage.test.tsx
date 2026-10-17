// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Position } from '@/lib/portfolio-data/types';
import { salvageEligibility } from '@/lib/salvage/salvageEligibility';
import type { ChainQuote } from '@/lib/salvage/salvageCandidates';
import { buildSalvageViewModel } from '../model';
import { SalvageEntry, SalvageView } from '../SalvagePanel';

const NOW = 1_800_000_000_000;
const pos = {
  key: 'k', symbol: 'MRNA', expDate: '2026-11-20', dte: 35, strategy: 'PUT', quantity: 1, stockPrice: 215.9,
  structureAmbiguous: false, structureBlockMessage: null, pairedShortCallKey: null, hasGtc: false,
  nextEarningsDate: '2026-11-06',
  legs: [{ symbol: 's', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 2.08, currentDelta: -0.074 }],
  identity: { structureType: 'NAKED', quantity: 1, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -2574 },
} as unknown as Position;
const q = (strike: number, bid: number, ask: number): ChainQuote => ({ right: 'P', strike, bid, ask, delta: -0.02, asOfMs: NOW - 5000 });
const quotes = [q(140, 2.08, 2.2), q(130, 1.35, 1.45), q(120, 0.85, 0.95), q(110, 0.5, 0.55), q(100, 0.3, 0.35)];
const elig = salvageEligibility(pos);

function vmFor(over: Partial<Parameters<typeof buildSalvageViewModel>[0]> = {}) {
  if (!elig.eligible) throw new Error('fixture must be eligible');
  return buildSalvageViewModel({ eligible: elig, position: pos, quotes, nowMs: NOW, todayYmd: '2026-10-16', objective: 'most', amount: null, rankBy: 'most', wingQuantity: 1, selectedStrike: 110, ...over });
}

describe('buildSalvageViewModel', () => {
  it('MRNA fixture: close, rows, selection, scenarios', () => {
    const vm = vmFor();
    expect(vm.unavailable).toBeNull();
    expect(vm.closeNow).toBe(207.86);
    expect(vm.rows.map((r) => r.strike).sort((a, b) => b - a)).toEqual([130, 120, 110, 100]);
    expect(vm.selected?.strike).toBe(110);
    expect(vm.scenarios).toHaveLength(6);
    expect(vm.scenarios[0]).toMatchObject({ price: 215.9, label: 'now', hold: 0 });
    expect(vm.earnings).toMatchObject({ before: true, daysAway: 21 });
  });
  it('ranking: most from today puts 100 first; credit puts 130 first; easiest puts the highest price first', () => {
    expect(vmFor({ rankBy: 'most' }).rows[0].strike).toBe(100);
    expect(vmFor({ rankBy: 'credit' }).rows[0].strike).toBe(130);
    const easiest = vmFor({ rankBy: 'easiest' }).rows.map((r) => r.strike);
    expect(easiest.slice(0, 2)).toEqual([110, 100]); // can-meet first, easiest price (114.74) before 114.54
  });
  it('a custom amount moves the target', () => {
    const vm = vmFor({ objective: 'amount', amount: 1000 });
    expect(vm.target).toBe(1000);
  });
  it('fails closed without a chain or without the long leg quote', () => {
    expect(vmFor({ quotes: null }).unavailable).toMatch(/did not load/);
    expect(vmFor({ quotes: quotes.filter((x) => x.strike !== 140) }).unavailable).toMatch(/No live bid/);
  });
});

describe('Salvage UI', () => {
  it('SalvageEntry renders for an eligible position and not for an ineligible one', () => {
    const { rerender } = render(<SalvageEntry position={pos} />);
    expect(screen.getByTestId('salvage-open')).toBeTruthy();
    rerender(<SalvageEntry position={{ ...pos, pairedShortCallKey: 'x' } as Position} />);
    expect(screen.queryByTestId('salvage-open')).toBeNull();
  });
  it('SalvageView shows the three choices, the gives-up line, and the earnings note', () => {
    const noop = () => {};
    render(<SalvageView vm={vmFor()} p={pos} objective="most" setObjective={noop} amountText="" setAmountText={noop} rankBy="most" setRankBy={noop} wingQuantity={1} setWingQuantity={noop} maxWing={1} selectedStrike={110} setSelectedStrike={noop} onRefresh={noop} loading={false} onClose={noop} />);
    expect(screen.getByTestId('salvage-close').textContent).toBe('$207.86');
    expect(screen.getByTestId('salvage-wing-credit').textContent).toContain('+$48.86');
    expect(screen.getByTestId('salvage-gives-up').textContent).toContain('adds at most $3,000');
    expect(screen.getByTestId('salvage-earnings').textContent).toContain('Event volatility impact is not available');
    expect(screen.getByTestId('salvage-row-110').textContent).toContain('Can meet');
    expect(screen.getByTestId('salvage-row-130').textContent).toContain('Partial only');
  });
  it('SalvageView leads with a plain-words summary and rows are selectable', async () => {
    const { fireEvent } = await import('@testing-library/react');
    let picked: number | null = null;
    const noop = () => {};
    render(<SalvageView vm={vmFor()} p={pos} objective="debit" setObjective={noop} amountText="" setAmountText={noop} rankBy="most" setRankBy={noop} wingQuantity={1} setWingQuantity={noop} maxWing={1} selectedStrike={110} setSelectedStrike={(n) => { picked = n; }} onRefresh={noop} loading={false} onClose={noop} />);
    const text = screen.getByTestId('salvage-bottom-line').textContent ?? '';
    expect(text).toContain('$207.86');
    expect(text).toContain('$114.74');
    expect(text).toContain('the $2,574 you paid');
    fireEvent.click(screen.getByTestId('salvage-row-120'));
    expect(picked).toBe(120);
    expect(screen.getByTestId('salvage-legend')).toBeTruthy();
  });
  it('SalvageView shows "Salvage unavailable" when the model is unavailable', () => {
    const noop = () => {};
    render(<SalvageView vm={vmFor({ quotes: null })} p={pos} objective="most" setObjective={noop} amountText="" setAmountText={noop} rankBy="most" setRankBy={noop} wingQuantity={1} setWingQuantity={noop} maxWing={1} selectedStrike={null} setSelectedStrike={noop} onRefresh={noop} loading={false} onClose={noop} />);
    expect(screen.getByTestId('salvage-unavailable').textContent).toContain('Salvage unavailable');
  });
});

describe('Salvage dialog stacking', () => {
  it('opens in a portal on document.body, above every sticky header', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { container } = render(<table><tbody><tr><td><SalvageEntry position={pos} /></td></tr></tbody></table>);
    fireEvent.click(screen.getByTestId('salvage-open'));
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain('z-[200]');
  });
});
