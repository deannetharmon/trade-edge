// features/screener/components/__tests__/CcBlockedCalls.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CcBlockedCalls } from '../CcBlockedCalls';

const call = { expiration: '2026-11-23', dte: 14, strike: 63, bid: 0.5, ask: 1.5, openInterest: 0, reason: 'no-market' as const };

describe('CcBlockedCalls', () => {
  it('shows a collapsed list with each call\'s reason and no buttons', () => {
    render(<CcBlockedCalls symbol="TQQQ" calls={[call]} total={1} />);
    const d = screen.getByTestId('cc-blocked-TQQQ');
    expect(d).toHaveTextContent('1 call blocked by the safety checks (not orderable)');
    expect(d).toHaveTextContent('$63 · 2026-11-23 · 14 DTE — no open interest');
    expect(d.querySelectorAll('button').length).toBe(0);
    expect((d as HTMLDetailsElement).open).toBe(false);
  });
  it('renders nothing for an empty list and says when it is truncated', () => {
    const { container } = render(<CcBlockedCalls symbol="TQQQ" calls={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
    render(<CcBlockedCalls symbol="SOXL" calls={[call]} total={60} />);
    expect(screen.getByTestId('cc-blocked-SOXL')).toHaveTextContent('Showing the first 40.');
  });
});
