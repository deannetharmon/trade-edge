// features/screener/components/__tests__/RsiEntryTiming.test.tsx

// RSI-ENTRY-0001 slice A2a: the Entry timing (RSI) control in the CSP and CC scan modals, the chip on a result row.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CspScanModal } from '../CspScanModal';
import { CcScanModal } from '../CcScanModal';
import { RsiEntryChip } from '../RsiEntryChip';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CC_RULES, DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', text: 'text-white',
  textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};
const cspInitial = { mode: 'rank' as const, preset: 'balanced', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none' as const };
const holdings = [{ symbol: 'AAA', availableCoveredContracts: 4 }];

const openCsp = (onRun = vi.fn(), initial: typeof cspInitial & { rsiEntry?: unknown } = cspInitial) =>
  render(<CspScanModal th={th} selectedTickerCount={2} initial={initial as never} onClose={vi.fn()} onRun={onRun} />);
const openCc = (onRun = vi.fn(), initial: { rules: typeof DEFAULT_CC_RULES; rsiEntry?: unknown } = { rules: { ...DEFAULT_CC_RULES } }) =>
  render(
    <CcScanModal th={th} selectedTickerCount={1} holdings={holdings} hiddenSymbols={[]} onToggleSymbol={vi.fn()} holdingsLoading={false}
      initial={initial as never} onClose={vi.fn()} onRun={onRun} />,
  );
const pills = (group: string) => within(screen.getByRole('group', { name: group }));

describe('CSP modal', () => {
  it('shows the control in its own card, tagged PREFERENCE, defaulting to Off', () => {
    openCsp();
    const card = document.querySelector('[data-csp-card="timing"]') as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(within(card).getByText('PREFERENCE')).toBeInTheDocument();
    expect(pills('CSP entry timing').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(pills('CSP entry timing').getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('RSI dip level')).toHaveValue('40');
  });
  it('the scan summary states Off, then On with the dip level, from the same registry line', async () => {
    openCsp();
    const summary = screen.getByTestId('csp-rule-preview');
    expect(summary).toHaveTextContent('RSI timing: Off');
    await userEvent.click(pills('CSP entry timing').getByRole('button', { name: 'On' }));
    expect(summary).toHaveTextContent('RSI timing: On · dip at or below 40');
  });
  it('Run returns the setting: Off by default, On when chosen, with an edited level', async () => {
    const onRun = vi.fn();
    openCsp(onRun);
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun.mock.calls[0][0].rsiEntry).toEqual({ on: false, level: 40, window: 8, lift: 3, mid: 50 });
    await userEvent.click(pills('CSP entry timing').getByRole('button', { name: 'On' }));
    fireEvent.change(screen.getByLabelText('RSI dip level'), { target: { value: '30' } });
    fireEvent.blur(screen.getByLabelText('RSI dip level'));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun.mock.calls[1][0].rsiEntry).toMatchObject({ on: true, level: 30 });
  });
  it('an invalid level blocks Run and says why', async () => {
    openCsp();
    fireEvent.change(screen.getByLabelText('RSI dip level'), { target: { value: '55' } });
    fireEvent.blur(screen.getByLabelText('RSI dip level'));
    expect(screen.getByText('Dip level must be below the ceiling.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
  });
  it('reopens with the last-used setting', () => {
    openCsp(vi.fn(), { ...cspInitial, rsiEntry: { on: true, level: 35, window: 8, lift: 3, mid: 50 } });
    expect(pills('CSP entry timing').getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('RSI dip level')).toHaveValue('35');
  });
  it('the turn rule sits under Advanced', () => {
    openCsp();
    expect(screen.getByText('Turn rule (advanced)')).toBeInTheDocument();
    expect(screen.getByLabelText('RSI window')).toHaveValue('8');
    expect(screen.getByLabelText('RSI lift')).toHaveValue('3');
    expect(screen.getByLabelText('RSI ceiling')).toHaveValue('50');
  });
});

describe('CC modal', () => {
  it('shows the control, defaulting to Off with a peak level of 60 and a floor', () => {
    openCc();
    expect(pills('CC entry timing').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('RSI peak level')).toHaveValue('60');
    expect(screen.getByLabelText('RSI floor')).toHaveValue('50');
    expect(screen.getByLabelText('RSI drop')).toHaveValue('3');
  });
  it('Run returns the rules and the RSI setting; turning it On shows in the summary', async () => {
    const onRun = vi.fn();
    openCc(onRun);
    await userEvent.click(pills('CC entry timing').getByRole('button', { name: 'On' }));
    expect(screen.getByTestId('cc-rule-preview')).toHaveTextContent('RSI timing: On · peak at or above 60');
    await userEvent.click(screen.getByRole('button', { name: 'RUN CC SCAN →' }));
    expect(onRun.mock.calls[0][0].rsiEntry).toEqual({ on: true, level: 60, window: 8, lift: 3, mid: 50 });
    expect(onRun.mock.calls[0][0].rules).toEqual(DEFAULT_CC_RULES);
  });
  it('editing a rule keeps the RSI setting (the draft is merged, not replaced)', async () => {
    const onRun = vi.fn();
    openCc(onRun, { rules: { ...DEFAULT_CC_RULES }, rsiEntry: { on: true, level: 65, window: 8, lift: 3, mid: 50 } });
    fireEvent.change(screen.getByLabelText('Min DTE'), { target: { value: '20' } });
    fireEvent.blur(screen.getByLabelText('Min DTE'));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CC SCAN →' }));
    expect(onRun.mock.calls[0][0].rsiEntry).toMatchObject({ on: true, level: 65 });
    expect(onRun.mock.calls[0][0].rules.DTE_MIN).toBe(20);
  });
  it('a peak level at or below the floor blocks Run', () => {
    openCc();
    fireEvent.change(screen.getByLabelText('RSI peak level'), { target: { value: '45' } });
    fireEvent.blur(screen.getByLabelText('RSI peak level'));
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeDisabled();
  });
});

describe('RsiEntryChip', () => {
  const entry = (verdict: 'PASS' | 'WAIT' | 'UNAVAILABLE', label: string) =>
    ({ verdict, reason: verdict === 'PASS' ? 'TURNED_UP' : verdict === 'WAIT' ? 'NO_DIP' : 'UNAVAILABLE', label, latest: null, extreme: null, extremeBarsAgo: null }) as const;
  it('shows the label text for each verdict and marks the verdict', () => {
    const { rerender } = render(<RsiEntryChip entry={entry('PASS', 'RSI 36 · turned up from 28, 2 bars ago')} />);
    expect(screen.getByTestId('rsi-entry-chip')).toHaveTextContent('RSI 36 · turned up from 28, 2 bars ago');
    expect(screen.getByTestId('rsi-entry-chip')).toHaveAttribute('data-verdict', 'PASS');
    rerender(<RsiEntryChip entry={entry('WAIT', 'Wait · no dip (RSI 58)')} />);
    expect(screen.getByTestId('rsi-entry-chip')).toHaveTextContent('Wait · no dip (RSI 58)');
    rerender(<RsiEntryChip entry={entry('UNAVAILABLE', 'RSI n/a')} />);
    expect(screen.getByTestId('rsi-entry-chip')).toHaveTextContent('RSI n/a');
  });
  it('Wait is neutral, never red or amber (it is not a failed rule)', () => {
    render(<RsiEntryChip entry={entry('WAIT', 'Wait · no dip (RSI 58)')} />);
    const cls = screen.getByTestId('rsi-entry-chip').className;
    expect(cls).not.toMatch(/red|amber/);
  });
});
