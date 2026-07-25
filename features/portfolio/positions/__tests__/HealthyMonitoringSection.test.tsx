// features/portfolio/positions/__tests__/HealthyMonitoringSection.test.tsx
//
// WA-0003: HealthyMonitoringSection is a verbatim extraction of
// TodaysPrioritiesDashboard.tsx's old Monitor section -- coverage confirms
// healthy positions remain visible, are never rendered as a task (no
// completion control), and preserve unchanged health/DTE values, plus the
// collapse-after-6 interaction.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { HealthyMonitoringSection } from '../HealthyMonitoringSection';
import type { TodaysPrioritiesMonitorEntry } from '@/lib/todaysPriorities';

function makeEntry(overrides: Partial<TodaysPrioritiesMonitorEntry> = {}): TodaysPrioritiesMonitorEntry {
  return { key: 'AMD::stock', symbol: 'AMD', strategy: 'Covered Call', dte: 30, healthScore: 88, ...overrides };
}

describe('HealthyMonitoringSection', () => {
  it('renders nothing when monitor is empty', () => {
    const { container } = render(<HealthyMonitoringSection monitor={[]} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per healthy position with unchanged symbol/strategy/dte/healthScore', () => {
    render(<HealthyMonitoringSection monitor={[makeEntry()]} th={THEMES.dark} />);
    expect(screen.getByText('AMD')).toBeInTheDocument();
    expect(screen.getByText('Covered Call')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  it('renders a dash for a null health score, unchanged from the pre-migration MonitorRow', () => {
    render(<HealthyMonitoringSection monitor={[makeEntry({ healthScore: null })]} th={THEMES.dark} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('has aria-label "Healthy Position Monitoring", distinguishing it from a task list', () => {
    render(<HealthyMonitoringSection monitor={[makeEntry()]} th={THEMES.dark} />);
    expect(screen.getByRole('region', { name: 'Healthy Position Monitoring' })).toBeInTheDocument();
  });

  it('renders no completion control (no Mark Complete / Reopen button)', () => {
    render(<HealthyMonitoringSection monitor={[makeEntry()]} th={THEMES.dark} />);
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
  });

  it('collapses to 6 rows by default and expands via "Show all" when more than 6 entries exist', async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 8 }, (_, i) => makeEntry({ key: `sym${i}::stock`, symbol: `SYM${i}` }));
    render(<HealthyMonitoringSection monitor={entries} th={THEMES.dark} />);

    expect(screen.getByText('SYM0')).toBeInTheDocument();
    expect(screen.queryByText('SYM7')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show all 8/i }));
    expect(screen.getByText('SYM7')).toBeInTheDocument();
  });

  it('does not show a "Show all" toggle at exactly 6 entries', () => {
    const entries = Array.from({ length: 6 }, (_, i) => makeEntry({ key: `sym${i}::stock`, symbol: `SYM${i}` }));
    render(<HealthyMonitoringSection monitor={entries} th={THEMES.dark} />);
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });
});
