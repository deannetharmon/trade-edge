// features/screener/components/__tests__/CcViewControls.test.tsx
//
// CC-SIMPLIFY-0001 Phase 2 -- the results-screen delta and width chips, and the "hidden by result filters" banner.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { CcViewControls } from '../CcViewControls';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CC_VIEW, ccViewFromPreset, ccViewWith } from '@/lib/scans/ccView';

const th: ScanModalTheme = { bg: '', card: '', border: '', text: '', textMuted: '', textFaint: '', input: '', inputBorder: '' };

describe('CcViewControls', () => {
  it('starts on the default view: Balanced and 10% pressed, no banner', () => {
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={0} onChange={vi.fn()} />);
    expect(document.querySelector('[data-cc-delta-preset="balanced"]')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-cc-width="10"]')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('cc-view-hidden')).not.toBeInTheDocument();
  });

  it('a delta chip and a width chip hand back the new view', async () => {
    const onChange = vi.fn();
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={0} onChange={onChange} />);
    await userEvent.click(document.querySelector('[data-cc-delta-preset="income"]') as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'income', deltaMin: 0.30, deltaMax: 0.40, widthPctMax: 10 }));
    await userEvent.click(document.querySelector('[data-cc-width="15"]') as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'balanced', widthPctMax: 15 }));
  });

  it('offers an At the money chip that hands back delta .45-.55', async () => {
    const onChange = vi.fn();
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /At the money/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'atm', deltaMin: 0.45, deltaMax: 0.55 }));
  });

  it('shows the hidden count, and Reset returns to the default view', async () => {
    const onChange = vi.fn();
    render(<CcViewControls view={ccViewWith(ccViewFromPreset('income'), { widthPctMax: 5 })} th={th} hiddenCount={12} onChange={onChange} />);
    expect(screen.getByTestId('cc-view-hidden')).toHaveTextContent('12 calls outside this delta and width view');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_CC_VIEW);
  });

  it('says "1 call" for one, and Reset is disabled when already at the default', () => {
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={1} onChange={vi.fn()} />);
    expect(screen.getByTestId('cc-view-hidden')).toHaveTextContent('1 call outside this delta and width view');
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
  });

  it('Custom reveals the delta inputs, which feed a custom view', async () => {
    const onChange = vi.fn();
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={0} onChange={onChange} />);
    await userEvent.click(document.querySelector('[data-cc-delta-preset="custom"]') as HTMLElement);
    const max = screen.getByLabelText('Delta maximum');
    await userEvent.clear(max);
    await userEvent.type(max, '0.5');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'custom', deltaMax: 0.5 }));
  });

  it('opens a list of the hidden calls and says why each is outside the view', async () => {
    const loadHidden = vi.fn(() => [{ symbol: 'TQQQ', floor: 55, calls: [
      { expiration: '2026-12-04', dte: 27, strike: 60, delta: 0.05, bid: 0.4, ask: 0.44, widthPct: 9, reason: 'delta-low' as const },
      { expiration: '2026-12-04', dte: 27, strike: 58, delta: 0.25, bid: 0.1, ask: 0.4, widthPct: 120, reason: 'width' as const },
    ] }]);
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={2} onChange={vi.fn()} loadHidden={loadHidden} />);
    expect(screen.queryByTestId('cc-view-hidden-list')).not.toBeInTheDocument();
    expect(loadHidden).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Show the calls/ }));
    expect(screen.getByTestId('cc-view-hidden-TQQQ')).toHaveTextContent('$55.00 floor');
    expect(screen.getByText('Δ below 0.20')).toBeInTheDocument();
    expect(screen.getByText('120% wide (max 10%)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Hide the calls/ }));
    expect(screen.queryByTestId('cc-view-hidden-list')).not.toBeInTheDocument();
  });
});
