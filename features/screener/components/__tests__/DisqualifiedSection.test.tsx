// features/screener/components/__tests__/DisqualifiedSection.test.tsx
//
// SCREENER-UX-0001 required tests 11-13: Disqualified is collapsed by
// default when qualified candidates exist, shows a count in its heading,
// shows the primary reason even while each card is collapsed (never a bare
// color badge alone), and uses "Disqualified" — never "Rejected".

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DisqualifiedSection } from '../DisqualifiedSection';
import type { ScreenResult } from '@/lib/scans/types';

function result(overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AAPL',
    strategy: 'BPS',
    price: 100,
    ivr: 50,
    qualified: false,
    bestCandidate: { strategy: 'BPS', expiration: '2026-09-18', dte: 30, shortStrike: 95, longStrike: 90, shortDelta: -0.2, credit: 1, spreadWidth: 5, creditRatio: 0.2, roc: 5, pop: 60, shortOI: 100, longOI: 50 } as any,
    failReasons: ['POP below minimum threshold'],
    checks: {
      ivr: { status: 'pass', value: '50', reason: 'ok' },
      pop: { status: 'fail', value: '60', reason: 'below minimum' },
    } as any,
    ...overrides,
  };
}

describe('DisqualifiedSection', () => {
  it('renders null when there are no disqualified results', () => {
    const { container } = render(<DisqualifiedSection results={[]} hasQualifiedCandidates={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count in the section heading and uses "Disqualified," never "Rejected"', () => {
    render(<DisqualifiedSection results={[result(), result({ symbol: 'MSFT' })]} hasQualifiedCandidates={true} />);
    expect(screen.getByText('Disqualified (2)')).toBeInTheDocument();
    expect(screen.queryByText(/rejected/i)).not.toBeInTheDocument();
  });

  it('starts collapsed when qualified candidates exist alongside it', () => {
    render(<DisqualifiedSection results={[result()]} hasQualifiedCandidates={true} />);
    const sectionToggle = screen.getByRole('button', { name: /Disqualified \(1\)/ });
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts expanded when there are no qualified candidates (nothing else to show)', () => {
    render(<DisqualifiedSection results={[result()]} hasQualifiedCandidates={false} />);
    const sectionToggle = screen.getByRole('button', { name: /Disqualified \(1\)/ });
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the primary reason on the collapsed card, never a bare badge alone', () => {
    render(<DisqualifiedSection results={[result()]} hasQualifiedCandidates={false} />);
    expect(screen.getByText('POP below minimum threshold')).toBeInTheDocument();
  });

  it('expands an individual card to reveal every fail reason and failed/warn check', () => {
    render(<DisqualifiedSection results={[result({ failReasons: ['POP below minimum threshold', 'IVR too low'] })]} hasQualifiedCandidates={false} />);
    const cardToggle = screen.getByRole('button', { name: /show checks/i });
    fireEvent.click(cardToggle);
    expect(screen.getByText(/IVR too low/)).toBeInTheDocument();
    expect(screen.getAllByText(/below minimum/).length).toBeGreaterThan(0); // pop check reason
  });

  it('announces the section expand/collapse state via a polite live region', () => {
    render(<DisqualifiedSection results={[result()]} hasQualifiedCandidates={true} />);
    const sectionToggle = screen.getByRole('button', { name: /Disqualified \(1\)/ });
    fireEvent.click(sectionToggle);
    const statuses = screen.getAllByRole('status').map(el => el.textContent);
    expect(statuses).toContain('Disqualified section expanded');
  });

  it('restores focus to the card toggle button when the card collapses', async () => {
    render(<DisqualifiedSection results={[result({ failReasons: ['POP below minimum threshold', 'IVR too low'] })]} hasQualifiedCandidates={false} />);
    const cardToggle = screen.getByRole('button', { name: /show checks/i });
    fireEvent.click(cardToggle); // expand
    const hideButton = screen.getByRole('button', { name: /hide checks/i });
    fireEvent.click(hideButton); // collapse -- focus should return to the (same) toggle button
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(screen.getByRole('button', { name: /show checks/i })).toHaveFocus();
  });

  it('summarizes CSP blockers by root cause and ticker while preserving expiration and contract drill-down', async () => {
    const csp = (symbol: string, strike: number): ScreenResult => result({
      symbol,
      strategy: 'CSP',
      bestCandidate: { ...(result().bestCandidate as any), strategy: 'CSP', shortStrike: strike },
      candidateId: `${symbol}-${strike}`,
      failReasons: ['Earnings within expiry window — assignment risk into a binary event'],
    });
    render(<DisqualifiedSection results={[csp('MU', 800), csp('MU', 795)]} hasQualifiedCandidates={false} groupByExpiration />);
    expect(screen.getByText('Disqualified audit (2 contracts)')).toBeInTheDocument();
    expect(screen.getByLabelText('CSP disqualification summary')).toHaveTextContent('1 ticker · 2 contracts excluded');
    expect(screen.getByLabelText('CSP disqualification summary')).toHaveTextContent('Eligibility blocker — Event-risk exclusion: MU · 2 contracts affected');
    const expiration = screen.getByRole('button', { name: /30 DTE, 2 excluded contracts/i });
    await fireEvent.click(expiration);
    expect(screen.getAllByRole('button', { name: /Show checks for MU/i })).toHaveLength(2);
  });
});
