// features/screener/components/__tests__/SpreadsScanModal.test.tsx
//
// SCAN-MODAL-UX-0002B: the one-screen Spreads scan modal keeps every input name, quick select and handler,
// and shows the dots, legend, recap and active ruleset.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpreadsScanModal, type SpreadsScanModalProps } from '../SpreadsScanModal';
import type { ScanModalTheme } from '../ScanModalShell';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

function setup(over: Partial<SpreadsScanModalProps> = {}) {
  const fns = {
    onMode: vi.fn(), onMinWidth: vi.fn(), onMaxWidth: vi.fn(), onPreset: vi.fn(), onDteMin: vi.fn(), onDteMax: vi.fn(),
    onDtePick: vi.fn(), onCreditPick: vi.fn(), onCreditInput: vi.fn(), onPopMin: vi.fn(), onOtmMin: vi.fn(), onIvrMin: vi.fn(),
    onRun: vi.fn(), onClose: vi.fn(),
  };
  const props: SpreadsScanModalProps = {
    th, mode: 'targeted', scanWidth: { min: 5, max: 50 }, widthChoices: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], scannedWidths: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    presets: [{ key: 'strict', label: 'Strict', desc: 'Tightest' }, { key: 'course', label: 'Course', desc: 'Baseline' }],
    preset: 'course', dteMin: 21, dteMax: 45, creditRatioMin: 0, popMin: 70, otmMin: 6, ivrMin: 0,
    activeRankRules: { IVR_MIN: 30, OI_MIN: 500, BID_ASK_MAX: 0.1, CREDIT_RATIO_MIN: 0.33, ROC_MIN_SPREAD: 20, ROC_MIN_IC: 30 },
    filterBlock: <div data-testid="filter-block" />,
    ...fns, ...over,
  };
  render(<SpreadsScanModal {...props} />);
  return fns;
}

describe('SpreadsScanModal Targeted', () => {
  it('keeps every input name the page and its tests rely on', () => {
    setup();
    ['Minimum spread width to scan', 'Maximum spread width to scan', 'Minimum DTE', 'Maximum DTE', 'Custom minimum credit risk percentage',
      'Minimum estimated POP', 'Minimum OTM percentage', 'Minimum IVR percentage'].forEach(n => expect(screen.getByLabelText(n)).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /SCAN SELECTED/ })).toBeInTheDocument();
  });

  it('quick selects call the same handlers with the same values', async () => {
    const f = setup();
    await userEvent.click(screen.getByRole('button', { name: '30–45' }));
    expect(f.onDtePick).toHaveBeenCalledWith(30, 45);
    await userEvent.click(screen.getByRole('button', { name: '33%' }));
    expect(f.onCreditPick).toHaveBeenCalledWith(33);
    await userEvent.click(within(screen.getByRole('group', { name: 'POP quick select' })).getByRole('button', { name: '80%' }));
    expect(f.onPopMin).toHaveBeenCalledWith(80);
    await userEvent.click(within(screen.getByRole('group', { name: 'OTM quick select' })).getByRole('button', { name: '12%' }));
    expect(f.onOtmMin).toHaveBeenCalledWith(12);
    await userEvent.click(within(screen.getByRole('group', { name: 'IVR quick select' })).getByRole('button', { name: '30%' }));
    expect(f.onIvrMin).toHaveBeenCalledWith(30);
    await userEvent.click(within(screen.getByRole('group', { name: 'IVR quick select' })).getByRole('button', { name: 'Any' }));
    expect(f.onIvrMin).toHaveBeenCalledWith(0);
  });

  it('highlights the chip that matches the current value and marks Any as the off state', () => {
    setup({ popMin: 70, creditRatioMin: 0 });
    expect(within(screen.getByRole('group', { name: 'POP quick select' })).getByRole('button', { name: '70%' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Minimum credit risk quick select' })).getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '21–29' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('presets are buttons that report their key', async () => {
    const f = setup();
    expect(screen.getByRole('button', { name: 'Course' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Strict' }));
    expect(f.onPreset).toHaveBeenCalledWith('strict');
  });

  it('shows the dots legend, keeps the IVR guide and the Iron Condor note in the page, and a recap', () => {
    setup({ popMin: 75, ivrMin: 30, creditRatioMin: 25 });
    expect(screen.getByTestId('scan-legend')).toHaveTextContent('Gate');
    expect(screen.getByText(/stocks 30%\+ · ETFs and indexes 15%\+/)).toBeInTheDocument();
    expect(screen.getByText('For Iron Condors, gates on the tighter of put/call side')).toBeInTheDocument();
    expect(screen.getByTestId('spreads-rule-preview')).toHaveTextContent('21–45d · $5–$50 · credit ≥25% · POP ≥75% · OTM ≥6% · IVR ≥30%');
  });

  it('shows the width line with the right dollar signs', () => {
    setup();
    expect(screen.getByText('Scan $5, $10, $15, $20, $25, $30, $35, $40, $45, $50. Narrow the results afterward without another scan.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$$');
  });

  it('Run and Cancel call their handlers', async () => {
    const f = setup();
    await userEvent.click(screen.getByRole('button', { name: /RUN SCREENER/ }));
    expect(f.onRun).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SpreadsScanModal Rank', () => {
  it('shows the widths and the read-only active ruleset, and no Targeted fields', () => {
    setup({ mode: 'rank' });
    const preview = screen.getByTestId('rank-active-rules-preview');
    expect(preview).toHaveTextContent('IVR ≥ 30%');
    expect(preview).toHaveTextContent('OI ≥ 500');
    expect(preview).toHaveTextContent('$0.10');
    expect(preview).toHaveTextContent('33%');
    expect(preview).toHaveTextContent('ROC ≥ 20% (spread) / 30% (IC)');
    expect(screen.queryByLabelText('Minimum DTE')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Course' })).not.toBeInTheDocument();
    expect(screen.getByTestId('spreads-rule-preview')).toHaveTextContent('$5–$50 widths · active ruleset');
  });

  it('a width choice reports the new value', () => {
    const f = setup({ mode: 'rank' });
    const select = screen.getByLabelText('Minimum spread width to scan') as HTMLSelectElement;
    select.value = '10';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.onMinWidth).toHaveBeenCalledWith(10);
  });

  it('the mode selector has Rank and Targeted only', () => {
    setup({ mode: 'rank' });
    const group = screen.getByRole('radiogroup', { name: 'Scan mode' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });
});
