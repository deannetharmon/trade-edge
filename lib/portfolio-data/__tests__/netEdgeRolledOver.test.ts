import { describe, expect, it } from 'vitest';
import { netEdgeRolledOver, netEdgeColor, netEdgeFrom } from '../acquisition';
import type { Position, PositionSnapshot } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────
// gamma: 0 zeroes out netEdgeFrom's gamma-cost term entirely, so
// netEdge = theta * 100 exactly -- lets tests pick round, predictable
// dollar values via theta alone rather than reverse-engineering the
// gamma/IV/stockPrice interaction.
function snapshot(date: string, theta: number, overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    date, dte: 21, currentValue: null, pnl: null, pnlPct: null,
    iv: 40, ivr: 30, theta, gamma: 0, netDelta: null, netVega: null,
    pop: null, buffer: null, stockPrice: 100,
    ...overrides,
  };
}

function position(snapshotHistory: PositionSnapshot[], liveTheta: number | null): Position {
  return {
    key: 'TEST::2026-12-18',
    theta: liveTheta,
    gamma: 0,
    iv: 40,
    stockPrice: 100,
    snapshotHistory,
  } as Position;
}

describe('netEdgeFrom sanity (gamma=0 fixture assumption)', () => {
  it('collapses to theta * 100 when gamma is 0', () => {
    expect(netEdgeFrom(1.0, 0, 40, 100)).toBe(100);
    expect(netEdgeFrom(0.8, 0, 40, 100)).toBe(80);
  });
});

// ── PW-0003: hysteresis ──────────────────────────────────────────────────
describe('netEdgeRolledOver: hysteresis', () => {
  it('does NOT trip on a single-day decline below the 15% trip line (the old bug)', () => {
    // Peak $100/d -> $90/d is a 10% decline -- below the 15% trip line.
    const pos = position([snapshot('2026-08-01', 1.00), snapshot('2026-08-02', 0.90)], 0.90);
    expect(netEdgeRolledOver(pos)).toBe(false);
  });

  it('trips once a decline reaches the 15% line', () => {
    // $100/d peak -> $80/d live = 20% decline, clears the 15% trip line.
    const pos = position([snapshot('2026-08-01', 1.00), snapshot('2026-08-02', 0.90)], 0.80);
    expect(netEdgeRolledOver(pos)).toBe(true);
  });

  it('stays rolled over (sticky) while recovery sits between the clear and trip lines', () => {
    // Trips at day 3 (20% decline), day 4 recovers only to 13% decline --
    // above the 8% clear line, below the 15% trip line -- must stay tripped.
    const pos = position([
      snapshot('2026-08-01', 1.00), // peak, $100/d
      snapshot('2026-08-02', 0.90), // 10% decline -- no trip yet
      snapshot('2026-08-03', 0.80), // 20% decline -- trips
    ], 0.87); // live: 13% decline -- between clear(8%) and trip(15%), stays tripped
    expect(netEdgeRolledOver(pos)).toBe(true);
  });

  it('clears once recovery reaches the 8% line, not merely back under 15%', () => {
    const pos = position([
      snapshot('2026-08-01', 1.00), // peak, $100/d
      snapshot('2026-08-02', 0.80), // 20% decline -- trips
      snapshot('2026-08-03', 0.87), // 13% decline -- still tripped (between the two lines)
    ], 0.93); // live: 7% decline -- at/below the 8% clear line -- clears
    expect(netEdgeRolledOver(pos)).toBe(false);
  });

  it('never trips on small oscillations that stay below 15%', () => {
    const pos = position([
      snapshot('2026-08-01', 1.00),
      snapshot('2026-08-02', 0.88), // 12%
      snapshot('2026-08-03', 0.94), // 6%
      snapshot('2026-08-04', 0.87), // 13%
    ], 0.90); // 10%
    expect(netEdgeRolledOver(pos)).toBe(false);
  });

  it('is a pure function of the running peak-to-date, not the eventual series-wide peak (no look-ahead)', () => {
    // Peak rises AFTER the dip -- the dip should be evaluated against the
    // smaller peak that existed at that point in time, not the later,
    // higher peak. A naive "final peak" implementation would treat day 2's
    // $85 as a decline from the eventual $120 peak (29%, would trip); the
    // correct running-peak walk evaluates it against $100 (15%, at the line
    // but not past it), so no trip should occur at day 2.
    const pos = position([
      snapshot('2026-08-01', 1.00), // running peak $100
      snapshot('2026-08-02', 0.85), // 15% decline vs $100 peak-to-date -- at the line, not past it
      snapshot('2026-08-03', 1.20), // new peak $120
    ], 1.15); // live: 4% off the new $120 peak
    expect(netEdgeRolledOver(pos)).toBe(false);
  });

  it('requires at least 2 total data points (history + live)', () => {
    const pos = position([], 1.00);
    expect(netEdgeRolledOver(pos)).toBe(false);
    const onePoint = position([snapshot('2026-08-01', 1.00)], null);
    expect(netEdgeRolledOver(onePoint)).toBe(false);
  });

  it('never trips when the running peak-to-date is at or below $0', () => {
    const pos = position([snapshot('2026-08-01', -0.50), snapshot('2026-08-02', -1.00)], -1.50);
    expect(netEdgeRolledOver(pos)).toBe(false);
  });
});

// ── PW-0003: shared trip threshold, and the documented divergence from color ─
describe('netEdgeColor and netEdgeRolledOver share the same 15% trip line', () => {
  it('netEdgeColor turns amber at the same 15% line netEdgeRolledOver trips on', () => {
    const pos = position([snapshot('2026-08-01', 1.00), snapshot('2026-08-02', 0.90)], 0.80); // 20% off peak
    expect(netEdgeColor(pos, 'fallback')).toBe('text-amber-400');
    expect(netEdgeRolledOver(pos)).toBe(true);
  });

  it('documents the intentional divergence: a sticky rolled-over alarm can coexist with a recovered (green) color, unlike the old any-decline bug which disagreed for no reason', () => {
    const pos = position([
      snapshot('2026-08-01', 1.00), // peak $100/d
      snapshot('2026-08-02', 0.80), // 20% decline -- trips
    ], 0.87); // live: 13% decline -- netEdgeColor is green (under 15%), but hysteresis keeps the alarm on (above 8% clear line)
    expect(netEdgeColor(pos, 'fallback')).toBe('text-emerald-400');
    expect(netEdgeRolledOver(pos)).toBe(true);
  });
});
