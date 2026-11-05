// features/screener/components/__tests__/CcRsiCutoffControl.test.tsx
// CC-WHEEL-0001 S3 -- the cutoff defaults to 50, persists, rejects invalid values.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcRsiCutoffControl } from '../CcRsiCutoffControl';

beforeEach(() => window.localStorage.clear());

describe('CcRsiCutoffControl', () => {
  it('shows 50 by default', () => {
    render(<CcRsiCutoffControl />);
    expect(screen.getByLabelText('RSI cutoff')).toHaveValue('50');
  });
  it('saves a valid value', async () => {
    render(<CcRsiCutoffControl />);
    const box = screen.getByLabelText('RSI cutoff');
    await userEvent.clear(box);
    await userEvent.type(box, '45');
    expect(window.localStorage.getItem('te-cc-rsi-cutoff')).toBe('45');
  });
  it('an invalid entry falls back to 50 when you leave the box', async () => {
    render(<CcRsiCutoffControl />);
    const box = screen.getByLabelText('RSI cutoff');
    await userEvent.clear(box);
    await userEvent.type(box, '150');
    await userEvent.tab();
    expect(box).toHaveValue('50');
    expect(window.localStorage.getItem('te-cc-rsi-cutoff')).toBe('50');
  });
});
