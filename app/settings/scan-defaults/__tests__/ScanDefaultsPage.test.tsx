// app/settings/scan-defaults/__tests__/ScanDefaultsPage.test.tsx

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScanDefaultsPage from '../page';
import { EMPTY_SCAN_PREFERENCES } from '@/lib/screener/scanPreferences';
import type { ScanPreferences } from '@/lib/screener/scanPreferences';

function mockFetch(initial: ScanPreferences) {
  let current = initial;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const patch = JSON.parse(init.body as string);
      current = {
        ...current,
        ...('dteMin' in patch ? { dteMin: patch.dteMin } : {}),
        ...('oiMin' in patch ? { oiMin: patch.oiMin } : {}),
        ...('popMin' in patch ? { popMin: patch.popMin } : {}),
        delta: patch.delta ? { ...current.delta, ...patch.delta } : current.delta,
        defaultMode: patch.defaultMode ? { ...current.defaultMode, ...patch.defaultMode } : current.defaultMode,
      };
      return new Response(JSON.stringify({ preferences: current }), { status: 200 });
    }
    return new Response(JSON.stringify({ preferences: current }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); });

describe('ScanDefaultsPage', () => {
  it('loads and shows empty (Any) fields when nothing is saved', async () => {
    mockFetch(EMPTY_SCAN_PREFERENCES);
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-oi-min')).toBeInTheDocument());
    expect(screen.getByTestId('pref-oi-min')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear Open interest minimum' })).not.toBeInTheDocument();
  });

  it('loads and pre-fills previously saved values', async () => {
    mockFetch({ ...EMPTY_SCAN_PREFERENCES, oiMin: 100, delta: { csp: { min: 0.15, max: 0.25 } } });
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-oi-min')).toHaveValue('100'));
    expect(screen.getByTestId('pref-delta-csp-min')).toHaveValue('0.15');
    expect(screen.getByTestId('pref-delta-csp-max')).toHaveValue('0.25');
  });

  it('editing a global field saves it and shows a brief confirmation', async () => {
    const fetchMock = mockFetch(EMPTY_SCAN_PREFERENCES);
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-oi-min')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('pref-oi-min'), '100');
    await userEvent.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/screener/preferences', expect.objectContaining({ method: 'POST' })));
    const call = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST');
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ oiMin: 100 });
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
  });

  it('clicking "Any" clears a field and saves null', async () => {
    const fetchMock = mockFetch({ ...EMPTY_SCAN_PREFERENCES, oiMin: 100 });
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-oi-min')).toHaveValue('100'));

    await userEvent.click(screen.getByRole('button', { name: 'Clear Open interest minimum' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST');
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({ oiMin: null });
    });
  });

  it('CSP\'s delta save never touches IC or Spreads (acceptance criterion 3, at the UI layer)', async () => {
    const fetchMock = mockFetch(EMPTY_SCAN_PREFERENCES);
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-delta-csp-min')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('pref-delta-csp-min'), '0.15');
    await userEvent.type(screen.getByTestId('pref-delta-csp-max'), '0.25');
    await userEvent.tab();

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST');
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({ delta: { csp: { min: 0.15, max: 0.25 } } });
    });
    expect(screen.getByTestId('pref-delta-ic-min')).toHaveValue('');
    expect(screen.getByTestId('pref-delta-spreads-min')).toHaveValue('');
  });

  it('setting a default mode saves it, and "Any (app default)" clears it', async () => {
    const fetchMock = mockFetch(EMPTY_SCAN_PREFERENCES);
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-mode-csp')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByTestId('pref-mode-csp'), 'targeted');
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST');
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({ defaultMode: { csp: 'targeted' } });
    });
  });

  it('CC and PMCC are not shown as mode options (they always use Filter, per SCREENER-CONFIG-0001)', async () => {
    mockFetch(EMPTY_SCAN_PREFERENCES);
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByTestId('pref-mode-csp')).toBeInTheDocument());
    expect(screen.queryByTestId('pref-mode-cc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pref-mode-pmcc')).not.toBeInTheDocument();
  });

  it('a load failure shows a banner but does not crash the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    render(<ScanDefaultsPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('pref-oi-min')).toBeInTheDocument();
  });
});
