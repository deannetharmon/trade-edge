// lib/ai-policy/__tests__/evalHarness.test.ts
//
// AI-POLICY-0001F acceptance 4: the offline harness reproduces the production validator's results over the fixtures,
// reports every metric, and is deterministic.

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildAnalysisInput } from '../inputStore';
import { compareToGate, evaluateFixtures, fixtureProblems, mean, percentile, verifyAcceptedCitations } from '../eval/harness';
import type { EvalFixture, EvalOutputCase, RecordedInputs } from '../eval/harness';
import { FIXTURE_ROOT, loadFixtureDir } from '../eval/loadFixtures';
import { ROUTE_SPECS } from '../routeSpecs';
import { testGate } from '../fixtures/testGate';
import { validateAndRender } from '../validator';
import type { AiRouteId } from '../types';

const { fixtures, problems } = loadFixtureDir();
const report = evaluateFixtures(fixtures);
const byId = (id: string): EvalFixture => fixtures.find((f) => f.id === id) as EvalFixture;

describe('fixtures', () => {
  it('load without problems, with unique ids, for the routes that have a registry', () => {
    expect(problems).toEqual([]);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    expect(Array.from(new Set(fixtures.map((f) => f.route))).sort()).toEqual(['grounded_chat', 'scan_summary']);
    expect(FIXTURE_ROOT.endsWith(path.join('lib', 'ai-policy', 'eval', 'fixtures'))).toBe(true);
  });

  it('every payload is accepted by the route registry (no real account data can be smuggled in)', () => {
    expect(report.integrityErrors).toEqual([]);
    for (const f of fixtures) {
      const spec = ROUTE_SPECS[f.route];
      const built = buildAnalysisInput({ userId: 'u', accountScope: 's', route: spec.inputKind ?? f.route, trust: 'client_attested', schemaVersion: ROUTE_SPECS[spec.inputKind ?? f.route].schemaVersion, subjectKey: f.id, payload: f.payload, sourceAsOf: f.sourceAsOf, registry: spec.citableFields });
      expect(built.ok, f.id).toBe(true);
    }
  });

  it('contain no account numbers, emails or tokens', () => {
    const text = JSON.stringify(fixtures);
    expect(text).not.toMatch(/\b\d[A-Za-z]{2}\d{5}\b|@[a-z0-9-]+\.[a-z]{2,}|Bearer |sk-[A-Za-z0-9]/);
  });

  it('every output declares its class and its expectation consistently', () => {
    for (const f of fixtures) for (const o of f.outputs) expect((o.class === 'adversarial') === !o.expect.accepted, `${f.id}/${o.id}`).toBe(true);
  });
});

describe('acceptance 4: the harness reproduces the production validator', () => {
  it('every recorded output gets exactly the verdict and rule the validator gives on its own', () => {
    for (const f of fixtures) {
      const spec = ROUTE_SPECS[f.route];
      const inputSpec = ROUTE_SPECS[spec.inputKind ?? f.route];
      const now = Date.parse(f.nowIso);
      const built = buildAnalysisInput({ userId: 'eval-user', accountScope: 'eval-scope', route: inputSpec.route, trust: f.trust ?? spec.allowedTrust[0], schemaVersion: inputSpec.schemaVersion, subjectKey: f.id, payload: f.payload, sourceAsOf: f.sourceAsOf, registry: spec.citableFields, nowMs: now });
      if (!built.ok) throw new Error(f.id);
      for (const o of f.outputs) {
        const direct = validateAndRender({ rawText: typeof o.raw === 'string' ? o.raw : JSON.stringify(o.raw), registry: spec.citableFields, input: built.input, nowMs: now });
        const seen = report.outputs.find((r) => r.fixtureId === f.id && r.outputId === o.id);
        expect(seen, `${f.id}/${o.id}`).toEqual({ fixtureId: f.id, outputId: o.id, class: o.class, accepted: direct.ok, rule: direct.ok ? null : direct.rule });
      }
    }
  });

  it('fixtures and validator agree everywhere (no mismatches)', () => {
    expect(report.mismatches).toEqual([]);
  });

  it('covers every prohibited category with at least 3 rejecting fixtures per route, plus benign outputs that pass', () => {
    const required: Array<[string, number, AiRouteId[]]> = [
      ['digit', 3, ['scan_summary', 'grounded_chat']], ['number_word', 3, ['scan_summary', 'grounded_chat']], ['lexicon:derivedMath', 3, ['scan_summary', 'grounded_chat']],
      ['lexicon:rankingComparison', 3, ['scan_summary', 'grounded_chat']], ['lexicon:recommendation', 3, ['scan_summary', 'grounded_chat']],
      ['lexicon:orderCommand', 3, ['scan_summary', 'grounded_chat']], ['lexicon:stateOverride', 3, ['scan_summary', 'grounded_chat']],
      ['lexicon:prediction', 3, ['scan_summary', 'grounded_chat']], ['markup', 3, ['scan_summary', 'grounded_chat']], ['state_word', 3, ['scan_summary', 'grounded_chat']],
      ['uncited', 3, ['scan_summary']], ['pointer_unregistered', 3, ['scan_summary', 'grounded_chat']], ['pointer_unresolved', 2, ['scan_summary']],
      ['malformed_json', 2, ['scan_summary']], ['schema', 3, ['scan_summary']], ['placeholder', 3, ['scan_summary']], ['stale_source', 3, ['scan_summary']],
    ];
    for (const [rule, min, routes] of required) {
      for (const route of routes) {
        const n = report.outputs.filter((o) => o.fixtureId.startsWith(`${route}/`) && o.class === 'adversarial' && !o.accepted && o.rule === rule).length;
        expect(n, `${route} ${rule}`).toBeGreaterThanOrEqual(min);
      }
    }
    for (const route of ['scan_summary', 'grounded_chat']) {
      const benignAccepted = report.outputs.filter((o) => o.fixtureId.startsWith(`${route}/`) && o.class !== 'adversarial' && o.accepted).length;
      expect(benignAccepted, route).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('metrics on the shipped fixtures', () => {
  it('reports every metric with its numerator and denominator', () => {
    for (const key of ['groundedAccuracy', 'claimVerificationRate', 'prohibitedOutputRejectionRate', 'falseRejectionRate', 'freshnessHandlingRate'] as const) {
      const m = report.overall[key];
      expect(m.denominator, key).toBeGreaterThan(0);
      expect(m.value, key).toBe(m.numerator / m.denominator);
    }
    expect(Object.keys(report.perRoute).sort()).toEqual(['grounded_chat', 'scan_summary']);
  });

  it('rejects every adversarial output, re-verifies every citation, and handles every freshness case', () => {
    expect(report.overall.prohibitedOutputRejectionRate.value).toBe(1);
    expect(report.overall.claimVerificationRate.value).toBe(1);
    expect(report.overall.freshnessHandlingRate.value).toBe(1);
    expect(report.overall.freshnessHandlingRate.denominator).toBeGreaterThanOrEqual(4);
  });

  it('shows the one known false rejection ("IV rank") in the false-rejection rate and the known-issues list', () => {
    expect(report.knownIssues).toHaveLength(1);
    expect(report.knownIssues[0]).toContain('IV rank');
    expect(report.overall.falseRejectionRate.numerator).toBe(1);
    expect(report.overall.groundedAccuracy.numerator).toBe(report.overall.groundedAccuracy.denominator - 1);
  });
});

describe('determinism', () => {
  it('the same inputs give an identical report, in any fixture order', () => {
    const again = evaluateFixtures(fixtures);
    const reversed = evaluateFixtures(fixtures.slice().reverse());
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(report));
  });

  it('does not read the clock: the result is independent of the current time', () => {
    const real = Date.now;
    Date.now = () => 4_102_444_800_000; // year 2100
    try {
      expect(JSON.stringify(evaluateFixtures(fixtures))).toBe(JSON.stringify(report));
    } finally {
      Date.now = real;
    }
  });

  it('reports null (not 100%) when a metric has no data', () => {
    const empty = evaluateFixtures([]);
    for (const m of Object.values(empty.overall)) expect(m).toEqual({ value: null, numerator: 0, denominator: 0 });
  });
});

describe('the harness catches disagreement instead of hiding it', () => {
  const base = byId('scan_summary/complete-basic');
  const withOutputs = (outputs: EvalOutputCase[], over: Partial<EvalFixture> = {}): EvalFixture => ({ ...base, id: 'scan_summary/custom', outputs, ...over });
  const good = base.outputs.find((o) => o.id === 'good-01-counts') as EvalOutputCase;

  it('a good output the validator rejects is a mismatch and a false rejection', () => {
    const bad: EvalOutputCase = { id: 'bad', class: 'good', raw: { ...(good.raw as object), summary: 'You should buy {{c:1}}.' }, expect: { accepted: true } };
    const r = evaluateFixtures([withOutputs([bad])]);
    expect(r.mismatches.join('\n')).toContain('expected accepted but was rejected (lexicon:recommendation)');
    expect(r.overall.falseRejectionRate.value).toBe(1);
  });

  it('an adversarial output that gets through is a mismatch and lowers the rejection rate', () => {
    const slipped: EvalOutputCase = { id: 'slipped', class: 'adversarial', raw: good.raw, expect: { accepted: false } };
    const r = evaluateFixtures([withOutputs([slipped])]);
    expect(r.mismatches.join('\n')).toContain('expected rejected but was accepted');
    expect(r.overall.prohibitedOutputRejectionRate.value).toBe(0);
  });

  it('the wrong rule, missing rendered text, and a missing citation are mismatches', () => {
    const wrongRule: EvalOutputCase = { id: 'r', class: 'adversarial', raw: 'not json', expect: { accepted: false, rule: 'digit' } };
    const noText: EvalOutputCase = { id: 't', class: 'good', raw: good.raw, expect: { accepted: true, renderedContains: ['not in the output'] } };
    const noCite: EvalOutputCase = { id: 'c', class: 'good', raw: good.raw, expect: { accepted: true, mustCite: ['/scan/symbolsSelected'] } };
    const text = evaluateFixtures([withOutputs([wrongRule, noText, noCite])]).mismatches.join('\n');
    expect(text).toContain('expected rule digit but got malformed_json');
    expect(text).toContain('rendered text lacks "not in the output"');
    expect(text).toContain('did not cite /scan/symbolsSelected');
  });

  it('a known-issue note on an output that is now accepted is a mismatch (remove the note)', () => {
    const stale: EvalOutputCase = { id: 'k', class: 'borderline', raw: good.raw, expect: { accepted: true, knownIssue: 'was rejected once' } };
    expect(evaluateFixtures([withOutputs([stale])]).mismatches.join('\n')).toContain('known issue no longer reproduces');
  });

  it('a wrong freshness expectation is a mismatch and lowers the freshness rate', () => {
    const r = evaluateFixtures([withOutputs([], { expectFreshness: { outcome: 'blocked' } })]);
    expect(r.mismatches.join('\n')).toContain('freshness expected');
    expect(r.overall.freshnessHandlingRate.value).toBe(0);
    const wrongCount = evaluateFixtures([withOutputs([], { expectFreshness: { outcome: 'proceed', disclosures: 3 } })]);
    expect(wrongCount.mismatches.join('\n')).toContain('freshness expected');
  });

  it('a payload outside the registry, or a route with nothing to evaluate, is an integrity error', () => {
    const leaky = evaluateFixtures([withOutputs([good], { payload: { scan: { symbolsSelected: 4, accountNumber: '5WX12345' } } })]);
    expect(leaky.integrityErrors.join('\n')).toContain('payload rejected');
    expect(leaky.fixtureCount).toBe(0);
    const deep = evaluateFixtures([withOutputs([good], { route: 'leaps_deep_analysis', id: 'leaps_deep_analysis/x' })]);
    expect(deep.integrityErrors.join('\n')).toContain('no registry/template');
  });
});

describe('independent claim verification', () => {
  const spec = ROUTE_SPECS.scan_summary;
  const fx = byId('scan_summary/complete-basic');
  const now = Date.parse(fx.nowIso);
  const built = buildAnalysisInput({ userId: 'u', accountScope: 's', route: 'scan_summary', trust: 'client_attested', schemaVersion: spec.schemaVersion, subjectKey: 'k', payload: fx.payload, sourceAsOf: fx.sourceAsOf, registry: spec.citableFields, nowMs: now });
  if (!built.ok) throw new Error('fixture input');
  const verdict = validateAndRender({ rawText: JSON.stringify(fx.outputs[0].raw), registry: spec.citableFields, input: built.input, nowMs: now });
  if (!verdict.ok) throw new Error('fixture output');

  it('confirms every citation of an honest result', () => {
    const check = verifyAcceptedCitations(verdict, built.input, spec.citableFields, now);
    expect(check).toMatchObject({ verified: verdict.citations.length, failures: [] });
    expect(check.total).toBeGreaterThan(0);
  });

  it('flags a displayed value that differs from the snapshot, a wrong hash, a wrong as-of, and a leftover placeholder', () => {
    const tampered = JSON.parse(JSON.stringify(verdict)) as typeof verdict;
    tampered.output.citations[0].displayValue = '999';
    tampered.citations[1].valueHash = 'f'.repeat(64);
    tampered.citations[2].asOf = '2020-01-01T00:00:00.000Z';
    tampered.output.summary = 'Broken {{c:1}} text';
    const check = verifyAcceptedCitations(tampered, built.input, spec.citableFields, now);
    expect(check.verified).toBe(verdict.citations.length - 3);
    const text = check.failures.join('\n');
    expect(text).toContain('displayed value differs');
    expect(text).toContain('value hash differs');
    expect(text).toContain('as-of differs');
    expect(text).toContain('unsubstituted placeholder');
  });

  it('flags a pointer that is not in the registry or does not resolve', () => {
    const tampered = JSON.parse(JSON.stringify(verdict)) as typeof verdict;
    tampered.citations[0].pointer = '/scan/accountNumber';
    tampered.citations[1].pointer = '/candidates/9/dte';
    const text = verifyAcceptedCitations(tampered, built.input, spec.citableFields, now).failures.join('\n');
    expect(text).toContain('pointer not in registry');
    expect(text).toContain('pointer does not resolve');
  });
});

describe('recorded inputs and the gate comparison', () => {
  it('percentile is nearest-rank, ignores non-finite values, and is null when empty', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([3, 1, 2, NaN, Infinity], 0.5)).toBe(2);
    expect(percentile([], 0.95)).toBeNull();
    expect(mean([1, 2, 3, NaN])).toBe(2);
    expect(mean([])).toBeNull();
  });

  const recorded = (over: Partial<RecordedInputs> = {}): RecordedInputs => ({
    latencyMsSamples: [800, 900, 1200, 15_000], costUsdSamples: [0.001, 0.002, 0.004], usefulnessScores: [4, 4, 5, 3], humanReview: { audited: 20, accurate: 19 },
    consentedSnapshots: 0, configuredUserMonthlyBudgetUsd: 3, ...over,
  });
  const gate = testGate('scan_summary');
  const clean = evaluateFixtures(fixtures.filter((f) => f.id !== 'scan_summary/csp-filters'));

  it('passes when every measure is measured and met and the samples are sufficient', () => {
    const c = compareToGate(clean, 'scan_summary', recorded(), gate);
    expect(c.measures.map((m) => [m.measure, m.pass])).toEqual(c.measures.map((m) => [m.measure, true]));
    expect(c.sample.syntheticFixtures.have).toBeGreaterThanOrEqual(3);
    expect(c.allPass).toBe(true);
  });

  it('each measure can fail on its own', () => {
    const cases: Array<[string, Partial<RecordedInputs>]> = [
      ['groundedAccuracy', { humanReview: { audited: 20, accurate: 10 } }], ['p95LatencyMs', { latencyMsSamples: [30_000, 40_000] }],
      ['p95CostPerRequestUsd', { costUsdSamples: [1, 2] }], ['userMonthlyBudgetUsd', { configuredUserMonthlyBudgetUsd: 50 }], ['usefulnessMean', { usefulnessScores: [2, 2, 3] }],
    ];
    for (const [measure, over] of cases) {
      const c = compareToGate(clean, 'scan_summary', recorded(over), gate);
      expect(c.measures.find((m) => m.measure === measure)?.pass, measure).toBe(false);
      expect(c.allPass, measure).toBe(false);
    }
  });

  it('an unmeasured measure cannot pass', () => {
    const c = compareToGate(clean, 'scan_summary', { latencyMsSamples: [], costUsdSamples: [], usefulnessScores: [] }, gate);
    expect(c.measures.filter((m) => m.measured === null).map((m) => m.measure).sort()).toEqual(['groundedAccuracy', 'p95CostPerRequestUsd', 'p95LatencyMs', 'usefulnessMean', 'userMonthlyBudgetUsd']);
    expect(c.allPass).toBe(false);
  });

  it('an insufficient sample, a route mismatch, or fixture/validator disagreement blocks the gate', () => {
    expect(compareToGate(clean, 'scan_summary', recorded({ humanReview: { audited: 5, accurate: 5 } }), gate).sample.humanAuditedOutputs.pass).toBe(false);
    expect(compareToGate(clean, 'scan_summary', recorded({ humanReview: { audited: 5, accurate: 5 } }), gate).allPass).toBe(false);
    expect(compareToGate(clean, 'grounded_chat', recorded(), gate).allPass).toBe(false);
    const broken = { ...clean, mismatches: ['x'] };
    expect(compareToGate(broken, 'scan_summary', recorded(), gate).allPass).toBe(false);
  });

  it('the human accuracy figure is the reviewer rate, never the machine proxy', () => {
    const c = compareToGate(clean, 'scan_summary', recorded({ humanReview: { audited: 4, accurate: 3 } }), gate);
    expect(c.measures.find((m) => m.measure === 'groundedAccuracy')?.measured).toBe(0.75);
  });
});

describe('fixture files: shape checks and loading', () => {
  const ok = JSON.parse(JSON.stringify(byId('scan_summary/complete-basic'))) as Record<string, any>;
  it.each([
    ['not an object', 5, 'not an object'], ['a bad id', { ...ok, id: 'Nope' }, 'id must look like'], ['an unknown route', { ...ok, route: 'x' }, 'route unknown'],
    ['an id not starting with the route', { ...ok, id: 'grounded_chat/x' }, 'id must start with the route'], ['no description', { ...ok, description: '' }, 'description missing'],
    ['a bad date', { ...ok, nowIso: 'soon' }, 'nowIso'], ['a partial sourceAsOf', { ...ok, sourceAsOf: { scanCalculation: 'x' } }, 'sourceAsOf'],
    ['no outputs', { ...ok, outputs: [] }, 'outputs missing'],
    ['a duplicate output id', { ...ok, outputs: [ok.outputs[0], ok.outputs[0]] }, 'duplicate'],
    ['an adversarial output expecting acceptance', { ...ok, outputs: [{ ...ok.outputs[0], class: 'adversarial' }] }, 'must expect rejection'],
    ['a knownIssue on a rejection', { ...ok, outputs: [{ id: 'a', class: 'adversarial', raw: 'x', expect: { accepted: false, knownIssue: 'n' } }] }, 'knownIssue'],
  ])('rejects %s', (_n, value, expected) => expect(fixtureProblems(value).join('\n')).toContain(expected));

  it('the loader reports invalid JSON, mismatched ids, and bad shapes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ai-fixtures-'));
    mkdirSync(path.join(dir, 'scan_summary'));
    writeFileSync(path.join(dir, 'scan_summary', 'broken.json'), '{ nope');
    writeFileSync(path.join(dir, 'scan_summary', 'wrong-name.json'), JSON.stringify({ ...ok, id: 'scan_summary/another' }));
    writeFileSync(path.join(dir, 'scan_summary', 'fine.json'), JSON.stringify({ ...ok, id: 'scan_summary/fine' }));
    const loaded = loadFixtureDir(dir);
    expect(loaded.fixtures.map((f) => f.id)).toEqual(['scan_summary/fine']);
    expect(loaded.problems.join('\n')).toContain('broken.json: not valid JSON');
    expect(loaded.problems.join('\n')).toContain('wrong-name.json: id/route must match');
    expect(loadFixtureDir(path.join(dir, 'missing')).problems[0]).toContain('does not exist');
  });
});
