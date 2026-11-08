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

  it('shows the hidden count, and Reset returns to the default view', async () => {
    const onChange = vi.fn();
    render(<CcViewControls view={ccViewWith(ccViewFromPreset('income'), { widthPctMax: 5 })} th={th} hiddenCount={12} onChange={onChange} />);
    expect(screen.getByTestId('cc-view-hidden')).toHaveTextContent('12 calls hidden by result filters');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_CC_VIEW);
  });

  it('says "1 call" for one, and Reset is disabled when already at the default', () => {
    render(<CcViewControls view={DEFAULT_CC_VIEW} th={th} hiddenCount={1} onChange={vi.fn()} />);
    expect(screen.getByTestId('cc-view-hidden')).toHaveTextContent('1 call hidden by result filters');
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
});
