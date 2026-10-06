// lib/discovery/leaps/__tests__/orchestrate.test.ts

// LEAPS-QV-0001 Gate 4c -- the Gate 3 -> Gate 4 handoff (acceptance test 8): non-SETUP/ACTIONABLE underlyings make
// zero provider calls; the Gate 3 evaluation is passed through unchanged; time is read before and after I/O; one
// underlying's failure never affects another; and Find LEAPS never imports Gate 4 (Section 12 one-way guard).

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import type { StrategyEvaluation } from '../../evaluation';
import { deepFreeze } from '../../util';
import type { ProviderGet } from '../acquisition';
import { QV_LEAPS_ACQUISITION_V1 } from '../acquisitionPolicy';
import { runQvLeaps } from '../orchestrate';

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', 'uber-regular-hours-2026-10-05.json'), 'utf8'));

function gate3(symbol: string, state: string): StrategyEvaluation {
  return deepFreeze({ symbol, evaluatedAt: '2026-10-05T16:00:00.000Z', outcome: { kind: 'CLASSIFIED', state }, gateOutcomes: [], reasonCodes: [], riskFlags: [], rankings: {} }) as unknown as StrategyEvaluation;
}

function uberProvider(fail: Record<string, number> = {}) {
  const log: string[] = [];
  const get: ProviderGet = async (path) => {
    log.push(path);
    for (const sym of Object.keys(fail)) if (path.indexOf(`equity=${sym}`) >= 0 || path.indexOf(`/option-chains/${sym}/`) >= 0) return { status: fail[sym], body: null };
    const p = path.replace(/equity=[A-Z]+/, 'equity=UBER').replace(/option-chains\/[A-Z]+\//, 'option-chains/UBER/');
    if (p.indexOf('equity=UBER') >= 0) return { status: 200, body: FIXTURE.underlyingQuote };
    if (p.indexOf('/option-chains/') === 0) return { status: 200, body: FIXTURE.nestedChain };
    const asked = p.split('&').map((x) => decodeURIComponent(x.split('=')[1]));
    return { status: 200, body: { data: { items: FIXTURE.optionQuoteRows.filter((r: { symbol: string }) => asked.indexOf(r.symbol) >= 0) } } };
  };
  return { get, log };
}

/** Backoffs resolve at once; the per-underlying timeout never fires. */
const sleep = (ms: number) => (ms === QV_LEAPS_ACQUISITION_V1.perUnderlyingTimeoutMs ? new Promise<void>(() => undefined) : Promise.resolve());

const clock = (times: string[]) => {
  const calls: string[] = [];
  return { now: () => { const t = times[Math.min(calls.length, times.length - 1)]; calls.push(t); return t; }, calls };
};

describe('Gate 4c: runQvLeaps', () => {
  it('only SETUP / ACTIONABLE underlyings are acquired; others make zero provider calls and are NOT_EVALUATED', async () => {
    const { get, log } = uberProvider();
    const pairs = [{ symbol: 'UBER', evaluation: gate3('UBER', 'ACTIONABLE') }, { symbol: 'WAT', evaluation: gate3('WAT', 'WATCH') }];
    const run = await runQvLeaps(pairs, { get, sleep, now: clock([FIXTURE.nowIso]).now });
    expect(log.some((p) => p.indexOf('WAT') >= 0)).toBe(false);
    expect(run.results.map((r) => [r.leaps.symbol, r.leaps.contractStatus])).toEqual([['UBER', 'EVALUATED'], ['WAT', 'NOT_EVALUATED']]);
    expect(run.results[1].leaps.reasons[0].code).toBe('LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED');
  });

  it('passes each Gate 3 evaluation through unchanged (same object, deep-equal)', async () => {
    const evaluation = gate3('UBER', 'SETUP');
    const before = JSON.stringify(evaluation);
    const run = await runQvLeaps([{ symbol: 'UBER', evaluation }], { get: uberProvider().get, sleep, now: clock([FIXTURE.nowIso]).now });
    expect(run.results[0].underlying).toBe(evaluation);
    expect(run.results[0].leaps.contractStatus).toBe('EVALUATED');
    expect(JSON.stringify(run.results[0].underlying)).toBe(before);
  });

  it('reads the clock before acquisition and again after all I/O; the evaluation uses the later reading', async () => {
    const c = clock([FIXTURE.nowIso, '2026-10-05T16:49:30.000Z']);
    const run = await runQvLeaps([{ symbol: 'UBER', evaluation: gate3('UBER', 'SETUP') }], { get: uberProvider().get, sleep, now: c.now });
    expect(c.calls).toHaveLength(2);
    expect(run.evaluatedAt).toBe('2026-10-05T16:49:30.000Z');
  });

  it('a failure for one underlying never affects another', async () => {
    const { get } = uberProvider({ BAD: 500 });
    const pairs = [{ symbol: 'BAD', evaluation: gate3('BAD', 'SETUP') }, { symbol: 'UBER', evaluation: gate3('UBER', 'SETUP') }];
    const run = await runQvLeaps(pairs, { get, sleep, now: clock([FIXTURE.nowIso]).now });
    expect(run.results[0].leaps.contractStatus).toBe('DATA_UNAVAILABLE');
    expect(run.results[1].leaps.contractStatus).toBe('EVALUATED');
  });

  it('insufficient-data underlyings are not evaluated', async () => {
    const evaluation = deepFreeze({ ...gate3('X', 'SETUP'), outcome: { kind: 'INSUFFICIENT_DATA', missingMetricIds: ['m'] } }) as unknown as StrategyEvaluation;
    const { get, log } = uberProvider();
    const run = await runQvLeaps([{ symbol: 'X', evaluation }], { get, sleep, now: clock([FIXTURE.nowIso]).now });
    expect(log).toHaveLength(0);
    expect(run.results[0].leaps.contractStatus).toBe('NOT_EVALUATED');
  });
});

describe('Section 12 one-way guard: Find LEAPS never imports Gate 4', () => {
  const ROOT = resolve(__dirname, '..', '..', '..', '..');
  const FIND_LEAPS = [
    'app/screener/page.tsx', 'lib/scans/pmccChainClient.ts', 'lib/scans/pmccChainAdapter.ts', 'lib/scans/leapsScore.ts',
    'lib/scans/leapsEntryQualification.ts', 'lib/scans/tastytrade-client.ts',
    ...readdirSync(join(ROOT, 'lib', 'leaps-analysis')).filter((f) => /\.tsx?$/.test(f)).map((f) => `lib/leaps-analysis/${f}`),
  ];
  it.each(FIND_LEAPS)('%s imports neither lib/discovery/leaps nor the QV LEAPS transport', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).not.toMatch(/lib\/discovery/);
    expect(src).not.toMatch(/leapsQvTransport/);
    expect(src).not.toMatch(/qvUniverseTransport/);
  });
});
