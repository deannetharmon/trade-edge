// lib/leaps-analysis/__tests__/dashboard.test.ts
//
// LEAPS-DASH-0001 -- the rule-computed dashboard. Thresholds are Ian's (LEAPS_DASHBOARD_POLICY); every boundary is
// pinned here so a change to a threshold is a deliberate, visible decision.

import { describe, expect, it } from 'vitest';
import { buildLeapsDashboard, LEAPS_DASHBOARD_POLICY, type DashboardSnapshot, type LeapsDashboardInput } from '../dashboard';

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  createdAt: '2026-09-20T07:54:58.000Z',
  contract: { delta: 0.8457, bid: 112.2, ask: 114.9, multiplier: 100, quoteBasis: 'live', optionQuoteTimestamp: '2026-09-19T09:46:19.000Z' },
  criteria: { deltaMin: 0.7, deltaMax: 0.85, dteMin: 270, dteMax: 730, oiMin: 100, extrinsicPctMax: 20, spreadPctMax: 10, source: 'scan_filters' },
  qualification: { status: 'CONTRACT_QUALIFIED', extrinsicPctOfCost: 11.18, spreadPct: 2.38, gates: [{ id: 'delta', status: 'pass', message: 'Delta must be 0.70–0.85' }] },
  mechanics: { extrinsicPerShare: 12.69, breakeven: 363.55, breakevenPctAboveSpot: 3.62 },
  ...over,
});
const input = (over: Partial<LeapsDashboardInput> = {}): LeapsDashboardInput => ({
  snapshot: snapshot(), current: true, ivRank: 20, ivx: 36.4,
  pmccStart: { status: 'above', startPrice: 349.38, pctToStart: null }, formatTimestamp: iso => `<${iso}>`, ...over,
});
const tile = (d: ReturnType<typeof buildLeapsDashboard>, id: string) => d.tiles.find(t => t.id === id)!;
const callout = (d: ReturnType<typeof buildLeapsDashboard>, id: string) => d.callouts.find(c => c.id === id);
const withQual = (over: Partial<DashboardSnapshot['qualification']>): DashboardSnapshot => snapshot({ qualification: { ...snapshot().qualification, ...over } });

describe('the GOOGL 250C example', () => {
  const d = buildLeapsDashboard(input());

  it('builds the six tiles with their values and tones', () => {
    expect(d.tiles.map(t => [t.id, t.value, t.tone])).toEqual([
      ['delta', '0.85', 'good'], ['extrinsic', '11.2%', 'good'], ['spread', '2.4%', 'good'],
      ['breakeven', '$363.55', 'watch'], ['pmcc-start', '$349.38', 'good'], ['ivr', '20%', 'watch'],
    ]);
    expect(tile(d, 'delta').parts[0].text).toBe('in your 0.70–0.85');
    expect(tile(d, 'extrinsic').parts[0].text).toBe('$12.69 · under your 20% cap');
    expect(tile(d, 'spread').parts[0].text).toBe('$270 / contract · under 10% limit');
    expect(tile(d, 'breakeven').parts[0].text).toBe('+3.6% above price');
    expect(tile(d, 'pmcc-start').parts[0].text).toBe('stock above · est.');
    expect(tile(d, 'ivr').parts.map(p => p.text)).toEqual(['cheap to buy', 'thin to sell']);
  });

  it('builds the callouts, watch items before good ones', () => {
    expect(d.callouts.map(c => [c.id, c.tone])).toEqual([['breakeven', 'watch'], ['ivr', 'watch'], ['extrinsic', 'good'], ['pmcc-start', 'good']]);
    expect(callout(d, 'breakeven')!.text).toBe('Stock needs to rise 3.6% to break even at expiration.');
    expect(callout(d, 'ivr')!.text).toBe('IVR 20%: cheap to buy, but thin premium to sell calls against it.');
  });

  it('builds the chips and the rule line', () => {
    expect(d.chips.map(c => [c.text, c.tone])).toEqual([['CONTRACT QUALIFIED', 'good'], ['Snapshot <2026-09-20T07:54:58.000Z>', 'neutral']]);
    expect(d.ruleLine).toBe('Judged against your scan filters: Δ 0.70–0.85 · DTE 270–730 · OI ≥ 100 · Extrinsic ≤ 20%');
  });
});

describe('thresholds (Ian)', () => {
  it('pins the policy values', () => {
    expect(LEAPS_DASHBOARD_POLICY).toEqual({ mostlyIntrinsicMaxExtrinsicPct: 15, ivrLow: 30, ivrHigh: 50, spreadWatchPct: 5 });
  });

  it.each([[15, 'good'], [15.01, 'watch']])('extrinsic %s%% of cost is a %s callout', (extrinsic, tone) => {
    const d = buildLeapsDashboard(input({ snapshot: withQual({ extrinsicPctOfCost: extrinsic }) }));
    expect(callout(d, 'extrinsic')!.tone).toBe(tone);
  });

  it.each([[29.9, 'low'], [30, null], [49.9, null], [50, 'high']])('IVR %s gives the %s callout', (ivRank, kind) => {
    const d = buildLeapsDashboard(input({ ivRank }));
    const c = callout(d, 'ivr');
    if (kind === 'low') expect(c!.text).toContain('cheap to buy');
    else if (kind === 'high') expect(c!.text).toContain('expensive to buy');
    else expect(c).toBeUndefined();
  });

  it.each([[5, false], [5.1, true]])('spread %s%% %s a spread callout', (spreadPct, shown) => {
    const d = buildLeapsDashboard(input({ snapshot: withQual({ spreadPct }) }));
    expect(Boolean(callout(d, 'spread'))).toBe(shown);
    if (shown) expect(callout(d, 'spread')!.text).toBe('Spread is 5.1%: about $270 per contract to cross.');
  });

  it('a spread over the scan limit is a red tile and is not repeated as a callout', () => {
    const d = buildLeapsDashboard(input({ snapshot: withQual({ spreadPct: 12 }) }));
    expect(tile(d, 'spread').tone).toBe('bad');
    expect(tile(d, 'spread').parts[0].text).toBe('$270 / contract · over 10% limit');
    expect(callout(d, 'spread')).toBeUndefined();
  });
});

describe('failures, gaps and modes', () => {
  it('a delta outside the filters is a red tile and the failed gate leads the callouts', () => {
    const snap = snapshot({ contract: { ...snapshot().contract, delta: 0.66 }, qualification: { ...snapshot().qualification, status: 'NOT_QUALIFIED', gates: [{ id: 'delta', status: 'fail', message: 'Delta must be 0.70–0.85' }] } });
    const d = buildLeapsDashboard(input({ snapshot: snap }));
    expect(tile(d, 'delta')).toMatchObject({ tone: 'bad', value: '0.66' });
    expect(tile(d, 'delta').parts[0].text).toBe('outside your 0.70–0.85');
    expect(d.callouts[0]).toEqual({ id: 'gate-delta', tone: 'bad', text: 'Delta must be 0.70–0.85' });
    expect(d.chips[0]).toEqual({ id: 'status', text: 'NOT QUALIFIED', tone: 'bad' });
  });

  it('an unavailable gate is a watch callout showing its own message', () => {
    const snap = withQual({ status: 'DATA_UNAVAILABLE', gates: [{ id: 'freshness', status: 'unavailable', message: 'Quotes are more than 5 days old' }] });
    const d = buildLeapsDashboard(input({ snapshot: snap }));
    expect(callout(d, 'gate-freshness')).toEqual({ id: 'gate-freshness', tone: 'watch', text: 'Quotes are more than 5 days old' });
    expect(d.chips[0].tone).toBe('watch');
  });

  it('discovery mode (no extrinsic ceiling) is labelled and the cap tile says so', () => {
    const snap = snapshot({ criteria: { ...snapshot().criteria!, extrinsicPctMax: null }, qualification: { ...snapshot().qualification, status: 'REVIEW_REQUIRED', gates: [{ id: 'extrinsicPct', status: 'not_applied', message: 'Extrinsic ceiling is in discovery mode (not applied)' }] } });
    const d = buildLeapsDashboard(input({ snapshot: snap }));
    expect(callout(d, 'discovery')!.text).toContain('Extrinsic ceiling not set');
    expect(callout(d, 'gate-extrinsicPct')).toBeUndefined();
    expect(tile(d, 'extrinsic').parts[0].text).toBe('$12.69 · no cap set');
    expect(d.ruleLine).toContain('no extrinsic ceiling set');
  });

  it('prior-session quotes are a chip and a callout with the quote time', () => {
    const d = buildLeapsDashboard(input({ snapshot: snapshot({ contract: { ...snapshot().contract, quoteBasis: 'last_session' } }) }));
    expect(d.chips.map(c => c.id)).toContain('prior-session');
    expect(callout(d, 'prior-session')!.text).toBe('Quotes are from the prior session (option quote <2026-09-19T09:46:19.000Z>). Re-check pricing after the market opens.');
  });

  it('a stock below its PMCC start price, and one with no IVx, read honestly', () => {
    const below = buildLeapsDashboard(input({ pmccStart: { status: 'below', startPrice: 362.1, pctToStart: 3.2 } }));
    expect(tile(below, 'pmcc-start')).toMatchObject({ value: '$362.10', tone: 'watch' });
    expect(callout(below, 'pmcc-start')!.text).toBe('Stock is 3.2% below its PMCC start price (estimate).');
    const none = buildLeapsDashboard(input({ pmccStart: { status: 'unavailable', startPrice: null, pctToStart: null }, ivRank: null, ivx: null }));
    expect(tile(none, 'pmcc-start')).toMatchObject({ value: '—', tone: 'neutral' });
    expect(tile(none, 'ivr')).toMatchObject({ value: '—', tone: 'neutral' });
    expect(callout(none, 'pmcc-start')).toBeUndefined();
    expect(callout(none, 'ivr')).toBeUndefined();
  });

  it('a breakeven already below the price is good news, not a warning', () => {
    const d = buildLeapsDashboard(input({ snapshot: snapshot({ mechanics: { extrinsicPerShare: 5, breakeven: 340, breakevenPctAboveSpot: -2.5 } }) }));
    expect(tile(d, 'breakeven')).toMatchObject({ tone: 'good' });
    expect(tile(d, 'breakeven').parts[0].text).toBe('2.5% below price');
    expect(callout(d, 'breakeven')).toMatchObject({ tone: 'good', text: 'Stock is already 2.5% above breakeven at expiration.' });
  });

  it('an older snapshot is flagged, and a snapshot without criteria has no rule line or delta note', () => {
    const d = buildLeapsDashboard(input({ current: false, snapshot: snapshot({ criteria: null }) }));
    expect(d.chips[1]).toEqual({ id: 'snapshot', text: 'Older saved snapshot', tone: 'watch' });
    expect(d.ruleLine).toBe('');
    expect(tile(d, 'delta')).toMatchObject({ tone: 'neutral', parts: [] });
  });

  it('never mutates its input', () => {
    const i = input();
    const before = JSON.stringify(i);
    buildLeapsDashboard(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
