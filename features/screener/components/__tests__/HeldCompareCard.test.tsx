// features/screener/components/__tests__/HeldCompareCard.test.tsx

import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HeldCompareForPairs } from '../HeldCompareCard';

const th = { bg: '', card: '', border: 'border-neutral-700', text: '', textMuted: 'text-neutral-400', textFaint: 'text-neutral-500', input: '', inputBorder: '' };

const pair = (strike: number, delta: number, credit: number, over: Record<string, unknown> = {}) => ({
  entryMode: 'covered-short-call-against-held-leaps',
  longLeg: { strike: 67.5, dte: 312, executablePrice: 11.2, quote: { midpoint: 11.35 } },
  shortLeg: { candidateId: `s${strike}`, strike, dte: 38, delta, executablePrice: credit },
  failureReasons: [],
  heldLongLeg: { occSymbol: 'UBER  270917C00067500', quantity: 1, avgOpenPrice: 21.3 },
  ...over,
});
const pairs = [pair(77, 0.2, 0.86), pair(78, 0.17, 0.71), pair(79, 0.14, 0.58)];

describe('HeldCompareForPairs (UBER story)', () => {
  it('shows paid, worth, and how far under what you paid', () => {
    render(<HeldCompareForPairs pairs={pairs} spot={68.68} symbol="UBER" th={th} />);
    expect(screen.getByTestId('held-compare')).toHaveTextContent('$2,130');
    expect(screen.getByTestId('held-compare')).toHaveTextContent('$1,135');
    expect(screen.getByTestId('held-compare-down')).toHaveTextContent('Down vs what you paid');
    expect(screen.getByTestId('held-compare-down')).toHaveTextContent('−$995');
  });
  it('pre-selects the farthest-strike call when under water, and keeps No call available', () => {
    render(<HeldCompareForPairs pairs={pairs} spot={68.68} symbol="UBER" th={th} />);
    expect(screen.getByTestId('held-compare-option-bullish')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('held-compare-option-bullish')).toHaveTextContent('Sell 1 × $79');
    expect(screen.getByTestId('held-compare-option-bullish')).toHaveTextContent('$58');
    expect(screen.getByTestId('held-compare-option-none')).toHaveTextContent('No call');
    expect(screen.getByTestId('held-compare-option-none')).toHaveAttribute('aria-checked', 'false');
  });
  it('labels odds as model odds from delta and shows the required cap sentence', () => {
    render(<HeldCompareForPairs pairs={pairs} spot={68.68} symbol="UBER" th={th} />);
    expect(screen.getByTestId('held-compare-odds')).toHaveTextContent('About 86%');
    expect(screen.getByTestId('held-compare-odds')).toHaveTextContent('model odds');
    expect(screen.getByTestId('held-compare-odds')).toHaveTextContent('About 14%');
    expect(screen.getByTestId('held-compare-cap')).toHaveTextContent('Above $79, additional stock gains are substantially offset until you close or roll the short call.');
  });
  it('picking another choice moves the selection and the cap sentence', () => {
    render(<HeldCompareForPairs pairs={pairs} spot={68.68} symbol="UBER" th={th} />);
    fireEvent.click(screen.getByTestId('held-compare-option-cautious'));
    expect(screen.getByTestId('held-compare-option-cautious')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('held-compare-cap')).toHaveTextContent('Above $77');
    fireEvent.click(screen.getByTestId('held-compare-option-none'));
    expect(screen.queryByTestId('held-compare-cap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('held-compare-odds')).not.toBeInTheDocument();
  });
  it('table is measured against what you paid and includes the capped-rally row', () => {
    render(<HeldCompareForPairs pairs={pairs} spot={68.68} symbol="UBER" th={th} />);
    const table = screen.getByTestId('held-compare-table');
    expect(table).toHaveTextContent('Unchanged · $68.68');
    expect(table).toHaveTextContent('Up 5% · $72.11');
    expect(table).toHaveTextContent('Up 10% · $75.55');
    expect(table).toHaveTextContent('10% above $79 · $86.90');
  });
  it('renders nothing without a usable cost basis', () => {
    const { container } = render(<HeldCompareForPairs pairs={[pair(79, 0.14, 0.58, { heldLongLeg: { occSymbol: 'X', quantity: 1, avgOpenPrice: null } })]} spot={68.68} symbol="UBER" th={th} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('ignores new-entry pairs and calls at or below the LEAP strike', () => {
    const { container } = render(<HeldCompareForPairs pairs={[pair(79, 0.14, 0.58, { entryMode: 'new-pmcc' })]} spot={68.68} symbol="UBER" th={th} />);
    expect(container).toBeEmptyDOMElement();
    render(<HeldCompareForPairs pairs={[pair(67, 0.5, 4, { failureReasons: [{ code: 'LONG_STRIKE_NOT_BELOW_SHORT' }] }), pair(79, 0.14, 0.58)]} spot={68.68} symbol="UBER" th={th} />);
    expect(screen.queryByText('Sell 1 × $67')).not.toBeInTheDocument();
  });
});
