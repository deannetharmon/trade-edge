// features/portfolio/positions-workspace/__tests__/CloseResultBar.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CloseResultBar } from '../CloseResultBar';

const props = { borderClass: 'border-white/10', faintClass: 'text-neutral-400' };

describe('CloseResultBar', () => {
  it('shows a loss as a negative number with what comes back against what was paid', () => {
    render(<CloseResultBar testId="bar" caption="Close now" paid={2130} back={1025} {...props} />);
    expect(screen.getByTestId('bar')).toHaveTextContent('-$1,105');
    expect(screen.getByTestId('bar')).toHaveTextContent('$1,025 back');
    expect(screen.getByTestId('bar')).toHaveTextContent('$2,130 paid');
    expect(screen.getByTestId('bar')).toHaveTextContent('-52%');
  });
  it('shows a gain as a positive number', () => {
    render(<CloseResultBar testId="bar" caption="Close now" paid={1000} back={1400} {...props} />);
    expect(screen.getByTestId('bar')).toHaveTextContent('$400');
    expect(screen.getByTestId('bar')).not.toHaveTextContent('-$');
  });
});
