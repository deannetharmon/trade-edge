import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCspRules } from '../ActiveCspRules';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

describe('ActiveCspRules Rank ordering', () => {
  it('displays Score as primary and the preserved supported secondary sort', () => {
    const snapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES, { mode: 'rank', rankSecondary: 'rocPct' });
    render(<ActiveCspRules snapshot={snapshot} onEdit={vi.fn()} />);
    expect(screen.getByTestId('active-csp-rules')).toHaveTextContent('Order Score → rocPct');
  });
});
