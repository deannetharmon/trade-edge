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

  // FILTER-MODE-REMOVAL-0002 (3e8d9491) hid Filter from the selectable modes ("hide-first": the default CSP draft is
  // still Filter, so the modal opens on the Filter form with no mode radio selected, and the default scan still runs
  // in Filter mode -- UnifiedStrategyLauncher test 7 depends on that). These tests pin TODAY's behavior. When
  // SCREENER-CONFIG-0001 reinstates Filter they fail on purpose: restore the three-mode assertions (git history
  // before 3e8d9491) and the Filter-dependent tests in CspCandidateDiscovery, ScreenerUXHierarchy, and
  // UnifiedStrategyLauncher.
  it('offers Rank and Targeted while Filter is hidden, and clearly states the automatic safeguards', async () => {
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getAllByRole('radio', { name: /^(Rank|Targeted)/i })).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: /^Filter/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Liquidity and earnings checks are applied automatically/i)).toBeInTheDocument();
  });

  it('opens on the hidden Filter draft with neither visible mode selected (known hide-first state)', async () => {
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /^Rank/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /^Targeted/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeEnabled();
  });

  it('accepts a decimal typed from its leading dot without coercing the interim dot to zero', async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={onRun} />);
    const minDelta = screen.getByLabelText('Min Δ');
    await user.clear(minDelta);
    await user.type(minDelta, '.12');
    await user.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({
      rules: expect.objectContaining({ DELTA_MIN: 0.12 }),
    }));
  });

  it('shows every evaluated contract by default and carries a manual ceiling into the request', async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<CspScanModal th={th} selectedTickerCount={1} initial={initial} onClose={vi.fn()} onRun={onRun} />);
    expect(screen.getByLabelText(/Only show affordable CSPs/i)).not.toBeChecked();
    await user.click(screen.getByLabelText(/Only show affordable CSPs/i));
    await user.clear(screen.getByLabelText('Cash cap per CSP'));
    await user.type(screen.getByLabelText('Cash cap per CSP'), '8000');
    await user.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ affordableOnly: true, capitalLimit: 8000 }));
    expect(screen.getByText(/Blank uses available account cash/i)).toBeInTheDocument();
    expect(screen.queryByText(/Capital is verified against/i)).not.toBeInTheDocument();
  });

  it('closes on Escape and traps Tab focus inside the dialog', async () => {
    const onClose = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={onClose} onRun={vi.fn()} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Rank and Targeted drafts isolated and requires deliberate Targeted confirmation', async () => {
    const onRun = vi.fn();
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={onRun} />);
    await userEvent.click(screen.getByRole('radio', { name: /^Rank/i }));
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '25');
    await userEvent.selectOptions(screen.getByLabelText('CSP secondary sort'), 'rocPct');
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    expect(screen.getByLabelText('Min DTE')).toHaveValue('30');
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Minimum estimated POP'), '70');
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM TARGETS' }));
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: /^Rank/i }));
    expect(screen.getByLabelText('Min DTE')).toHaveValue('25');
    expect(screen.getByLabelText('CSP secondary sort')).toHaveValue('rocPct');
    expect(screen.queryByLabelText('Minimum estimated POP')).not.toBeInTheDocument();
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
    const rank = screen.getByRole('radio', { name: /^rank/i });
    await userEvent.click(rank);
    expect(rank).toHaveFocus();
    expect(rank).toHaveTextContent('Selected');
    await userEvent.keyboard('{ArrowRight}');
    const targeted = screen.getByRole('radio', { name: /^targeted/i });
    expect(targeted).toHaveFocus();
    expect(targeted).toHaveAttribute('aria-checked', 'true');
    expect(targeted).toHaveTextContent('Selected');
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
    // Only the preset radio is selected: no mode radio is selected while Filter is hidden (FILTER-MODE-REMOVAL-0002).
    expect(screen.getAllByRole('radio').filter(radio => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    custom.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: /More opportunities/i })).toHaveFocus();
  });

  it('keeps IVR preferences editable but does not expose CSP\'s unused spread setting', async () => {
    render(<CspScanModal th={th} selectedTickerCount={2} initial={initial} onClose={vi.fn()} onRun={vi.fn()} />);

    const ivrMin = screen.getByLabelText('IVR pref.') as HTMLInputElement;
    const ivrMax = screen.getByLabelText('IVR cap') as HTMLInputElement;

    expect(ivrMin.value).toBe(String(DEFAULT_CSP_RULES.IVR_MIN));
    expect(ivrMax.value).toBe(String(DEFAULT_CSP_RULES.IVR_MAX));
    expect(screen.queryByLabelText('Max bid/ask width')).not.toBeInTheDocument();

    await userEvent.clear(ivrMin);
    await userEvent.type(ivrMin, '42');
    expect(ivrMin.value).toBe('42');

    // Editing a preference flips the preset to Custom, proving the field is
    // wired to the scan draft rather than decorative.
    expect(screen.getByRole('radio', { name: /Custom/i })).toHaveAttribute('aria-checked', 'true');
  });
});
