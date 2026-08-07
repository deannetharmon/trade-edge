// features/screener/components/__tests__/ScanIdentityHeader.test.tsx
//
// SCREENER-UX-0001 required test 1: scan identity always leads the
// hierarchy and renders the exact title text, plus explicit mode/strategy
// labels so neither has to be inferred from the cards below. Also required
// test 20 (heading hierarchy): the title is a real heading element.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ScanIdentityHeader } from '../ScanIdentityHeader';

describe('ScanIdentityHeader', () => {
  it('renders the exact required title for a Filtered spread scan', () => {
    render(<ScanIdentityHeader mode="filter" requestedStrategy="spreads" />);
    expect(screen.getByRole('heading', { name: 'Filtered Spread Scan' })).toBeInTheDocument();
  });

  it('renders the exact required title for a Covered Call scan', () => {
    render(<ScanIdentityHeader mode="filter" requestedStrategy="cc" />);
    expect(screen.getByRole('heading', { name: 'Covered Call Scan' })).toBeInTheDocument();
  });

  it('renders explicit Mode and Strategy labels alongside the title', () => {
    render(<ScanIdentityHeader mode="rank" requestedStrategy="spreads" />);
    expect(screen.getByText(/Mode:/)).toHaveTextContent('Mode: Ranked');
    expect(screen.getByText(/Mode:/)).toHaveTextContent('Strategy: Spread');
  });

  it('uses a real heading element (heading-hierarchy requirement)', () => {
    render(<ScanIdentityHeader mode="filter" requestedStrategy="pmcc" />);
    const heading = screen.getByRole('heading', { name: 'PMCC Scan' });
    expect(heading.tagName).toBe('H2');
  });
});
