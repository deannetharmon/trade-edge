// components/__tests__/BalanceChartGap.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/tastytradeToken', () => ({ getAccessToken: vi.fn() }));
vi.mock('@/lib/tastytrade/accountSelection', () => ({ requireActiveBrokerAccount: vi.fn() }));

import { BalanceChart } from '../BalancesTab';

const pt = (date: string, v: number) => ({ date, netLiquidatingValue: v });

// RECON-0003: the live account had stored days up to 10-06, then nothing until today. The chart drew one equal-width step.
describe('RECON-0003 balance chart gap', () => {
  const history = [pt('2026-09-30', 41000), pt('2026-10-01', 41100), pt('2026-10-05', 40700), pt('2026-10-06', 40686), pt('2026-11-13', 35378)];

  it('marks the stretch with no stored days and says so', () => {
    render(<BalanceChart history={history} movements={[]} range="ALL" mode="NET_LIQ" />);
    expect(screen.getAllByTestId('balance-gap')).toHaveLength(1);
    expect(screen.getByTestId('balance-gap-note')).toHaveTextContent('2026-10-06 → 2026-11-13 (38 days)');
  });

  it('spaces points by calendar days: the 38-day stretch is far wider than a one-day step', () => {
    const { container } = render(<BalanceChart history={history} movements={[]} range="ALL" mode="NET_LIQ" />);
    const dots = Array.from(container.querySelectorAll('svg circle')).map(c => Number(c.getAttribute('cx')));
    expect(dots.length).toBeGreaterThan(0);
    const line = container.querySelector('[data-testid="balance-gap"]')!;
    const gapWidth = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
    const total = 900 - 70 - 24;
    expect(gapWidth).toBeGreaterThan(total * 0.8);
  });

  it('draws no gap marker when every day is stored', () => {
    const dense = [pt('2026-11-09', 36000), pt('2026-11-10', 36100), pt('2026-11-11', 35900), pt('2026-11-12', 35341), pt('2026-11-13', 35378)];
    render(<BalanceChart history={dense} movements={[]} range="ALL" mode="NET_LIQ" />);
    expect(screen.queryByTestId('balance-gap')).toBeNull();
    expect(screen.queryByTestId('balance-gap-note')).toBeNull();
  });
});
