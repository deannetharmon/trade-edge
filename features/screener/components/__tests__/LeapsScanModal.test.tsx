// features/screener/components/__tests__/LeapsScanModal.test.tsx
//
// SCAN-MODAL-UX-0002A: the compact LEAPS modal keeps every input name and the run request, and tells the
// search range apart from the settings that can change after the scan.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeapsScanModal, type LeapsScanRequest } from '../LeapsScanModal';
import type { ScanModalTheme } from '../ScanModalShell';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};
const initial: LeapsScanRequest = { deltaMin: 0.7, deltaMax: 0.85, dteMin: 365, dteMax: 545, oiMin: 100, extrinsicPctMax: 20 };

function renderModal(over: Partial<LeapsScanRequest> = {}, onRun = vi.fn()) {
  render(<LeapsScanModal th={th} selectedTickerCount={1} initial={{ ...initial, ...over }} onClose={vi.fn()} onRun={onRun} />);
  return onRun;
}

describe('LeapsScanModal compact layout', () => {
  it('keeps every input name', () => {
    renderModal();
    ['Min Δ', 'Max Δ', 'Min DTE', 'Max DTE', 'OI min', 'Max extrinsic %'].forEach(n => expect(screen.getByLabelText(n)).toBeInTheDocument());
  });

  it('keeps the explanation of what a rescan changes, in the page', () => {
    renderModal();
    expect(screen.getByText('DTE bounds the broker fetch. Δ, OI, and extrinsic set result filters and can change later without a rescan.')).toBeInTheDocument();
    expect(screen.getByTestId('scan-legend')).toHaveTextContent('Search range needs a new scan. Adjust-after-scan settings can change later without one.');
  });

  it('marks DTE as a search range and delta, OI and extrinsic as adjust-after-scan', () => {
    renderModal();
    expect(screen.getByText('SEARCH RANGE · RESCAN')).toBeInTheDocument();
    expect(screen.getAllByText('RESULT FILTER').length).toBeGreaterThanOrEqual(3);
  });

  it('a DTE chip sets both ends and is highlighted for the matching range', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: '180–730' }));
    expect(screen.getByLabelText('Min DTE')).toHaveValue('180');
    expect(screen.getByLabelText('Max DTE')).toHaveValue('730');
    expect(screen.getByRole('button', { name: '180–730' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '90–365' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the recap follows the fields', () => {
    renderModal();
    expect(screen.getByTestId('leaps-rule-preview')).toHaveTextContent('365–545d · Δ .70–.85 · OI ≥100 · extrinsic ≤20%');
  });

  it('runs with the draft, and a bad range disables Run', async () => {
    const onRun = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /RUN LEAPS SCAN/ }));
    expect(onRun).toHaveBeenCalledWith(initial);
  });

  it('Max below Min delta disables Run', () => {
    renderModal({ deltaMin: 0.9, deltaMax: 0.8 });
    expect(screen.getByRole('button', { name: /RUN LEAPS SCAN/ })).toBeDisabled();
  });
});
