// components/nav/__tests__/ToolLinks.test.tsx

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolLinks, TOOL_LINKS } from '../ToolLinks';
import { AppHeader } from '../AppHeader';

describe('TOOL-LINKS-0001', () => {
  it('lists the four tools, each opening in a new tab safely', () => {
    render(<ToolLinks />);
    expect(TOOL_LINKS.map(l => l.label)).toEqual(['TradingView', 'GuacTracker', 'Discord', 'Yahoo Finance']);
    for (const l of TOOL_LINKS) {
      const a = screen.getByRole('link', { name: l.label });
      expect(a).toHaveAttribute('href', l.href);
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
  it('the header renders them on every page, including pages with no theme controls', () => {
    render(<AppHeader />);
    expect(screen.getByTestId('tool-links')).toBeInTheDocument();
  });
});

describe('RESEARCH-0001 header search', () => {
  it('is a plain GET form to /research with a symbol field', () => {
    render(<AppHeader />);
    const form = screen.getByRole('search', { name: 'Look up a stock' });
    expect(form).toHaveAttribute('action', '/research');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText('Look up a ticker')).toHaveAttribute('name', 'symbol');
  });
});
