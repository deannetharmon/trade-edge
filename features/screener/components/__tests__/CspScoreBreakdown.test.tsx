// features/screener/components/__tests__/CspScoreBreakdown.test.tsx
//
// CSP-SCORE-REVIEW-0001: the badge reads "CSP Score N | Details", is colored by band, toggles without
// bubbling to the card, and the panel lists the nine components.

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calculateCspScore } from '@/lib/scans/cspScore';
import { CspScoreBadge, CspScoreBreakdownPanel } from '../CspScoreBreakdown';

const score = calculateCspScore({
  pop: 62, otmPct: 3.7, periodRocPct: 4.714, annualizedRocPct: 59.3, liquidityClass: 'STRONG', openInterest: 1498,
  oiMin: 500, technicalFit: 9, ivr: 45.8, ivrMin: 30, ivrMax: 70, earningsWithinExpiration: false,
});
const display = {
  pop: 62, otmPct: 3.7, periodRocPct: 4.714, annualizedRocPct: 59.3, liquidityClass: 'STRONG', openInterest: 1498, ivr: 45.8,
};

function Harness({ onCardClick }: { onCardClick: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={onCardClick}>
      <CspScoreBadge score={74} band="yellow" open={open} onToggle={() => setOpen(v => !v)} />
      {open && <CspScoreBreakdownPanel score={score} display={display} band="yellow" />}
    </div>
  );
}

describe('CSP score badge and panel', () => {
  it('shows the score, a Details label and the band color', () => {
    render(<Harness onCardClick={() => {}} />);
    const badge = screen.getByTestId('csp-score-badge');
    expect(badge).toHaveTextContent('CSP Score 74');
    expect(badge).toHaveTextContent('Details');
    expect(badge.className).toContain('text-yellow-400');
    expect(badge).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes the panel without triggering the card click', async () => {
    const onCardClick = vi.fn();
    render(<Harness onCardClick={onCardClick} />);
    const badge = screen.getByTestId('csp-score-badge');
    await userEvent.click(badge);
    expect(screen.getByTestId('csp-score-panel')).toBeInTheDocument();
    expect(badge).toHaveTextContent('Hide');
    expect(badge).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(badge);
    expect(screen.queryByTestId('csp-score-panel')).not.toBeInTheDocument();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('lists the nine components with points and the total', async () => {
    render(<Harness onCardClick={() => {}} />);
    await userEvent.click(screen.getByTestId('csp-score-badge'));
    for (const key of ['pop', 'otm', 'periodRoc', 'annualizedRoc', 'liquidityWidth', 'liquidityOi', 'technical', 'ivr', 'eventRisk']) {
      expect(screen.getByTestId(`csp-score-row-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('csp-score-row-technical')).toHaveTextContent('1.4 / 15');
    expect(screen.getByTestId('csp-score-panel')).toHaveTextContent('68.1 / 100');
  });

  it('shows the return-cap note in the badge title and the panel when a green score is held at Acceptable', async () => {
    const note = 'Score reaches Strong, but annualized return is under 30%, so the band stays Acceptable.';
    render(
      <div>
        <CspScoreBadge score={76} band="yellow" open={false} onToggle={() => {}} capNote={note} />
        <CspScoreBreakdownPanel score={score} display={display} band="yellow" capNote={note} />
      </div>,
    );
    expect(screen.getByTestId('csp-score-badge')).toHaveAttribute('title', expect.stringContaining('annualized return is under 30%'));
    expect(screen.getByTestId('csp-score-cap-note')).toHaveTextContent(note);
  });

  it('shows no cap note when none applies', async () => {
    render(<CspScoreBreakdownPanel score={score} display={display} band="yellow" />);
    expect(screen.queryByTestId('csp-score-cap-note')).not.toBeInTheDocument();
  });
});
