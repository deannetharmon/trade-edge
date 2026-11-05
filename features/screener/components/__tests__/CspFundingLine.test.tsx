// features/screener/components/__tests__/CspFundingLine.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CspFundingLine } from '../CspFundingLine';
import { buildCspCardFunding, type CspCardFundingInput } from '@/lib/scans/cspCardFunding';
import type { Position } from '@/lib/portfolio-data/types';

const shortPut = (strike: number) =>
  ({ legs: [{ symbol: 'X', optionType: 'P', strikePrice: strike, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 1 }] }) as unknown as Position;

const input = (over: Partial<CspCardFundingInput> = {}): CspCardFundingInput => ({
  strike: 140, contracts: 1, cashBalance: 25197.86, reserve: { kind: 'percent', value: 5 },
  positions: [shortPut(28.5), shortPut(90), shortPut(75), shortPut(28), shortPut(21)], pendingOrders: [],
  optionBuyingPower: 5767.89, manualLimit: null, asOfMs: new Date(2026, 10, 5, 13, 52).getTime(), ...over,
});

describe('CspFundingLine', () => {
  it('shows the live shortfall with the same figures as the order dialog', () => {
    render(<CspFundingLine funding={buildCspCardFunding(input())} />);
    const box = screen.getByTestId('csp-funding');
    expect(box.getAttribute('data-status')).toBe('not_fundable');
    expect(box.textContent).toContain('Not fundable now');
    expect(box.textContent).toContain('Shortfall $14,312.03');
    expect(box.textContent).toContain('$38,250.00');
    expect(box.textContent).toContain('$23,937.97');
    expect(box.textContent).toContain('159.8%');
    expect(box.textContent).toMatch(/as of \d{1,2}:52/);
    expect(screen.getByTestId('csp-funding-advisory').textContent).toContain('Broker buying power $5,767.89');
  });

  it('shows a plain funding line when the order is fundable', () => {
    render(<CspFundingLine funding={buildCspCardFunding(input({ positions: [], strike: 50, optionBuyingPower: 90000 }))} />);
    const box = screen.getByTestId('csp-funding');
    expect(box.getAttribute('data-status')).toBe('funded');
    expect(box.textContent).toContain('Funding:');
    expect(box.textContent).not.toContain('Not fundable now');
    expect(screen.queryByTestId('csp-funding-advisory')).toBeNull();
  });

  it('says it cannot verify funding, with the reason, when a source is missing', () => {
    render(<CspFundingLine funding={buildCspCardFunding(input({ pendingOrders: null }))} />);
    const box = screen.getByTestId('csp-funding');
    expect(box.getAttribute('data-status')).toBe('cannot_verify');
    expect(box.textContent).toContain('Cannot verify funding');
    expect(box.textContent).toContain('Working orders unavailable');
  });

  it('names the scan capital limit when it replaced usable cash', () => {
    render(<CspFundingLine funding={buildCspCardFunding(input({ positions: [], strike: 50, manualLimit: 4000 }))} />);
    expect(screen.getByTestId('csp-funding').textContent).toContain('(scan capital limit)');
  });
});
