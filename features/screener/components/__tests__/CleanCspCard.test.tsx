// features/screener/components/__tests__/CleanCspCard.test.tsx

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CleanCspLine, CleanCspDetails } from '../CleanCspCard';
import { CspViewControls } from '../CspViewControls';
import { cspViewFromPreset } from '@/lib/scans/cspView';

const th = { text: 'text-white', textFaint: 'text-gray-500', label: 'text-gray-400', border: 'border-gray-700' };
const c: any = {
  strategy: 'CSP', shortStrike: 90, expiration: 'Nov 13', dte: 7, credit: 0.11, annualizedRoc: 6, pop: 87, shortOI: 421,
  requiredCash: 9000, breakeven: 89.89, shortDelta: 0.13, shortBid: 0.07, shortAsk: 0.15, roc: 0.1, expectedMove: 3.19,
  cspOiPassing: false,
};
const result: any = { symbol: 'KO', price: 94, qualified: true, failReasons: [], ivr: 61.3, ivx: 24.5, checks: {} };
const alloc = { currentPct: 4, afterPct: 13, currentDollars: 4000, addDollars: 9000, afterDollars: 13000, netLiq: 100000 };

describe('CleanCspLine', () => {
  const base = { result, c, th, rsi14: 56, oiBelowFloor: true, alloc, score: 73, band: 'yellow' as const, scoreOpen: false, onScore: () => {}, expanded: false };
  it('shows the bare essentials once', () => {
    render(<CleanCspLine {...base} />);
    expect(screen.getByText('$11')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('4.4%')).toBeInTheDocument();
    expect(screen.getByText('4% → 13%')).toBeInTheDocument();
    expect(screen.getByText('421')).toBeInTheDocument();
    expect(screen.getByText('$9,000')).toBeInTheDocument();
    expect(screen.queryByTestId('clean-fails')).toBeNull();
  });
  it('credit is always bold green', () => {
    render(<CleanCspLine {...base} />);
    expect(screen.getByText('$11').className).toMatch(/text-emerald-400/);
    expect(screen.getByText('$11').className).toMatch(/font-extrabold/);
  });
  it('the score is a button that opens the scoring details and does not toggle the card', () => {
    const onScore = vi.fn(); const onCard = vi.fn();
    render(<div onClick={onCard}><CleanCspLine {...base} onScore={onScore} /></div>);
    fireEvent.click(screen.getByTestId('clean-score'));
    expect(onScore).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
  });
  it('allocation fails closed to a dash', () => {
    render(<CleanCspLine {...base} alloc={null} />);
    expect(screen.queryByText('4% → 13%')).toBeNull();
  });
  it('shows a red Fails chip only on a hard-rule miss, and a funding chip when unfunded', () => {
    render(<CleanCspLine {...base} result={{ ...result, qualified: false, failReasons: ['Low IVR 22.0%'] }}
      c={{ ...c, cspFunding: { status: 'not_fundable', usableCash: 0 } }} />);
    expect(screen.getByTestId('clean-fails')).toHaveTextContent('Fails: Low IVR 22.0%');
    expect(screen.getByTestId('clean-unfunded')).toHaveTextContent('$0 available');
  });
});

describe('CleanCspDetails', () => {
  it('shows each fact once, the allocation breakdown, and the actions', () => {
    render(<CleanCspDetails result={result} c={c} th={th} bidAskMax={0.10} ivrMin={30} alloc={alloc} actions={<button>Research</button>} />);
    expect(screen.getByText('$0.07 / $0.15')).toBeInTheDocument();
    expect(screen.getByText('$89.89')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This trade adds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument();
    expect(screen.getAllByText(/^Breakeven$/i)).toHaveLength(1);
  });
});

describe('CspViewControls grouping checkbox', () => {
  it('is shown only when wired, and reports changes', () => {
    const onGroup = vi.fn();
    const view = cspViewFromPreset('balanced', 30, 45);
    const props = { view, th: { text: '', textMuted: '', textFaint: '', border: '', input: '', inputBorder: '', bg: '', card: '' } as any, onPreset: () => {}, onChange: () => {}, affordableOnly: false, setAffordableOnly: () => {} };
    const { rerender } = render(<CspViewControls {...props} />);
    expect(screen.queryByLabelText('Group by expiration')).toBeNull();
    rerender(<CspViewControls {...props} groupByExpiration={false} setGroupByExpiration={onGroup} />);
    fireEvent.click(screen.getByLabelText('Group by expiration'));
    expect(onGroup).toHaveBeenCalledWith(true);
  });
});
