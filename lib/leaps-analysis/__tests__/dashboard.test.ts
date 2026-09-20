// lib/leaps-analysis/__tests__/dashboard.test.ts
//
// LEAPS-DASH-0001 -- the rule-computed dashboard. Thresholds are Ian's (LEAPS_DASHBOARD_POLICY); every boundary is
// pinned here so a change to a threshold is a deliberate, visible decision.

import { describe, expect, it } from 'vitest';
import { buildConcentrationCallout, buildLeapsDashboard, buildLeapsPickSummary, LEAPS_DASHBOARD_POLICY, sortPicksByScore, type DashboardSnapshot, type LeapsDashboardInput, type LeapsPickCandidate } from '../dashboard';

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
    expect(LEAPS_DASHBOARD_POLICY).toEqual({ mostlyIntrinsicMaxExtrinsicPct: 15, ivrLow: 30, ivrHigh: 50, spreadWatchPct: 5, highDeltaMin: 0.8 });
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

// ---- LEAPS-DASH-0003: advisor pick cards ---------------------------------------------------------------------
const pickCandidate = (over: Partial<LeapsPickCandidate> = {}): LeapsPickCandidate => ({
  strike: 250, dte: 270, delta: 0.8457, underlyingPrice: 350.858, extrinsicValue: 12.692, bid: 112.2, ask: 114.9, score: 73, spreadPct: 2.38, ivx: 36.4, ivRank: 20, ...over,
});
const summary = (over: Partial<LeapsPickCandidate> = {}, pmccShortDeltaMax = 0.35, pmccShortDteMin = 21) => buildLeapsPickSummary({ candidate: pickCandidate(over), pmccShortDeltaMax, pmccShortDteMin });
const pickTile = (s: ReturnType<typeof summary>, id: string) => s.tiles.find(t => t.id === id)!;
const pickCallout = (s: ReturnType<typeof summary>, id: string) => s.callouts.find(c => c.id === id);

describe('buildLeapsPickSummary (advisor cards)', () => {
  it('the GOOGL example: five tiles and rule-based callouts, good news last', () => {
    const s = summary();
    expect(s.tiles.map(t => [t.id, t.value, t.tone])).toEqual([
      ['delta', '0.85', 'neutral'], ['dte', '270', 'neutral'], ['extrinsic', '11%', 'good'], ['spread', '2.4%', 'neutral'], ['pmcc-start', 'now', 'good'],
    ]);
    expect(s.callouts.map(c => [c.id, c.tone])).toEqual([['delta', 'good'], ['extrinsic', 'good'], ['pmcc-start', 'good']]);
    expect(pickCallout(s, 'delta')!.text).toBe('High delta: moves closely with the stock.');
    expect(pickCallout(s, 'extrinsic')!.text).toBe('Low extrinsic: little time value at risk.');
  });

  it.each([[0.79, false], [0.8, true]])('delta %s high-delta callout: %s', (delta, shown) => {
    expect(Boolean(pickCallout(summary({ delta }), 'delta'))).toBe(shown);
  });

  it('extrinsic uses the same boundary as the analysis dashboard (15% of cost)', () => {
    // mid = 113.55; 15% of mid = 17.0325
    expect(pickCallout(summary({ extrinsicValue: 17.0325 }), 'extrinsic')!.tone).toBe('good');
    expect(pickCallout(summary({ extrinsicValue: 17.1 }), 'extrinsic')!.tone).toBe('watch');
  });

  it('a wide spread is amber with dollars to cross; a normal spread has no callout', () => {
    const wide = summary({ spreadPct: 6.2, bid: 100, ask: 106 });
    expect(pickTile(wide, 'spread')).toMatchObject({ value: '6.2%', tone: 'watch' });
    expect(pickCallout(wide, 'spread')!.text).toBe('Spread is 6.2%: about $600 per contract to cross.');
    expect(pickCallout(summary(), 'spread')).toBeUndefined();
  });

  it('spread falls back to the bid/ask when the candidate has no spread figure', () => {
    expect(pickTile(summary({ spreadPct: undefined }), 'spread').value).toBe('2.4%');
  });

  it('PMCC start: above says now; below shows the rise needed; no IVx shows a dash and no callout', () => {
    const below = summary({ underlyingPrice: 340 });
    expect(pickTile(below, 'pmcc-start')).toMatchObject({ tone: 'watch', value: '+2.8%' });
    expect(pickCallout(below, 'pmcc-start')!.text).toBe('Stock is 2.8% below its PMCC start price (estimate).');
    const none = summary({ ivx: null });
    expect(pickTile(none, 'pmcc-start')).toMatchObject({ tone: 'neutral', value: '—' });
    expect(pickCallout(none, 'pmcc-start')).toBeUndefined();
  });

  it('uses the trader\'s own PMCC short-call settings', () => {
    const conservative = summary({ underlyingPrice: 347 }, 0.35, 21);   // start price ~349.38 -> below
    const relaxed = summary({ underlyingPrice: 347 }, 0.20, 45);        // start price ~322 -> above
    expect(pickTile(conservative, 'pmcc-start').tone).toBe('watch');
    expect(pickTile(relaxed, 'pmcc-start').tone).toBe('good');
  });

  it('missing quote data gives dashes, not guesses', () => {
    const s = summary({ bid: null, ask: null, extrinsicValue: null, spreadPct: null, delta: null });
    expect(s.tiles.map(t => t.value)).toEqual(['—', '270', '—', '—', '—']);
    expect(s.callouts).toEqual([]);
  });
});

describe('advisor ordering and concentration', () => {
  it('sorts picks by score, highest first, unscored last, ties keep the advisor order', () => {
    const picks = [{ n: 'a', score: 47 }, { n: 'b', score: null }, { n: 'c', score: 52 }, { n: 'd', score: 47 }];
    expect(sortPicksByScore(picks).map(p => p.n)).toEqual(['c', 'a', 'd', 'b']);
    expect(picks.map(p => p.n)).toEqual(['a', 'b', 'c', 'd']); // input not mutated
  });

  it.each([
    [['NFLX', 'UBER'], 'Both picks are in two companies: results will track NFLX and UBER closely.'],
    [['NFLX', 'UBER', 'NFLX'], '3 picks in two companies: results will track NFLX and UBER closely.'],
    [['NFLX', 'NFLX'], '2 picks in one company (NFLX): results will move together.'],
  ])('%j -> concentration callout', (symbols, text) => {
    expect(buildConcentrationCallout(symbols)).toEqual({ id: 'concentration', tone: 'watch', text });
  });

  it('three or more companies, or a single pick, is not flagged', () => {
    expect(buildConcentrationCallout(['A', 'B', 'C'])).toBeNull();
    expect(buildConcentrationCallout(['A'])).toBeNull();
    expect(buildConcentrationCallout([])).toBeNull();
  });
});
