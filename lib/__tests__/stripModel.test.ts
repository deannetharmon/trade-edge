// lib/__tests__/stripModel.test.ts

import { describe, expect, it } from 'vitest';
import type { ChainExpiration } from '../trademap/chain';
import { legSpecs } from '../trademap/strategies';
import {
  barRight, dragLeg, labelEvery, widthLabel, markersFor, MAX_WIDTH_STEPS, nearestMover, rightsFor, stepStrike, strikeAtX, strikeForDeltaBand, stripWindow,
} from '../trademap/stripModel';

function chain(lo: number, hi: number, step = 1): ChainExpiration {
  const strikes = [];
  for (let k = lo; k <= hi + 1e-9; k += step) strikes.push({ strike: k, call: `X  261218C${k}`, put: `X  261218P${k}` });
  return { date: '2026-12-18', dte: 31, strikes };
}
const c = chain(680, 780);
const SPOT = 732.44;

describe('OPTMAP-0001 S2i: strike strip model', () => {
  it('window covers the range around the stock and always includes the markers', () => {
    const ks = c.strikes.map(s => s.strike);
    const w = stripWindow(ks, SPOT, 0.06, []);
    expect(w[0]).toBeGreaterThanOrEqual(SPOT * 0.94);
    expect(w[w.length - 1]).toBeLessThanOrEqual(SPOT * 1.06);
    const widened = stripWindow(ks, SPOT, 0.06, [682]);
    expect(widened[0]).toBe(682);
    // widened evenly: the stock stays centered, so the far side reaches the same distance (here the chain ends at 780)
    expect(widened[widened.length - 1]).toBe(780);
    const wide2 = stripWindow(ks, SPOT, 0.01, [713]);
    expect(wide2[0]).toBe(713);
    expect(wide2[wide2.length - 1]).toBeGreaterThanOrEqual(SPOT + (SPOT - 713) - 1);
  });
  it('labels thin out as the chain gets denser', () => {
    expect(labelEvery(20)).toBe(1);
    expect(labelEvery(40)).toBe(2);
    expect(labelEvery(88)).toBe(5);
    expect(labelEvery(300)).toBe(10);
  });
  it('quotes the right side for each strategy', () => {
    expect(rightsFor('bps')).toEqual(['P']);
    expect(rightsFor('bcs')).toEqual(['C']);
    expect(rightsFor('ic')).toEqual(['P', 'C']);
    expect(barRight('ic', 700, SPOT)).toBe('P');
    expect(barRight('ic', 760, SPOT)).toBe('C');
    expect(barRight('bps', 760, SPOT)).toBe('P');
  });
  it('markers: the short leg is the anchor, the long leg is the width, the condor call side follows', () => {
    const bps = markersFor('bps', legSpecs('bps', c, 716, SPOT, 10)!);
    expect(bps.map(m => [m.strike, m.role])).toEqual([[716, 'anchor'], [706, 'width']]);
    const ic = markersFor('ic', legSpecs('ic', c, 716, SPOT, 5)!);
    expect(ic.map(m => m.role)).toEqual(['anchor', 'width', 'mirror', 'mirror']);
    expect(markersFor('csp', legSpecs('csp', c, 716, SPOT, 1)!)[0].role).toBe('anchor');
  });
  it('dragging the short put leaves the long put in place, so the spread widens or narrows', () => {
    const up = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'anchor', targetStrike: 721.4 })!;
    expect(up).toEqual({ anchor: 721, widthSteps: 15 }); // long stays 706
    const down = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'anchor', targetStrike: 710 })!;
    expect(down).toEqual({ anchor: 710, widthSteps: 4 });
  });
  it('sliding moves the whole spread and keeps the width', () => {
    const r = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'slide', targetStrike: 700 })!;
    expect(r).toEqual({ anchor: 700, widthSteps: 10 });
    const bcs = dragLeg({ strategy: 'bcs', chain: c, spot: SPOT, anchor: 750, widthSteps: 5, role: 'slide', targetStrike: 760 })!;
    expect(bcs).toEqual({ anchor: 760, widthSteps: 5 });
  });
  it('sliding is refused when the long leg would fall off the listed strikes', () => {
    expect(dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'slide', targetStrike: 681 })).toBeNull();
  });
  it('width label is in dollars', () => {
    expect(widthLabel(716, 706)).toBe('$10 wide');
    expect(widthLabel(750, 752.5)).toBe('$2.5 wide');
    expect(widthLabel(100, 100.25)).toBe('$0.25 wide');
  });
  it('the short leg stops one strike from the long leg', () => {
    const r = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'anchor', targetStrike: 690 })!;
    expect(r).toEqual({ anchor: 707, widthSteps: 1 });
  });
  it('bear call spread: dragging the short call leaves the long call in place', () => {
    const r = dragLeg({ strategy: 'bcs', chain: c, spot: SPOT, anchor: 750, widthSteps: 5, role: 'anchor', targetStrike: 747 })!;
    expect(r).toEqual({ anchor: 747, widthSteps: 8 }); // long stays 755
  });
  it('a cash-secured put has no width: the short leg just moves', () => {
    const r = dragLeg({ strategy: 'csp', chain: c, spot: SPOT, anchor: 716, widthSteps: 1, role: 'anchor', targetStrike: 710 })!;
    expect(r.anchor).toBe(710);
  });
  it('dragging the long put sets the width from the distance to the short put', () => {
    const r = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'width', targetStrike: 701 })!;
    expect(r).toEqual({ anchor: 716, widthSteps: 15 });
  });
  it('bear call spread widens upward', () => {
    const r = dragLeg({ strategy: 'bcs', chain: c, spot: SPOT, anchor: 750, widthSteps: 5, role: 'width', targetStrike: 762 })!;
    expect(r).toEqual({ anchor: 750, widthSteps: 12 });
  });
  it('the long leg cannot cross the short leg: width stays at least one step', () => {
    const r = dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'width', targetStrike: 730 })!;
    expect(r.widthSteps).toBe(1);
  });
  it('width is capped', () => {
    const wide = chain(300, 800);
    const r = dragLeg({ strategy: 'bps', chain: wide, spot: SPOT, anchor: 716, widthSteps: 5, role: 'width', targetStrike: 310 })!;
    expect(r.widthSteps).toBe(MAX_WIDTH_STEPS);
  });
  it('a target that is not a number is refused', () => {
    expect(dragLeg({ strategy: 'bps', chain: c, spot: SPOT, anchor: 716, widthSteps: 10, role: 'anchor', targetStrike: NaN })).toBeNull();
  });
  it('iron condor: moving the put anchor keeps the call side mirrored and valid', () => {
    const r = dragLeg({ strategy: 'ic', chain: c, spot: SPOT, anchor: 716, widthSteps: 5, role: 'anchor', targetStrike: 714 })!;
    expect(r).toEqual({ anchor: 714, widthSteps: 3 });
    expect(legSpecs('ic', c, r.anchor, SPOT, r.widthSteps)).not.toBeNull();
  });
  it('a click moves the nearest movable marker (the anchor on a tie); mirrored markers never move', () => {
    const m = markersFor('bps', legSpecs('bps', c, 716, SPOT, 10)!);
    expect(nearestMover(m, 707)!.role).toBe('width');
    expect(nearestMover(m, 720)!.role).toBe('anchor');
    expect(nearestMover(m, 711)!.role).toBe('anchor');
    const ic = markersFor('ic', legSpecs('ic', c, 716, SPOT, 5)!);
    expect(nearestMover(ic, 760)!.role).not.toBe('mirror');
  });
  it('keyboard steps stay inside the listed strikes', () => {
    const ks = [700, 701, 702];
    expect(stepStrike(ks, 701, 1)).toBe(702);
    expect(stepStrike(ks, 702, 1)).toBe(702);
    expect(stepStrike(ks, 700, -1)).toBe(700);
    expect(stepStrike(ks, 999, 1)).toBe(999);
  });
  it('pixel position maps to a strike', () => {
    const ks = [700, 701, 702, 703];
    expect(strikeAtX(ks, 0, 10)).toBe(700);
    expect(strikeAtX(ks, 25, 10)).toBe(702);
    expect(strikeAtX(ks, 999, 10)).toBe(703);
    expect(strikeAtX(ks, -5, 10)).toBe(700);
    expect(strikeAtX([], 5, 10)).toBeNull();
  });
  it('delta band picks the call strike nearest the middle of the band, above the stock only', () => {
    const deltas: Record<number, number> = { 730: 0.55, 740: 0.35, 750: 0.25, 760: 0.15, 770: 0.07 };
    const f = (k: number) => deltas[k] ?? null;
    const ks = [730, 740, 750, 760, 770];
    expect(strikeForDeltaBand(ks, f, 732, 0.10, 0.20)).toBe(760);
    expect(strikeForDeltaBand(ks, f, 732, 0.20, 0.35)).toBe(750);
    expect(strikeForDeltaBand(ks, f, 732, 0.30, 0.40)).toBe(740);
    expect(strikeForDeltaBand(ks, () => null, 732, 0.1, 0.2)).toBeNull();
  });
});
