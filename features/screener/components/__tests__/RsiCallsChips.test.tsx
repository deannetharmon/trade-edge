import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RsiCallsChips, LiveRsiCallsChips } from '../RsiCallsChips';
import { DisqualifiedSection } from '../DisqualifiedSection';
import type { ScreenResult } from '@/lib/scans/types';

const live: Record<string, unknown> = {};
vi.mock('@/components/portfolio-data/useHoldingRsi', () => ({ useHoldingRsi: () => live }));

describe('RsiCallsChips', () => {
  it('shows RSI and Ready at or above the saved cutoff, Wait below it', () => {
    const { rerender } = render(<RsiCallsChips symbol="NFLX" rsi={54.4} />);
    expect(screen.getByTestId('rsi-calls-NFLX')).toHaveTextContent('RSI 54');
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
    rerender(<RsiCallsChips symbol="NFLX" rsi={40} />);
    expect(screen.getByText('Calls: Wait')).toBeInTheDocument();
  });
  it('shows a dash with no chip when RSI is unknown, and nothing while loading', () => {
    const { rerender, container } = render(<RsiCallsChips symbol="X" rsi={null} />);
    expect(screen.getByTestId('rsi-calls-X')).toHaveTextContent('RSI —');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
    rerender(<RsiCallsChips symbol="X" rsi={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('the live version reads the shared daily bars', () => {
    live.NFLX = { rsi: 61, previous: 58, direction: 'up', points: [] };
    render(<LiveRsiCallsChips symbol="nflx" />);
    expect(screen.getByTestId('rsi-calls-nflx')).toHaveTextContent('RSI 61');
  });
});

const dq = (over: Partial<ScreenResult> = {}): ScreenResult => ({
  symbol: 'METU', strategy: 'CC', price: 30, ivr: null, ivx: null, qualified: false, bestCandidate: null,
  failReasons: ['No qualifying call found in delta 0.2-0.35 / DTE 21-45 window. 7 calls: ...long diagnostic...'],
  checks: { oi: { status: 'fail', value: 'None', reason: 'No qualifying call found in delta 0.2-0.35 / DTE 21-45 window. 7 calls: ...long diagnostic...' } },
  ...over,
} as unknown as ScreenResult);

describe('disqualified covered-call row', () => {
  it('shows the one-line reason and the RSI meta, not the long sentence, and does not repeat it when expanded', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<DisqualifiedSection results={[dq({ ccBrief: 'No call in Δ0.20–0.35 · nearest Δ0.17 at $29' })]} hasQualifiedCandidates={false}
      renderRowMeta={r => <RsiCallsChips symbol={r.symbol} rsi={54} />} />);
    expect(screen.getByText('No call in Δ0.20–0.35 · nearest Δ0.17 at $29')).toBeInTheDocument();
    expect(screen.queryByText(/long diagnostic/)).not.toBeInTheDocument();
    expect(screen.getByTestId('rsi-calls-METU')).toHaveTextContent('RSI 54');
    await userEvent.click(screen.getByRole('button', { name: /Show checks for METU/ }));
    expect(screen.getAllByText(/No call in Δ0.20–0.35/)).toHaveLength(2);
    expect(screen.queryByText(/long diagnostic/)).not.toBeInTheDocument();
  });
  it('a row with no brief keeps its own reason text', () => {
    render(<DisqualifiedSection results={[dq({ strategy: 'CSP' as never, failReasons: ['IVR below minimum'] })]} hasQualifiedCandidates={false} />);
    expect(screen.getByText('IVR below minimum')).toBeInTheDocument();
  });
});
