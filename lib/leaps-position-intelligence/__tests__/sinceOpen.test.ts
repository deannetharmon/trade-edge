// lib/leaps-position-intelligence/__tests__/sinceOpen.test.ts
//
// LEAPS-SINCE-0001. Worked example: GOOGL 250C, opened 2026-08-14 at $113.55 with the stock at $336.66, delta 0.88, IVR 29;
// now stock $350.86, delta 0.85, IVR 20, mark $120.45.

import { describe, expect, it } from 'vitest';
import { buildSinceOpen, SINCE_OPEN_POLICY, type SinceOpenInput } from '../sinceOpen';

const input = (over: { now?: Partial<SinceOpenInput['now']>; entry?: Partial<SinceOpenInput['entry']> } = {}): SinceOpenInput => ({
  strike: 250,
  now: { stockPrice: 350.86, delta: 0.85, ivr: 20, markPerShare: 120.45, ...over.now },
  entry: { capturedAt: '2026-08-14T15:30:00.000Z', entryDate: '2026-08-14', stockPrice: 336.66, deltaPerShare: 0.88, ivr: 29, entryPricePerShare: 113.55, ...over.entry },
});
const tile = (s: ReturnType<typeof buildSinceOpen>, id: string) => s.tiles.find(t => t.id === id)!;

describe('the worked example (a true at-open baseline)', () => {
  const s = buildSinceOpen(input());

  it('is labelled "Since you opened" and has four tiles', () => {
    expect(s.basis).toBe('opened');
    expect(s.label).toBe('Since you opened');
    expect(s.tiles.map(t => [t.id, t.value, t.tone])).toEqual([['stock', '$350.86', 'good'], ['delta', '0.85', 'watch'], ['ivr', '20%', 'watch'], ['extrinsic', '$19.59', 'neutral']]);
  });

  it('shows the move and the starting point, coloured by what it means for a long call', () => {
    expect(tile(s, 'stock').parts.map(p => p.text)).toEqual(['▲ +$14.20 (+4.2%)', 'from $336.66']);
    expect(tile(s, 'delta').parts.map(p => p.text)).toEqual(['▼ 0.03', 'from 0.88']);
    expect(tile(s, 'ivr').parts.map(p => p.text)).toEqual(['▼ 9 pts', 'from 29%']);
  });

  it('extrinsic lost is entry extrinsic ($113.55 - $86.66) less now ($120.45 - $100.86), and neutral', () => {
    // entry: 113.55 - (336.66 - 250) = 26.89 ; now: 120.45 - (350.86 - 250) = 19.59 ; lost 7.30
    expect(tile(s, 'extrinsic').value).toBe('$19.59');
    expect(tile(s, 'extrinsic').parts.map(p => p.text)).toEqual(['▼ $7.30 lost', 'from $26.89']);
  });
});

describe('the honest label', () => {
  it('a baseline captured within a day of the open date counts as at-open (boundary: 1 day yes, 2 days no)', () => {
    expect(buildSinceOpen(input({ entry: { capturedAt: '2026-08-15T09:00:00.000Z' } })).basis).toBe('opened');
    expect(buildSinceOpen(input({ entry: { capturedAt: '2026-08-16T09:00:00.000Z' } })).basis).toBe('first-tracked');
  });

  it('a baseline captured long after the open says so, and drops extrinsic lost (the real-open values are unknown)', () => {
    const s = buildSinceOpen(input({ entry: { capturedAt: '2026-09-19T12:00:00.000Z' } }));
    expect(s.basis).toBe('first-tracked');
    expect(s.label).toBe('Since first tracked 2026-09-19');
    expect(s.tiles.map(t => t.id)).toEqual(['stock', 'delta', 'ivr']);
  });

  it('with no open date on record it is "first tracked"; with no baseline at all there is nothing to show', () => {
    expect(buildSinceOpen(input({ entry: { entryDate: null } })).basis).toBe('first-tracked');
    expect(buildSinceOpen(input({ entry: { capturedAt: null } }))).toEqual({ basis: 'none', label: '', tiles: [] });
    expect(buildSinceOpen(input({ entry: { capturedAt: 'garbage' } })).basis).toBe('none');
  });
});

describe('thresholds', () => {
  it('pins the policy', () => {
    expect(SINCE_OPEN_POLICY).toEqual({ flatStockPct: 0.05, flatDelta: 0.005, flatIvrPts: 0.5, atOpenMaxGapDays: 1 });
  });

  it.each([[336.8, true], [337.0, false]])('stock %s vs 336.66 -> unchanged: %s', (stock, isFlat) => {
    const t = tile(buildSinceOpen(input({ now: { stockPrice: stock } })), 'stock');
    expect(t.parts[0].text.startsWith('unchanged')).toBe(isFlat);
  });

  it.each([[0.8804, true], [0.87, false]])('delta %s vs 0.88 -> unchanged: %s', (delta, isFlat) => {
    expect(tile(buildSinceOpen(input({ now: { delta } })), 'delta').parts[0].text.startsWith('unchanged')).toBe(isFlat);
  });

  it.each([[29.3, true], [30, false]])('IVR %s vs 29 -> unchanged: %s', (ivr, isFlat) => {
    expect(tile(buildSinceOpen(input({ now: { ivr } })), 'ivr').parts[0].text.startsWith('unchanged')).toBe(isFlat);
  });
});

describe('colours mean something for a long call', () => {
  it('stock down and delta down are amber; delta up and IVR up are good; flat is neutral', () => {
    const down = buildSinceOpen(input({ now: { stockPrice: 320 } }));
    expect(tile(down, 'stock')).toMatchObject({ tone: 'watch' });
    expect(tile(down, 'stock').parts[0].text).toBe('▼ -$16.66 (-4.9%)');
    const up = buildSinceOpen(input({ now: { delta: 0.9, ivr: 40 } }));
    expect(tile(up, 'delta').tone).toBe('good');
    expect(tile(up, 'ivr').tone).toBe('good');
    expect(tile(buildSinceOpen(input({ now: { stockPrice: 336.66 } })), 'stock').tone).toBe('neutral');
  });

  it('extrinsic that grew is shown as gained, still neutral', () => {
    const s = buildSinceOpen(input({ now: { markPerShare: 140 } }));
    expect(tile(s, 'extrinsic').parts[0].text).toBe('▲ $12.25 gained');
    expect(tile(s, 'extrinsic').tone).toBe('neutral');
  });
});

describe('missing data leaves a tile out; nothing is estimated', () => {
  it('each missing input removes only its own tile', () => {
    expect(buildSinceOpen(input({ entry: { stockPrice: null } })).tiles.map(t => t.id)).toEqual(['delta', 'ivr']);
    expect(buildSinceOpen(input({ now: { delta: null } })).tiles.map(t => t.id)).toEqual(['stock', 'ivr', 'extrinsic']);
    expect(buildSinceOpen(input({ entry: { ivr: null } })).tiles.map(t => t.id)).toEqual(['stock', 'delta', 'extrinsic']);
    expect(buildSinceOpen(input({ entry: { entryPricePerShare: null } })).tiles.map(t => t.id)).toEqual(['stock', 'delta', 'ivr']);
  });

  it('an entry price that is inconsistent with the entry stock price (negative extrinsic) is not shown', () => {
    expect(buildSinceOpen(input({ entry: { entryPricePerShare: 60 } })).tiles.some(t => t.id === 'extrinsic')).toBe(false);
  });

  it('never mutates its input', () => {
    const i = input();
    const before = JSON.stringify(i);
    buildSinceOpen(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
