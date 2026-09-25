// features/screener/components/__tests__/PmccScanModal.test.tsx

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PmccScanModal, type PmccScanRequest } from '../PmccScanModal';
import type { ScanModalTheme } from '../ScanModalShell';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

const initial: PmccScanRequest = {
  shortDteMin: 20, shortDteMax: 45, shortDeltaMin: 0.15, shortDeltaMax: 0.4,
  shortOiMin: 100, maxSpreadPct: 10, widthCeiling: 0.5,
};

function renderModal(over: Partial<PmccScanRequest> = {}, onRun = vi.fn()) {
  render(
    <PmccScanModal
      th={th}
      heldCandidates={[{ underlyingSymbol: 'AAPL', dte: 400 }]}
      hiddenSymbols={[]}
      onToggleSymbol={vi.fn()}
      discoveryLoading={false}
      exclusions={[]}
      initial={{ ...initial, ...over }}
      onClose={vi.fn()}
      onRun={onRun}
    />,
  );
  return onRun;
}

const chip = (name: string) => screen.getByRole('button', { name });
const minField = () => screen.getByLabelText('Min Δ') as HTMLInputElement;
const maxField = () => screen.getByLabelText('Max Δ') as HTMLInputElement;

describe('SCAN-ALIGN-0001 F1 PMCC delta chips', () => {
  it('renders the group label and hint, and keeps the existing note unchanged', () => {
    renderModal();
    expect(screen.getByText('Delta range (absolute)')).toBeInTheDocument();
    expect(screen.getByText('Absolute delta of the short call. Lower = further OTM.')).toBeInTheDocument();
    expect(screen.queryByText(/Delta guides rank/)).not.toBeInTheDocument();
    expect(minField()).toBeInTheDocument();
    expect(maxField()).toBeInTheDocument();
  });

  it('a chip sets both Min and Max delta', async () => {
    renderModal();
    await userEvent.click(chip('0.20-0.30'));
    expect(minField().value).toBe('0.2');
    expect(maxField().value).toBe('0.3');
    await userEvent.click(chip('0.25-0.35'));
    expect(minField().value).toBe('0.25');
    expect(maxField().value).toBe('0.35');
  });

  it('highlights only the chip matching the current fields, and follows chip clicks', async () => {
    renderModal({ shortDeltaMin: 0.2, shortDeltaMax: 0.3 });
    expect(chip('0.20-0.30')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('0.15-0.25')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('0.25-0.35')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip('0.15-0.25'));
    expect(chip('0.15-0.25')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('0.20-0.30')).toHaveAttribute('aria-pressed', 'false');
  });

  it('no chip is highlighted for the default 0.15-0.40 range', () => {
    renderModal();
    ['0.15-0.25', '0.20-0.30', '0.25-0.35'].forEach(n => expect(chip(n)).toHaveAttribute('aria-pressed', 'false'));
  });

  it('a chip result runs with both values', async () => {
    const onRun = renderModal();
    await userEvent.click(chip('0.25-0.35'));
    await userEvent.click(screen.getByRole('button', { name: /RUN PMCC SCAN/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ shortDeltaMin: 0.25, shortDeltaMax: 0.35 }));
  });

  it('existing validation is unchanged: Max below Min disables Run', () => {
    renderModal({ shortDeltaMin: 0.3, shortDeltaMax: 0.2 });
    expect(screen.getByRole('button', { name: /RUN PMCC SCAN/ })).toBeDisabled();
  });
});

describe('SCAN-GUIDE-0001 part 3 PMCC width help lines', () => {
  it('shows one muted help line under Max spread % and Width ceiling ($), no tooltip', () => {
    renderModal();
    const spread = screen.getByText('Calls with a wider bid/ask gap than this are removed (minimum allowance $0.05).');
    const ceiling = screen.getByText('Removes calls whose gap exceeds this many dollars per share, even if the percent rule passes.');
    expect(spread).toHaveClass('text-neutral-400');
    expect(ceiling).toHaveClass('text-neutral-400');
    expect(spread).not.toHaveAttribute('title');
    expect(ceiling).not.toHaveAttribute('title');
    // Each help line sits directly after its own field.
    expect(screen.getByLabelText('Max spread %').closest('label')!.nextElementSibling).toBe(spread);
    expect(screen.getByLabelText('Width ceiling ($)').closest('label')!.nextElementSibling).toBe(ceiling);
  });

  it('keeps existing labels, the F1 hint and the width hint', () => {
    renderModal();
    expect(screen.getByLabelText('Max spread %')).toBeInTheDocument();
    expect(screen.getByLabelText('Width ceiling ($)')).toBeInTheDocument();
    expect(screen.getByText('Absolute delta of the short call. Lower = further OTM.')).toBeInTheDocument();
    expect(screen.getByTestId('pmcc-width-hint')).toBeInTheDocument();
  });
});
