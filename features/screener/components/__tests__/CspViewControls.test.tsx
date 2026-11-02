// features/screener/components/__tests__/CspViewControls.test.tsx
//
// SCAN-SIMPLIFY-0001 -- every former pre-scan CSP setting is a results-screen control.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { CspViewControls } from '../CspViewControls';
import { cspViewFromPreset } from '@/lib/scans/cspView';
import type { ScanModalTheme } from '../ScanModalShell';

const th: ScanModalTheme = {
  bg: '', card: '', border: '', text: '', textMuted: '', textFaint: '', input: '', inputBorder: '',
};

function setup(over: Partial<React.ComponentProps<typeof CspViewControls>> = {}) {
  const props = {
    view: cspViewFromPreset('balanced', 7, 60), th,
    onPreset: vi.fn(), onChange: vi.fn(), affordableOnly: false, setAffordableOnly: vi.fn(), ...over,
  };
  render(<CspViewControls {...props} />);
  return props;
}

describe('SCAN-SIMPLIFY-0001 CspViewControls', () => {
  it('shows the three presets plus Custom, with the active one pressed', () => {
    setup();
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Conservative' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'More opportunities' })).not.toBeChecked();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('choosing a preset reports it', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Conservative' }));
    expect(p.onPreset).toHaveBeenCalledWith('conservative');
  });

  it('every former pre-scan control has a results-screen input', () => {
    setup();
    for (const label of ['Delta minimum', 'Delta maximum', 'View DTE minimum', 'View DTE maximum',
      'IVR preferred minimum', 'IVR cap maximum', 'Preferred open interest', 'Return minimum']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: /Affordable only/i })).toBeInTheDocument();
  });

  it('editing a field reports a patch; Affordable only toggles', async () => {
    const p = setup();
    const cap = screen.getByLabelText('IVR cap maximum');
    await userEvent.clear(cap);
    await userEvent.type(cap, '90');
    expect(p.onChange).toHaveBeenLastCalledWith({ ivrMax: 90 });
    await userEvent.click(screen.getByRole('checkbox', { name: /Affordable only/i }));
    expect(p.setAffordableOnly).toHaveBeenCalledWith(true);
  });

  it('marks Custom when the view is no longer a preset', () => {
    setup({ view: { ...cspViewFromPreset('balanced', 7, 60), preset: 'custom' } });
    expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
  });
});
