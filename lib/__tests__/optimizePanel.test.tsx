// lib/__tests__/optimizePanel.test.tsx
//
// OPTMAP-0001 S5: the Optimize panel states what happened plainly and never shows a weaker pick when none qualifies.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OptimizePanel from '@/features/trade-map/OptimizePanel';
import type { SpreadCandidate } from '@/lib/scans/types';

const th = { card: '', border: '', text: '', textFaint: '' };
const cand = (short: number, long: number, credit: number, pop: number, roc: number): SpreadCandidate =>
  ({ strategy: 'BPS', expiration: '2026-12-18', dte: 31, shortStrike: short, longStrike: long, spreadWidth: Math.abs(short - long), credit, pop, roc } as unknown as SpreadCandidate);
const base = { th, widthDollars: 5, noQuotes: false, loadedShort: 45, loadedLong: 40, canUndo: true, onLoad: () => {}, onUndo: () => {}, onClose: () => {} };

describe('OptimizePanel', () => {
  it('shows the pick, tags the first row Best opportunity, and loads a clicked alternative', () => {
    const onLoad = vi.fn();
    const rows = [cand(45, 40, 1.45, 71, 41), cand(47, 37, 2.6, 68, 35)];
    render(<OptimizePanel {...base} pick={rows[0]} atEachWidth={rows} onLoad={onLoad} />);
    expect(screen.getByText('Screener pick at your $5 width')).toBeTruthy();
    expect(screen.getAllByText('Best opportunity')).toHaveLength(1);
    fireEvent.click(screen.getByText('47 / 37'));
    expect(onLoad).toHaveBeenCalledWith(rows[1]);
  });
  it('says nothing passes when there is no pick, and does not offer a weaker one as the pick', () => {
    render(<OptimizePanel {...base} pick={null} atEachWidth={[]} canUndo={false} />);
    expect(screen.getByText('Nothing passes your scan criteria at $5 wide')).toBeTruthy();
    expect(screen.getByText(/Your strikes were not changed/)).toBeTruthy();
    expect(screen.queryByText('Undo')).toBeNull();
  });
  it('explains missing quotes', () => {
    render(<OptimizePanel {...base} pick={null} atEachWidth={[]} noQuotes />);
    expect(screen.getByText('No usable quotes for these strikes yet')).toBeTruthy();
  });
  it('Undo and Close call their handlers', () => {
    const onUndo = vi.fn(); const onClose = vi.fn();
    render(<OptimizePanel {...base} pick={null} atEachWidth={[]} onUndo={onUndo} onClose={onClose} />);
    fireEvent.click(screen.getByText('Undo')); fireEvent.click(screen.getByText('Close'));
    expect(onUndo).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });
});
