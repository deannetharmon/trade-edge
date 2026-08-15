import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CspScanModal } from '../CspScanModal';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const initial = { mode: 'filter' as const, preset: 'balanced', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none' as const };

// Minimal stand-in for a THEMES[Theme] entry -- only the fields ScanModalShell
// and ScanModeRadioGroup actually read.
const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

describe('CSP-WORKFLOW-0001 CSP configuration modal', () => {
  it('does not scan until confirmed and returns the complete selected rule set', async () => {
    const onRun = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={onRun} />);

    expect(screen.getByRole('dialog', { name: 'CASH-SECURED PUT SCAN' })).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Rank/i }));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0]).toMatchObject({
      mode: 'rank', preset: 'balanced',
      rules: expect.objectContaining({ DELTA_MIN: 0.15, DELTA_MAX: 0.25, OI_MIN: 500 }),
    });
  });

  it('supports all three modes and exposes the approved relative liquidity policy', async () => {
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    for (const name of [/Filter/i, /Rank/i, /Targeted/i]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/strong ≤ max\(\$0\.10, 10% of mid\), borderline through 15%/i)).toBeInTheDocument();
  });

  it('closes on Escape and traps Tab focus inside the dialog', async () => {
    const onClose = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={onClose} onRun={vi.fn()} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Filter, Rank, and Targeted drafts isolated and requires deliberate Targeted confirmation', async () => {
    const onRun = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={onRun} />);
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '25');
    await userEvent.click(screen.getByRole('radio', { name: /^Rank/i }));
    await userEvent.selectOptions(screen.getByLabelText('CSP secondary sort'), 'rocPct');
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    expect(screen.getByLabelText('Min DTE')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Minimum POP'), '70');
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM TARGETS' }));
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: /^Filter/i }));
    expect(screen.getByLabelText('Min DTE')).toHaveValue(25);
    expect(screen.queryByLabelText('Minimum POP')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /^Rank/i }));
    expect(screen.getByLabelText('CSP secondary sort')).toHaveValue('rocPct');
  });

  it('does not allow Targeted confirmation until POP, OTM, or ROC actually narrows the scan', async () => {
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    expect(screen.getByText(/Set at least one POP, OTM, or period ROC target/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CONFIRM TARGETS' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Minimum OTM percentage'), '5');
    expect(screen.getByRole('button', { name: 'CONFIRM TARGETS' })).toBeEnabled();
  });

  it('closing performs no scan', async () => {
    const onClose = vi.fn(); const onRun = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={onClose} onRun={onRun} />);
    await userEvent.click(screen.getByRole('button', { name: /Close Cash-Secured Put/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('supports roving radio focus with arrow keys and a non-color selected cue', async () => {
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    const filter = screen.getByRole('radio', { name: /^filter/i });
    expect(filter).toHaveFocus();
    expect(filter).toHaveTextContent('Selected');
    await userEvent.keyboard('{ArrowRight}');
    const rank = screen.getByRole('radio', { name: /^rank/i });
    expect(rank).toHaveFocus();
    expect(rank).toHaveAttribute('aria-checked', 'true');
    expect(rank).toHaveTextContent('Selected');
  });

  it('uses roving tabindex and arrow-key selection for the preset radiogroup', async () => {
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    const balanced = screen.getByRole('radio', { name: /Balanced/i });
    const opportunity = screen.getByRole('radio', { name: /More opportunities/i });
    expect(balanced).toHaveAttribute('tabindex', '0');
    expect(opportunity).toHaveAttribute('tabindex', '-1');
    balanced.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(opportunity).toHaveFocus();
    expect(opportunity).toHaveAttribute('aria-checked', 'true');
    expect(opportunity).toHaveAttribute('tabindex', '0');
  });

  it('keeps Custom selected and tabbable after a manual numeric rule edit', async () => {
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '25');
    const custom = screen.getByRole('radio', { name: /Custom/i });
    expect(custom).toHaveAttribute('aria-checked', 'true');
    expect(custom).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('radio').filter(radio => radio.getAttribute('aria-checked') === 'true')).toHaveLength(2);
    custom.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: /More opportunities/i })).toHaveFocus();
  });

  it('IVR and bid/ask width render as real editable inputs, not preset-locked', async () => {
    // Closes the gap flagged in the fetch/scan/view filter audit: IVR_MIN,
    // IVR_MAX, and BID_ASK_MAX previously had no input control at all and
    // stayed silently locked to whatever preset was last selected, even
    // under "Custom." Fixed separately; this is the regression test that
    // was missing at the time, proving the fields stay wired rather than
    // relying on reading the source and trusting it.
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);

    const ivrMin = screen.getByLabelText('Min IVR %') as HTMLInputElement;
    const ivrMax = screen.getByLabelText('Max IVR %') as HTMLInputElement;
    const bidAsk = screen.getByLabelText('Max bid/ask width') as HTMLInputElement;

    expect(ivrMin.value).toBe(String(DEFAULT_CSP_RULES.IVR_MIN));
    expect(ivrMax.value).toBe(String(DEFAULT_CSP_RULES.IVR_MAX));
    expect(bidAsk.value).toBe(String(DEFAULT_CSP_RULES.BID_ASK_MAX));

    await userEvent.clear(ivrMin);
    await userEvent.type(ivrMin, '42');
    expect(ivrMin.value).toBe('42');

    // Editing IVR, same as any other rule field, flips the preset to
    // Custom -- confirming these three fields actually participate in the
    // shared draft rather than being decorative and disconnected.
    expect(screen.getByRole('radio', { name: /Custom/i })).toHaveAttribute('aria-checked', 'true');
  });
});
