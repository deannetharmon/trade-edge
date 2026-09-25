// features/screener/components/__tests__/ActivePmccRules.test.tsx

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivePmccRules } from '../ActivePmccRules';

const snap = { criteria: { dte: { shortMin: 21, shortMax: 45 }, shortOiMin: 100, quotePolicy: { qualifyingSpreadPctMax: 10, shortWidthCeiling: 0.5 } } };

describe('ActivePmccRules', () => {
  it('renders heading, items, and caption; no edit button', () => {
    render(<ActivePmccRules snapshot={snap} entryMode="covered-short-call-against-held-leaps" />);
    expect(screen.getByTestId('active-pmcc-rules-heading').textContent).toBe('Active PMCC rules · Held LEAP');
    expect(screen.getAllByTestId('active-pmcc-rule-item')).toHaveLength(5);
    expect(screen.getByTestId('active-pmcc-rules-caption').textContent).toBe('Short call rules only. LEAP rules are not shown.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('active-pmcc-rules').textContent).not.toMatch(/NaN|null|undefined/);
  });

  it('renders nothing without a snapshot', () => {
    const { container } = render(<ActivePmccRules snapshot={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('omits an item with a non-finite value', () => {
    render(<ActivePmccRules snapshot={{ criteria: { shortOiMin: NaN } }} />);
    expect(screen.getByTestId('active-pmcc-rules').textContent).not.toMatch(/NaN|Short OI/);
  });
});
