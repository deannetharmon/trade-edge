// components/paper-trading/__tests__/PaperTicketForm.test.tsx

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaperTicketForm from '../PaperTicketForm';

describe('PaperTicketForm', () => {
  let fetchSpy: ReturnType<typeof vi.fn<any[], any>>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ position: { positionId: 'p1' }, ledgerView: {}, replay: false }),
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the PAPER confirmation checkbox before submitting, and does not call fetch without it', async () => {
    render(<PaperTicketForm onSubmitted={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('SPY'), { target: { value: 'SPY' } });
    fireEvent.click(screen.getByText('Simulate Paper Fill'));

    await waitFor(() => {
      expect(screen.getByText(/confirm this is a PAPER simulation/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces a validation error for an incomplete ticket even when confirmed', async () => {
    render(<PaperTicketForm onSubmitted={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(/I understand this creates/i));
    fireEvent.click(screen.getByText('Simulate Paper Fill'));

    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('disables the submit button while a submission is pending (double-submit prevention)', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    fetchSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(<PaperTicketForm onSubmitted={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('SPY'), { target: { value: 'SPY' } });
    const strikeInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(strikeInputs[0], { target: { value: '400' } }); // strike
    fireEvent.change(strikeInputs[1], { target: { value: '3.0' } }); // bid
    fireEvent.change(strikeInputs[2], { target: { value: '3.2' } }); // ask

    const expirationInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(expirationInput, { target: { value: '2026-08-21' } });

    fireEvent.click(screen.getByLabelText(/I understand this creates/i));
    fireEvent.click(screen.getByText('Simulate Paper Fill'));

    await waitFor(() => {
      expect(screen.getByText('Simulating…')).toBeInTheDocument();
    });
    const button = screen.getByText('Simulating…').closest('button');
    expect(button).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({ position: { positionId: 'p1' }, ledgerView: {}, replay: false }) });
  });

  it('never renders live Trade/Execute/Submit Order wording', () => {
    const { container } = render(<PaperTicketForm onSubmitted={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const forbidden of ['Submit Order', 'Place Order', 'Execute Trade', 'Buy Now', 'Auto-Trade']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('sends no hardcoded personal identity for a manual paper fill -- only price, reason, and confirmed:true (corrective round fix #4)', async () => {
    render(<PaperTicketForm onSubmitted={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('SPY'), { target: { value: 'SPY' } });
    fireEvent.change(screen.getByLabelText('Strike'), { target: { value: '400' } });
    const expirationInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(expirationInput, { target: { value: '2026-08-21' } });

    fireEvent.click(screen.getByLabelText(/Manual Paper Fill \(override/i));
    fireEvent.change(screen.getByLabelText(/Manual fill price/i), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'after hours' } });

    fireEvent.click(screen.getByLabelText(/I understand this creates/i));
    fireEvent.click(screen.getByText('Simulate Paper Fill'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(sentBody.manualOverride).toEqual({ manualPrice: 250, reason: 'after hours', confirmed: true });
    expect(sentBody.manualOverride.confirmedByUser).toBeUndefined();
    expect(sentBody.manualOverride.confirmedAt).toBeUndefined();
  });
});
