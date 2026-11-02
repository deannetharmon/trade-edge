// features/screener/components/__tests__/CspScanModal.test.tsx
//
// SCAN-SIMPLIFY-0001 -- the CSP scan modal asks for the DTE range only.

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { CspScanModal, LS_CSP_DTE } from '../CspScanModal';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const initial = { mode: 'rank' as const, preset: 'view', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none' as const };
const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};
const open = (onRun = vi.fn()) => { render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={onRun} />); return onRun; };

describe('SCAN-SIMPLIFY-0001 CSP scan modal', () => {
  beforeEach(() => { try { localStorage.clear(); } catch {} });

  it('defaults to 7-60 DTE and runs a wide-open fetch with no mode choice', async () => {
    const onRun = open();
    expect(screen.queryByRole('radio', { name: /Rank|Targeted/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/CONFIRM TARGETS/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Minimum DTE')).toHaveValue('7');
    expect(screen.getByLabelText('Maximum DTE')).toHaveValue('60');
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0]).toMatchObject({
      mode: 'rank', preset: 'view', popMin: null, otmMin: null, rocMin: null, affordableOnly: false,
      rules: expect.objectContaining({ DTE_MIN: 7, DTE_MAX: 60, IVR_MAX: 100 }),
    });
  });

  it('quick chips set the range and the last-used range is remembered', async () => {
    const onRun = open();
    await userEvent.click(screen.getByRole('button', { name: '30–45 DTE' }));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun.mock.calls[0][0].rules).toMatchObject({ DTE_MIN: 30, DTE_MAX: 45 });
    expect(JSON.parse(localStorage.getItem(LS_CSP_DTE)!)).toEqual([30, 45]);
  });

  it('a reopened modal starts from the remembered range', async () => {
    localStorage.setItem(LS_CSP_DTE, JSON.stringify([15, 29]));
    open();
    expect(await screen.findByDisplayValue('15')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum DTE')).toHaveValue('29');
  });

  it('an inverted range is announced and blocks Run', async () => {
    const onRun = open();
    const max = screen.getByLabelText('Maximum DTE');
    await userEvent.clear(max);
    await userEvent.type(max, '3');
    expect(screen.getByRole('alert')).toHaveTextContent(/minimum is not above the maximum/i);
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('states the fixed gates and sends delta/OI/IVR/affordability to the results screen', () => {
    open();
    expect(screen.getByText('Bid/ask tiers')).toBeInTheDocument();
    expect(screen.getByText('No IV rank = disqualified')).toBeInTheDocument();
    expect(screen.getByText(/are on the results screen/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/delta|open interest|IVR/i)).not.toBeInTheDocument();
  });
});
