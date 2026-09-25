// components/__tests__/RsiStrip.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RsiStrip } from '../RsiStrip';
import { THEMES } from '@/lib/theme';

const BASE = [...Array.from({ length: 11 }, () => [100, 101]).flat(), 100];
const TURNED_UP = [...BASE, 99, 98, 97, 96, 95, 94, 93, 94, 95.5]; // 32 closes: the first TURNING_UP bar

describe('RsiStrip', () => {
  it('shows the state label, a plain caption and the timing-hint note for a turn up', () => {
    render(<RsiStrip closes={TURNED_UP} th={THEMES.dark} />);
    expect(screen.getByTestId('rsi-strip')).toHaveAttribute('data-state', 'TURNING_UP');
    expect(screen.getByText('Turning up')).toBeInTheDocument();
    expect(screen.getByTestId('rsi-caption')).toHaveTextContent('RSI 41 · turned up from 29, 2 bars ago');
    expect(screen.getByText(/not a signal/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /RSI for the last \d+ daily bars with lines at 30 and 70/ })).toBeInTheDocument();
  });

  it('says RSI n/a instead of guessing when there is no usable data', () => {
    const { rerender } = render(<RsiStrip closes={null} th={THEMES.dark} />);
    expect(screen.getByTestId('rsi-strip-unavailable')).toHaveTextContent('RSI n/a');
    rerender(<RsiStrip closes={[100, 101, 102]} th={THEMES.dark} />);
    expect(screen.getByTestId('rsi-strip-unavailable')).toBeInTheDocument();
    rerender(<RsiStrip closes={[...TURNED_UP.slice(0, 20), NaN, ...TURNED_UP.slice(21)]} th={THEMES.dark} />);
    expect(screen.getByTestId('rsi-strip-unavailable')).toBeInTheDocument();
  });
});
