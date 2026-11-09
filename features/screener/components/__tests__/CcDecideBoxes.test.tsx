// features/screener/components/__tests__/CcDecideBoxes.test.tsx

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CcDecideBoxes } from '../CcDecideBoxes';

const input = { symbol: 'TQQQ', spot: 52.25, strike: 57, delta: 0.24, dte: 8, expiration: '2026-11-16', premiumPerContract: 116, contracts: 2, costBasis: 48, ivxPct: 91 };

describe('CcDecideBoxes', () => {
  it('shows the verdict and the catch', () => {
    render(<CcDecideBoxes input={input} />);
    expect(screen.getByTestId('cc-decide-verdict')).toHaveTextContent('Sell 2 $57 calls expiring Nov 16 for $232.');
    expect(screen.getByTestId('cc-decide-catch')).toHaveTextContent('THE CATCH');
    expect(screen.getByTestId('cc-decide-catch')).toHaveTextContent('plus the $232 you collected');
  });
  it('turns the catch red and states the loss when the strike is below your cost', () => {
    render(<CcDecideBoxes input={{ ...input, costBasis: 78.75 }} />);
    expect(screen.getByTestId('cc-decide-catch')).toHaveTextContent('BELOW YOUR COST');
    expect(screen.getByTestId('cc-decide-catch')).toHaveTextContent('$4,350 loss');
  });
  it('renders nothing when the numbers are not there', () => {
    const { container } = render(<CcDecideBoxes input={{ ...input, premiumPerContract: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
