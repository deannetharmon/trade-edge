import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveCcRules } from '../ActiveCcRules';
import { DEFAULT_CC_RULES } from '@/lib/scans/constants';

describe('ActiveCcRules: the covered-call result receipt', () => {
  it('shows the rules the scan ran with, from the same registry as the modal summary', () => {
    render(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES, DTE_MIN: 30, DTE_MAX: 45, WIDTH_PCT_MAX: 5, WIDTH_CEILING: 0.3 } }} onEdit={vi.fn()} />);
    const receipt = screen.getByTestId('active-cc-rules');
    expect(receipt).toHaveTextContent('Search range · rescan to change');
    expect(receipt).toHaveTextContent('30–45 DTE · Δ 0.20–0.35 · width ≤ 5% of mid (min $0.05) · cap $0.30');
    expect(receipt).toHaveTextContent('strike ≥ stock price (and cost basis when known) · two-sided quotes · expires before earnings');
    expect(receipt).toHaveTextContent('OI 100');
    expect(receipt).toHaveTextContent('POP · OTM · IVR · Call OI chips · sort');
  });

  it('shows the result counts as symbols, and leaves them out when there are none', () => {
    const { rerender } = render(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} counts={{ symbolsWithCandidate: 3, symbolsWithNone: 1 }} onEdit={vi.fn()} />);
    expect(screen.getByTestId('active-cc-rules')).toHaveTextContent('3 symbols with a candidate · 1 with none');
    rerender(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} counts={{ symbolsWithCandidate: 1, symbolsWithNone: 0 }} onEdit={vi.fn()} />);
    expect(screen.getByTestId('active-cc-rules')).toHaveTextContent('1 symbol with a candidate · 0 with none');
    rerender(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} onEdit={vi.fn()} />);
    expect(screen.getByTestId('active-cc-rules')).not.toHaveTextContent('with a candidate');
  });

  it('has no capacity line: a stored scan does not record the positions', () => {
    render(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} onEdit={vi.fn()} />);
    expect(screen.getByTestId('active-cc-rules')).not.toHaveTextContent(/positions? selected/);
  });

  it('Edit / Run Again reopens the configuration', async () => {
    const onEdit = vi.fn();
    render(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit / Run Again' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('is a labelled region', () => {
    render(<ActiveCcRules values={{ rules: { ...DEFAULT_CC_RULES } }} onEdit={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Active CC rules' })).toBeInTheDocument();
  });
});
