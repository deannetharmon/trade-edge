// features/portfolio/components/__tests__/PercentPriceInputs.test.tsx

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PercentPriceInputs } from '../PercentPriceInputs';
import { keptPct, parseTickSizes, roundToTick } from '@/lib/portfolio/tickSize';

const TABLE = parseTickSizes([{ threshold: '3.0', value: '0.01' }, { value: '0.05' }]);
const CREDIT = 5.4;

// A parent wired the way the stop dialog wires it: % asks for a tick-rounded price; the % shown follows the price.
function TargetHarness({ onSent, initial = '2.70' }: { onSent?: (price: string) => void; initial?: string }) {
  const [price, setPrice] = useState(initial);
  const set = (p: string) => { setPrice(p); onSent?.(p); };
  return (
    <PercentPriceInputs
      tone="target" pctLabel="Profit target % of credit kept" priceLabel="Limit $"
      pct={keptPct(CREDIT, parseFloat(price))} price={price}
      onPctChange={pct => set(roundToTick(CREDIT * (1 - pct / 100), TABLE).toFixed(2))}
      onPriceChange={set}
      error={parseFloat(price) >= CREDIT ? 'Target must be below the $5.40 credit.' : null}
    />
  );
}

const pctBox = () => screen.getByLabelText(/% of credit kept/) as HTMLInputElement;
const priceBox = () => screen.getByLabelText(/Limit \$/) as HTMLInputElement;

describe('PercentPriceInputs', () => {
  it('typing a percentage updates the price (tick-rounded)', () => {
    render(<TargetHarness />);
    fireEvent.change(pctBox(), { target: { value: '30' } });
    expect(priceBox().value).toBe('3.80');
  });

  it('typing a price updates the percentage', () => {
    render(<TargetHarness />);
    fireEvent.change(priceBox(), { target: { value: '1.35' } });
    expect(pctBox().value).toBe('75');
  });

  it('keeps the typed percentage while typing, then shows the sent percentage on blur', () => {
    render(<TargetHarness />);
    fireEvent.change(pctBox(), { target: { value: '30' } });
    expect(pctBox().value).toBe('30');
    fireEvent.blur(pctBox());
    expect(pctBox().value).toBe('29.6');
  });

  it('typing 50% or typing $2.70 sends the identical price', () => {
    const viaPct = vi.fn();
    const { unmount } = render(<TargetHarness onSent={viaPct} initial="1.00" />);
    fireEvent.change(pctBox(), { target: { value: '50' } });
    unmount();
    const viaPrice = vi.fn();
    render(<TargetHarness onSent={viaPrice} initial="1.00" />);
    fireEvent.change(priceBox(), { target: { value: '2.70' } });
    expect(viaPct.mock.calls.at(-1)?.[0]).toBe('2.70');
    expect(viaPrice.mock.calls.at(-1)?.[0]).toBe('2.70');
  });

  it('shows an invalid entry under the box that was typed in', () => {
    render(<TargetHarness />);
    fireEvent.change(priceBox(), { target: { value: '6.00' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Target must be below the $5.40 credit.');
    expect(priceBox().closest('label')).toContainElement(alert);
  });

  it('ignores a non-numeric percentage instead of sending a price', () => {
    const onSent = vi.fn();
    render(<TargetHarness onSent={onSent} />);
    fireEvent.change(pctBox(), { target: { value: '' } });
    expect(onSent).not.toHaveBeenCalled();
  });
});
