// features/portfolio/positions-workspace/__tests__/CcBasisEditor.test.tsx

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CcBasisEditor } from '../CcBasisEditor';

const th = { border: 'border-white/10', textFaint: 'text-white/50' };
let stored: Record<string, unknown> = {};

beforeEach(() => {
  stored = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { stored = JSON.parse(init.body as string).settings; return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ config: { settings: stored } }) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('CcBasisEditor', () => {
  it('labels the broker basis when nothing is typed', async () => {
    render(<CcBasisEditor symbol="TQQQ" brokerBasis={80} th={th} />);
    expect(await screen.findByText(/Calls use \$80(\.00)? \(broker\)/)).toBeTruthy();
  });

  it('saves a typed basis and opt-in, then labels it as typed', async () => {
    render(<CcBasisEditor symbol="TQQQ" brokerBasis={80} th={th} />);
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(screen.getByLabelText('TQQQ cost basis per share'), { target: { value: '76.5' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(stored).toEqual({ TQQQ: { basis: 76.5, allowBelowBasis: true } }));
    expect(await screen.findByText(/typed by you\) · below-basis OK/)).toBeTruthy();
  });

  it('rejects a bad number without saving', async () => {
    render(<CcBasisEditor symbol="TQQQ" brokerBasis={80} th={th} />);
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(screen.getByLabelText('TQQQ cost basis per share'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(stored).toEqual({});
  });
});
