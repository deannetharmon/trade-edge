// features/portfolio/positions-workspace/__tests__/IntentSelect.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Position } from '@/lib/portfolio-data/types';
import { IntentSelect } from '../IntentSelect';

const make = (over: Partial<Position>): Position => ({ key: 'K1', symbol: 'AAPL', strategy: 'PUT', dte: 30, intent: 'acquisition', legs: [{ direction: 'Short', optionType: 'P' }], ...over } as unknown as Position);
const optionLabels = () => screen.getAllByRole('option').map(o => o.textContent);

describe('IntentSelect', () => {
  it('a lone short put shows Income / Acquire / Wheel / Neutral, with the stored value selected', () => {
    render(<IntentSelect position={make({})} onIntentChange={() => {}} />);
    expect(optionLabels()).toEqual(['Income', 'Acquire', 'Wheel', 'Neutral']);
    expect(screen.getByRole('combobox', { name: 'Intent for AAPL' })).toHaveValue('acquisition');
  });

  it('a LEAP shows Hold / PMCC / Undecided, and the default income value reads as Undecided', () => {
    render(<IntentSelect position={make({ strategy: 'CALL', dte: 470, intent: 'income', legs: [{ direction: 'Long', optionType: 'C' }] as never })} onIntentChange={() => {}} />);
    expect(optionLabels()).toEqual(['Hold', 'PMCC', 'Undecided']);
    expect(screen.getByRole('combobox')).toHaveValue('undecided');
  });

  it('a credit spread shows Income / Neutral', () => {
    render(<IntentSelect position={make({ strategy: 'BPS', intent: 'income', legs: [{ direction: 'Short', optionType: 'P' }, { direction: 'Long', optionType: 'P' }] as never })} onIntentChange={() => {}} />);
    expect(optionLabels()).toEqual(['Income', 'Neutral']);
  });

  it('shows nothing for a bought put, a short-dated bought call, or when there is no handler', () => {
    const { container, rerender } = render(<IntentSelect position={make({ legs: [{ direction: 'Long', optionType: 'P' }] as never })} onIntentChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<IntentSelect position={make({ strategy: 'CALL', dte: 60, legs: [{ direction: 'Long', optionType: 'C' }] as never })} onIntentChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<IntentSelect position={make({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('choosing a value saves it for that position key, and does not trigger the row click', async () => {
    const user = userEvent.setup();
    const onIntentChange = vi.fn();
    const rowClick = vi.fn();
    render(<div onClick={rowClick}><IntentSelect position={make({})} onIntentChange={onIntentChange} /></div>);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Intent for AAPL' }), 'wheel');
    expect(onIntentChange).toHaveBeenCalledWith('K1', 'wheel');
    expect(rowClick).not.toHaveBeenCalled();
  });
});
