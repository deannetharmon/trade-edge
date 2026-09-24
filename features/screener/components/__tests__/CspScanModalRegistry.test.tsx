// SCREENER-CONFIG-0001A -- the CSP configuration modal, rendered from the criterion registry:
// lifecycle tags, quick-select pills, live scan summary, inline validation, drafts, and dialog
// behavior. (The pre-existing modal behaviors stay covered in CspScanModal.test.tsx.)

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CspScanModal } from '../CspScanModal';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const initial = { mode: 'rank' as const, preset: 'balanced', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none' as const };

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', text: 'text-white',
  textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

const open = (over: Record<string, unknown> = {}, handlers: { onRun?: () => void; onClose?: () => void } = {}) =>
  render(<CspScanModal th={th} selectedTickerCount={3} initial={{ ...initial, ...over }} onClose={handlers.onClose ?? vi.fn()} onRun={handlers.onRun ?? vi.fn()} />);

const criterion = (id: string) => document.querySelector(`[data-csp-criterion="${id}"]`) as HTMLElement;
const pressed = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });

describe('lifecycle tags say what the engine does', () => {
  it('DTE is the search range and delta is a preference, never a search range', () => {
    open();
    expect(within(criterion('dte')).getByText('SEARCH RANGE · RESCAN')).toBeInTheDocument();
    expect(within(criterion('delta')).getByText('PREFERENCE')).toBeInTheDocument();
    expect(within(criterion('delta')).queryByText(/SEARCH RANGE/)).not.toBeInTheDocument();
    expect(criterion('delta')).toHaveTextContent(/cannot be a Best Opportunity/);
  });

  it('bid/ask liquidity is a fixed gate, open interest is advisory, the IVR cap is a gate and the floor a preference', () => {
    open();
    expect(within(criterion('liquidity')).getByText('GATE · FIXED')).toBeInTheDocument();
    expect(within(criterion('oi')).getByText('ADVISORY')).toBeInTheDocument();
    expect(within(criterion('ivrCap')).getByText('GATE')).toBeInTheDocument();
    expect(within(criterion('ivrFloor')).getByText('PREFERENCE')).toBeInTheDocument();
    expect(within(criterion('earnings')).getByText('GATE · FIXED')).toBeInTheDocument();
  });

  it('no bid/ask width control exists', () => {
    open();
    expect(screen.queryByLabelText(/bid.?ask/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /bid|ask/i })).not.toBeInTheDocument();
    expect(criterion('liquidity')).toHaveTextContent(/A fixed policy, not a setting/);
  });

  it('Targeted gates carry the GATE tag and the return is named as period ROC', async () => {
    open({ mode: 'targeted' });
    expect(within(criterion('pop')).getByText('GATE')).toBeInTheDocument();
    expect(criterion('roc')).toHaveTextContent('Minimum period return on collateral (ROC)');
    expect(criterion('roc')).toHaveTextContent('% of collateral, over the option period');
  });
});

describe('modes show only the criteria that apply', () => {
  it('Rank has the ordering and the after-scan chips and no Targeted gates', () => {
    open();
    expect(screen.getByLabelText('CSP secondary sort')).toBeInTheDocument();
    expect(criterion('resultChips')).toHaveTextContent(/No rescan/);
    expect(within(criterion('resultChips')).getByText('RESULT FILTER')).toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum estimated POP')).not.toBeInTheDocument();
    expect(criterion('pop')).toBeNull();
  });

  it('Targeted has the gates and no Rank ordering', async () => {
    open();
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    expect(screen.getByLabelText('Minimum estimated POP')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum OTM percentage')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum cash return')).toBeInTheDocument();
    expect(screen.queryByLabelText('CSP secondary sort')).not.toBeInTheDocument();
    expect(criterion('resultChips')).toBeNull();
  });
});

describe('quick-select pills follow the shared pill and input contract', () => {
  it('a range pill sets both ends and flips the preset to Custom', async () => {
    open();
    await userEvent.click(pressed('DTE range quick select', '21–60 DTE'));
    expect(screen.getByLabelText('Min DTE')).toHaveValue('21');
    expect(screen.getByLabelText('Max DTE')).toHaveValue('60');
    expect(pressed('DTE range quick select', '21–60 DTE')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: /Custom/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('typing values that match a preset exactly presses that pill; any other values press none', async () => {
    open();
    expect(pressed('DTE range quick select', '30–45 DTE')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.clear(screen.getByLabelText('Max DTE'));
    await userEvent.type(screen.getByLabelText('Max DTE'), '60');
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '21');
    expect(pressed('DTE range quick select', '21–60 DTE')).toHaveAttribute('aria-pressed', 'true');
    expect(pressed('DTE range quick select', '30–45 DTE')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.clear(screen.getByLabelText('Min DTE'));
    await userEvent.type(screen.getByLabelText('Min DTE'), '25');
    const group = screen.getByRole('group', { name: 'DTE range quick select' });
    expect(within(group).getAllByRole('button').every(b => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('the delta pills work on the preferred band and keep it valid', async () => {
    open();
    await userEvent.click(pressed('Preferred short-put delta quick select', 'Δ .20–.30'));
    expect(screen.getByLabelText('Min Δ')).toHaveValue('0.2');
    expect(screen.getByLabelText('Max Δ')).toHaveValue('0.3');
  });

  it('an open-interest pill sets the OI preference and is carried into the request', async () => {
    const onRun = vi.fn();
    open({}, { onRun });
    await userEvent.click(pressed('OI pref. quick select', '200'));
    expect(screen.getByLabelText('OI pref.')).toHaveValue('200');
    expect(pressed('OI pref. quick select', '200')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun.mock.calls[0][0].rules.OI_MIN).toBe(200);
  });

  it('Targeted gate pills set their own field, with Any as the explicit off state, and never touch another gate', async () => {
    open({ mode: 'targeted' });
    // A fresh Targeted draft has no gates: every group shows Any pressed.
    expect(pressed('POP at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'true');
    expect(pressed('OTM at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(pressed('POP at least quick select', '70%'));
    expect(screen.getByLabelText('Minimum estimated POP')).toHaveValue('70');
    expect(pressed('POP at least quick select', '70%')).toHaveAttribute('aria-pressed', 'true');
    expect(pressed('POP at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'false');
    // OTM and ROC groups did not move.
    expect(pressed('OTM at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'true');
    expect(pressed('Minimum period return on collateral (ROC) quick select', 'Any')).toHaveAttribute('aria-pressed', 'true');
    // Any turns the gate back off.
    await userEvent.click(pressed('POP at least quick select', 'Any'));
    expect(pressed('POP at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'true');
  });

  it('typing a Targeted value that matches a pill presses it', async () => {
    open({ mode: 'targeted' });
    await userEvent.type(screen.getByLabelText('Minimum OTM percentage'), '8');
    expect(pressed('OTM at least quick select', '8%')).toHaveAttribute('aria-pressed', 'true');
    expect(pressed('OTM at least quick select', 'Any')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the scan summary is built from the registry and updates as you edit', () => {
  it('shows the search range, gates, preferences, and capital, and states the IVR limit', async () => {
    open();
    const summary = screen.getByTestId('csp-rule-preview');
    expect(summary).toHaveTextContent('30–45 DTE');
    expect(summary).toHaveTextContent('IVR ≤ 70%');
    expect(summary).toHaveTextContent('bid/ask tiers (fixed)');
    expect(summary).toHaveTextContent('Δ 0.15–0.25 preferred (outside it: not a Best Opportunity)');
    expect(summary).toHaveTextContent('Affordable only off');
    expect(summary).toHaveTextContent(/A symbol with no IV rank is disqualified: the IVR cap cannot be verified/);
    await userEvent.click(pressed('DTE range quick select', '21–60 DTE'));
    expect(summary).toHaveTextContent('21–60 DTE');
  });

  it('a Targeted summary lists the Targeted gates, a Rank summary lists the order', async () => {
    open();
    const summary = screen.getByTestId('csp-rule-preview');
    expect(summary).toHaveTextContent('Score → None');
    expect(summary).not.toHaveTextContent('POP ≥');
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    await userEvent.click(pressed('POP at least quick select', '70%'));
    expect(screen.getByTestId('csp-rule-preview')).toHaveTextContent('POP ≥ 70%');
    expect(screen.getByTestId('csp-rule-preview')).not.toHaveTextContent('Score →');
  });
});

describe('invalid ranges are announced and block Run', () => {
  it('shows the message beside the field, in a polite live region, and disables Run', async () => {
    open();
    await userEvent.clear(screen.getByLabelText('Max DTE'));
    await userEvent.type(screen.getByLabelText('Max DTE'), '20');
    const message = screen.getByText('Max DTE must be above min DTE.');
    expect(message).toHaveAttribute('role', 'status');
    expect(message).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
    // Fixing it clears the message and re-enables Run.
    await userEvent.clear(screen.getByLabelText('Max DTE'));
    await userEvent.type(screen.getByLabelText('Max DTE'), '45');
    expect(screen.queryByText('Max DTE must be above min DTE.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeEnabled();
  });

  it('an out-of-range IVR cap and a delta above 1 each name their own field', async () => {
    open();
    await userEvent.clear(screen.getByLabelText('IVR cap'));
    await userEvent.type(screen.getByLabelText('IVR cap'), '150');
    expect(screen.getByText('IVR cap must be 100 or less.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Max Δ'));
    await userEvent.type(screen.getByLabelText('Max Δ'), '1.5');
    expect(screen.getByText('Max delta must be 1 or less.')).toBeInTheDocument();
  });

  it('Targeted with no gate keeps Run and Confirm disabled', async () => {
    open({ mode: 'targeted' });
    expect(screen.getByRole('button', { name: 'CONFIRM TARGETS' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
    expect(screen.getByText(/Set at least one POP, OTM, or period ROC target/)).toBeInTheDocument();
  });
});

describe('drafts', () => {
  it('Cancel discards edits: a reopened modal starts from the values it was given', async () => {
    const onClose = vi.fn();
    const onRun = vi.fn();
    const { unmount } = open({}, { onClose, onRun });
    await userEvent.click(pressed('DTE range quick select', '21–60 DTE'));
    await userEvent.click(pressed('OI pref. quick select', '200'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
    unmount();
    open();
    expect(screen.getByLabelText('Min DTE')).toHaveValue('30');
    expect(screen.getByLabelText('OI pref.')).toHaveValue('500');
  });

  it('choosing a Targeted profile changes only the fields it owns, not the capital settings', async () => {
    const onRun = vi.fn();
    open({}, { onRun });
    await userEvent.click(screen.getByLabelText(/Only show affordable CSPs/i));
    await userEvent.clear(screen.getByLabelText('Cash cap per CSP'));
    await userEvent.type(screen.getByLabelText('Cash cap per CSP'), '8000');
    await userEvent.click(screen.getByRole('radio', { name: /^Targeted/i }));
    // Capital is a per-mode draft: Targeted starts with its own defaults.
    expect(screen.getByLabelText(/Only show affordable CSPs/i)).not.toBeChecked();
    await userEvent.click(screen.getByLabelText(/Only show affordable CSPs/i));
    await userEvent.clear(screen.getByLabelText('Cash cap per CSP'));
    await userEvent.type(screen.getByLabelText('Cash cap per CSP'), '5000');
    await userEvent.click(screen.getByRole('radio', { name: /Strict targeted preset/i }));
    // Strict sets rules and the three gates...
    expect(screen.getByLabelText('Minimum estimated POP')).toHaveValue('80');
    expect(screen.getByLabelText('Min Δ')).toHaveValue('0.1');
    // ...and leaves the capital choice alone.
    expect(screen.getByLabelText(/Only show affordable CSPs/i)).toBeChecked();
    expect(screen.getByLabelText('Cash cap per CSP')).toHaveValue('5000');
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM TARGETS' }));
    await userEvent.click(screen.getByRole('button', { name: 'RUN CSP SCAN →' }));
    expect(onRun.mock.calls[0][0]).toMatchObject({ mode: 'targeted', affordableOnly: true, capitalLimit: 5000, popMin: 80 });
  });

  it('an edit to a Targeted gate after confirming requires confirming again', async () => {
    open({ mode: 'targeted' });
    await userEvent.click(pressed('POP at least quick select', '70%'));
    await userEvent.click(screen.getByRole('button', { name: 'CONFIRM TARGETS' }));
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeEnabled();
    await userEvent.click(pressed('OTM at least quick select', '8%'));
    expect(screen.getByRole('button', { name: 'CONFIRM TARGETS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RUN CSP SCAN →' })).toBeDisabled();
  });
});

describe('dialog behavior', () => {
  it('is a labelled modal dialog that focuses the selected mode first', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'CASH-SECURED PUT SCAN' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('radio', { name: /^Rank/i })).toHaveFocus();
  });

  it('keeps Tab focus inside the dialog, wrapping from the last control to the first', async () => {
    open();
    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [role="radio"][tabindex="0"]'));
    const last = focusable[focusable.length - 1];
    last.focus();
    await userEvent.tab();
    expect(focusable[0]).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('every input has an accessible name and every quick-select group is labelled', () => {
    open();
    const dialog = screen.getByRole('dialog');
    for (const input of Array.from(dialog.querySelectorAll('input[type="text"], select'))) {
      expect((input as HTMLElement).getAttribute('aria-label'), input.outerHTML.slice(0, 80)).toBeTruthy();
    }
    for (const group of Array.from(dialog.querySelectorAll('[role="group"]'))) {
      expect(group.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
