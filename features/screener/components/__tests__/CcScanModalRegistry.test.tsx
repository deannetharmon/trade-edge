// SCREENER-CONFIG-0001B -- the covered-call configuration modal, rendered from the criterion registry:
// lifecycle tags, quick-select pills, live scan summary, inline validation, holdings selection, and
// dialog behavior. The controls keep the accessible names and validation this modal always had.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcScanModal, type CcEligibleHoldingSummary } from '../CcScanModal';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CC_RULES } from '@/lib/scans/constants';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', text: 'text-white',
  textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

const HOLDINGS: CcEligibleHoldingSummary[] = [
  { symbol: 'AAA', availableCoveredContracts: 4 },
  { symbol: 'BBB', availableCoveredContracts: 2 },
  { symbol: 'CCC', availableCoveredContracts: 0 },
];

interface Over { holdings?: CcEligibleHoldingSummary[]; hidden?: string[]; loading?: boolean; onRun?: (r: unknown) => void; onClose?: () => void; onToggle?: (s: string) => void }
const open = (o: Over = {}) => render(
  <CcScanModal
    th={th} selectedTickerCount={2} holdings={o.holdings ?? HOLDINGS} hiddenSymbols={o.hidden ?? []} onToggleSymbol={o.onToggle ?? vi.fn()}
    holdingsLoading={o.loading ?? false} initial={{ rules: { ...DEFAULT_CC_RULES } }} onClose={o.onClose ?? vi.fn()} onRun={(o.onRun as any) ?? vi.fn()}
  />,
);

const criterion = (id: string) => document.querySelector(`[data-cc-criterion="${id}"]`) as HTMLElement;
const pill = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });

describe('lifecycle tags say what the engine does', () => {
  // CC-SIMPLIFY-0001 Phase 2: DTE is the only scan setting. Delta range and max width moved to chips on the results screen.
  it('DTE is the only search setting; delta and width are said to live on the results screen', () => {
    open();
    expect(within(criterion('dte')).getByText('SEARCH RANGE · RESCAN')).toBeInTheDocument();
    for (const id of ['delta', 'width', 'widthCeiling', 'oi']) expect(criterion(id)).toBeFalsy();
    expect(screen.getByTestId('cc-view-note')).toHaveTextContent(/chips on the results screen/);
    expect(screen.getByTestId('cc-view-note')).toHaveTextContent(/without a rescan/);
  });

  it('minimum strike, quote validity, and earnings are fixed; capacity is read-only', () => {
    open();
    for (const id of ['minStrike', 'quoteValidity', 'earnings']) expect(within(criterion(id)).getByText('SEARCH RANGE · FIXED')).toBeInTheDocument();
    expect(within(criterion('capacity')).getByText('READ ONLY')).toBeInTheDocument();
  });

  it('states the earnings rule the right way round, and the cost-basis caveat', () => {
    open();
    expect(criterion('earnings')).toHaveTextContent(/only calls expiring at least 10 days before earnings qualify/);
    expect(criterion('earnings')).not.toHaveTextContent(/Later expirations still qualify/);
    expect(criterion('minStrike')).toHaveTextContent(/at or above your cost basis when it is known/);
  });
});

describe('controls keep their accessible names and behavior', () => {
  it('shows only the DTE inputs; delta, width and OI are not scan settings any more', () => {
    open();
    for (const name of ['Min DTE', 'Max DTE']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    for (const name of ['Min Δ', 'Max Δ', 'OI pref.', 'Max width', 'Width ceiling']) expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
  });

  it('Run is enabled by default and hands back every rule, unchanged', async () => {
    const onRun = vi.fn();
    open({ onRun });
    await userEvent.click(screen.getByRole('button', { name: 'RUN CC SCAN →' }));
    expect(onRun).toHaveBeenCalledWith({ rules: { ...DEFAULT_CC_RULES } });
  });
});

describe('quick-select pills follow the shared pill and input contract', () => {
  it('a DTE pill sets both ends, and typing values that match a pill presses it', async () => {
    open();
    expect(pill('DTE range quick select', '21–45')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(pill('DTE range quick select', '7–45'));
    expect(screen.getByLabelText('Min DTE')).toHaveValue('7');
    expect(screen.getByLabelText('Max DTE')).toHaveValue('45');
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '21');
    expect(pill('DTE range quick select', '21–45')).toHaveAttribute('aria-pressed', 'true');
    expect(pill('DTE range quick select', '7–45')).toHaveAttribute('aria-pressed', 'false');
  });

  it('a DTE change reaches the request and the default delta and width ride along unchanged', async () => {
    const onRun = vi.fn();
    open({ onRun });
    await userEvent.click(pill('DTE range quick select', '7–14'));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CC SCAN →' }));
    expect(onRun.mock.calls[0][0].rules).toMatchObject({ DTE_MIN: 7, DTE_MAX: 14, DELTA_MIN: 0.2, DELTA_MAX: 0.35, WIDTH_PCT_MAX: 10, WIDTH_CEILING: 0.5, OI_MIN: 100 });
  });

  it('DTE is the only quick select', () => {
    open();
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label')).filter(l => l?.endsWith('quick select')))
      .toEqual(['DTE range quick select']);
  });
});

describe('the Always applied strip names every fixed rule and keeps its full text in a tooltip', () => {
  it('lists the four fixed rules by name, each with its tooltip and no input', () => {
    open();
    const strip = screen.getByRole('region', { name: 'Always applied' });
    for (const name of ['Strike ≥ price and cost basis', 'Two-sided quote', 'Earnings buffer · 10 days', 'Shares only']) expect(within(strip).getByText(name)).toBeInTheDocument();
    expect(within(strip).getAllByRole('tooltip')).toHaveLength(4);
    expect(within(strip).queryAllByRole('textbox')).toHaveLength(0);
    expect(criterion('capacity')).toHaveTextContent(/A position with none is skipped/);
  });

  it('a tooltip opens on click and closes when focus leaves', async () => {
    open();
    const tipButton = within(criterion('earnings')).getByRole('button', { name: 'More information' });
    expect(tipButton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(tipButton);
    expect(tipButton).toHaveAttribute('aria-expanded', 'true');
    expect(tipButton).toHaveAttribute('aria-describedby', within(criterion('earnings')).getByRole('tooltip').id);
    await userEvent.tab();
    expect(tipButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('the legend lists the kinds of control shown, and the after-scan note carries the result-filter text', () => {
    open();
    const legend = screen.getByTestId('scan-legend');
    for (const label of ['Search range', 'Advisory', 'Adjust after scan']) expect(legend).toHaveTextContent(label);
    expect(legend).not.toHaveTextContent('Preference');
    expect(within(criterion('resultChips')).getByText('RESULT FILTER')).toBeInTheDocument();
    expect(criterion('resultChips')).toHaveTextContent(/No rescan/);
  });
});

describe('the recap is built from the registry and updates as you edit', () => {
  it('shows the settings that can change and the capacity from the selected holdings, not the fixed rules', async () => {
    open();
    const summary = screen.getByTestId('cc-rule-preview');
    expect(summary).toHaveTextContent('21–45 DTE');
    expect(summary).not.toHaveTextContent('Δ');
    expect(summary).not.toHaveTextContent('width');
    expect(summary).not.toHaveTextContent('strike ≥ stock price');
    expect(summary).not.toHaveTextContent('OI 100');
    // Two positions with capacity (AAA 4 + BBB 2 = 6); the fully covered one is not counted.
    expect(summary).toHaveTextContent('2 positions selected · up to 6 contracts');
    await userEvent.click(pill('DTE range quick select', '7–14'));
    expect(summary).toHaveTextContent('7–14 DTE');
  });

  it('leaves a hidden position out of the capacity line', () => {
    open({ hidden: ['BBB'] });
    expect(screen.getByTestId('cc-rule-preview')).toHaveTextContent('1 position selected · up to 4 contracts');
  });

  it('shows no capacity line while holdings are loading', () => {
    open({ loading: true });
    expect(screen.getByTestId('cc-rule-preview')).not.toHaveTextContent(/positions? selected/);
  });
});

describe('invalid ranges are announced and block Run', () => {
  it('shows the message beside the field in a polite live region and disables Run, then clears it', async () => {
    open();
    await userEvent.clear(screen.getByLabelText('Max DTE'));
    await userEvent.type(screen.getByLabelText('Max DTE'), '10');
    const message = screen.getByText('Max DTE must be above min DTE.');
    expect(message).toHaveAttribute('role', 'status');
    expect(message).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Max DTE'));
    await userEvent.type(screen.getByLabelText('Max DTE'), '45');
    expect(screen.queryByText('Max DTE must be above min DTE.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeEnabled();
  });

});

describe('holdings and Run', () => {
  it('Run stays disabled while holdings load, with no positions, and with every position left out', async () => {
    const { unmount } = open({ loading: true });
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeDisabled();
    unmount();
    const empty = open({ holdings: [] });
    expect(screen.getByText(/No eligible covered-call holdings found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeDisabled();
    empty.unmount();
    open({ hidden: ['AAA', 'BBB'] });
    expect(screen.getByRole('alert')).toHaveTextContent(/Select at least one eligible holding/);
    expect(screen.getByRole('button', { name: 'RUN CC SCAN →' })).toBeDisabled();
  });

  it('a position can be toggled, a fully covered one cannot', async () => {
    const onToggle = vi.fn();
    open({ onToggle });
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    expect(onToggle).toHaveBeenCalledWith('AAA');
    expect(screen.getByRole('button', { name: /CCC/ })).toBeDisabled();
  });
});

describe('drafts and dialog behavior', () => {
  it('Cancel discards edits: it only closes, and a reopened modal starts from the values it was given', async () => {
    const onClose = vi.fn();
    const onRun = vi.fn();
    const { unmount } = open({ onClose, onRun });
    await userEvent.click(pill('DTE range quick select', '7–45'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
    unmount();
    open();
    expect(screen.getByLabelText('Min DTE')).toHaveValue('21');
  });

  it('is a labelled modal dialog, and keeps Tab focus inside it', async () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'COVERED CALL SCAN' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'));
    const last = focusable[focusable.length - 1];
    last.focus();
    await userEvent.tab();
    expect(focusable[0]).toHaveFocus();
  });

  it('every input has an accessible name and every quick-select group is labelled', () => {
    open();
    const dialog = screen.getByRole('dialog');
    for (const input of Array.from(dialog.querySelectorAll('input[type="text"]'))) expect((input as HTMLElement).getAttribute('aria-label')).toBeTruthy();
    for (const group of Array.from(dialog.querySelectorAll('[role="group"]'))) expect(group.getAttribute('aria-label')).toBeTruthy();
  });
});
