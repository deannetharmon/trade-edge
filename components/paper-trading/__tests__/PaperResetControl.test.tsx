// components/paper-trading/__tests__/PaperResetControl.test.tsx

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaperResetControl from '../PaperResetControl';

describe('PaperResetControl', () => {
  let fetchSpy: ReturnType<typeof vi.fn<any[], any>>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ replay: false }) }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires typing RESET before confirming, and does not call fetch otherwise', async () => {
    render(<PaperResetControl onReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Reset Paper Account'));
    fireEvent.click(screen.getByText('Confirm Reset'));

    await waitFor(() => {
      expect(screen.getByText(/enter the confirmation phrase/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the reset endpoint only after typing RESET', async () => {
    render(<PaperResetControl onReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Reset Paper Account'));
    fireEvent.change(screen.getByLabelText(/Type RESET to confirm/i), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByText('Confirm Reset'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/paper-trading/account/reset', expect.any(Object));
    });
  });

  it('never renders live-order wording', () => {
    const { container } = render(<PaperResetControl onReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Reset Paper Account'));
    const text = container.textContent ?? '';
    for (const forbidden of ['Submit Order', 'Place Order', 'Execute Trade']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
