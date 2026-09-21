// lib/ai-policy/eval/harness.ts
//
// Offline evaluation harness (AI-POLICY-0001F). Pure and deterministic: no clock, no network, no Redis, no randomness.
// It runs the PRODUCTION validator/renderer over recorded model outputs for frozen synthetic snapshots and computes the
// machine metrics a launch-gate record needs. Latency, cost, human accuracy and usefulness are not measurable offline:
// they arrive as recorded inputs (preview runs and reviewer forms) and are summarised here so a gate can be judged in
// one place. Nothing here chooses a threshold or approves anything.

import { canonicalHash } from '../canonical';
import { evaluateFreshness } from '../freshness';
import { buildAnalysisInput } from '../inputStore';
import { MEASURES } from '../launchGates';
import type { LaunchGate, MeasureKey } from '../launchGates';
import { LEXICON_VERSION } from '../lexicon';
import { ROUTE_SPECS } from '../routeSpecs';
import type { RouteSpec } from '../routeSpecs';
import { AI_ROUTE_IDS, SOURCE_KINDS, SOURCE_LABELS } from '../types';
import type { AiRouteId, AnalysisInput, CitableField, RenderedOutput, SourceKind, TrustClass } from '../types';
import { VALIDATOR_VERSION, formatValue, validateAndRender } from '../validator';
import type { ValidationResult } from '../validator';

export type OutputClass = 'good' | 'borderline' | 'adversarial';
export const OUTPUT_CLASSES: readonly OutputClass[] = ['good', 'borderline', 'adversarial'];

export interface OutputExpectation {
  accepted: boolean;
  /** When rejection is expected: the exact validator rule that should fire. */
  rule?: string;
  /** When acceptance is expected: substrings the RENDERED text must contain. */
  renderedContains?: string[];
  /** When acceptance is expected: pointers the output must cite. */
  mustCite?: string[];
  /**
   * Documents a KNOWN false rejection: a benign output the validator currently rejects (with the reason a reviewer should
   * see). It is reported under `knownIssues` instead of `mismatches`, and it still counts against the false-rejection
   * rate. If the validator later accepts it, that is a mismatch: remove the note.
   */
  knownIssue?: string;
}

export interface EvalOutputCase {
  id: string;
  class: OutputClass;
  /** Recorded model output: raw text (may be malformed on purpose) or an object that is JSON-encoded. */
  raw: string | Record<string, unknown>;
  expect: OutputExpectation;
}

export interface FreshnessExpectation {
  outcome: 'proceed' | 'blocked';
  /** When proceeding: how many server-written disclosures the artifact must carry. */
  disclosures?: number;
}

export interface EvalFixture {
  /** `<route>/<file name without .json>` */
  id: string;
  route: AiRouteId;
  description: string;
  /** The fixed "now" for freshness (ISO). */
  nowIso: string;
  trust?: TrustClass;
  sourceAsOf: Record<SourceKind, string | null>;
  payload: unknown;
  question?: string | null;
  expectFreshness?: FreshnessExpectation;
  outputs: EvalOutputCase[];
}

export interface MetricValue {
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface EvalMetrics {
  /** Machine proxy: share of expected-good outputs accepted AND meeting their fixture expectations. Human accuracy is a reviewer input. */
  groundedAccuracy: MetricValue;
  /** Share of citations in accepted outputs that an independent re-check confirms against the frozen snapshot. */
  claimVerificationRate: MetricValue;
  /** Share of adversarial outputs rejected. */
  prohibitedOutputRejectionRate: MetricValue;
  /** Share of benign (good + borderline) outputs rejected. */
  falseRejectionRate: MetricValue;
  /** Share of fixtures whose stale/missing-source handling (block or disclose) matched the expectation. */
  freshnessHandlingRate: MetricValue;
}

export interface OutputResult {
  fixtureId: string;
  outputId: string;
  class: OutputClass;
  accepted: boolean;
  rule: string | null;
}

export interface EvalReport {
  validatorVersion: string;
  lexiconVersion: string;
  fixtureCount: number;
  outputCount: number;
  overall: EvalMetrics;
  perRoute: Partial<Record<AiRouteId, EvalMetrics & { fixtures: number; outputs: number }>>;
  /** Every place the production validator disagreed with a fixture's expectation. Empty when the fixtures and validator agree. */
  mismatches: string[];
  /** Documented false rejections (see OutputExpectation.knownIssue). Counted in the metrics; listed here for the reviewers. */
  knownIssues: string[];
  /** Fixtures that could not be evaluated (payload outside the registry, unknown route). */
  integrityErrors: string[];
  outputs: OutputResult[];
}

const rate = (numerator: number, denominator: number): MetricValue => ({ value: denominator === 0 ? null : numerator / denominator, numerator, denominator });

/** Independent pointer resolution (deliberately not the validator's helper). */
function resolveIndependently(root: unknown, pointer: string): { found: boolean; value: unknown } {
  if (!pointer.startsWith('/')) return { found: false, value: undefined };
  let node: unknown = root;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= node.length) return { found: false, value: undefined };
      node = node[Number(key)];
    } else if (typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, key)) {
      node = (node as Record<string, unknown>)[key];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

function patternMatchesIndependently(pointer: string, pattern: string): boolean {
  const a = pointer.split('/');
  const b = pattern.split('/');
  return a.length === b.length && b.every((seg, i) => seg === '*' || seg === a[i]);
}

function renderedText(output: RenderedOutput): string {
  return [output.summary, ...output.observations.map((c) => c.text), ...output.tradeoffs.map((c) => c.text), ...output.missingOrStaleData.map((c) => c.text), ...output.questionsForTrader.map((t) => t.text), ...output.limitations.map((t) => t.text)].join('\n');
}

/** Re-checks every citation of an accepted output against the frozen input, without trusting the validator's own bookkeeping. */
export function verifyAcceptedCitations(result: Extract<ValidationResult, { ok: true }>, input: AnalysisInput, registry: readonly CitableField[], nowMs: number): { verified: number; total: number; failures: string[] } {
  const failures: string[] = [];
  let verified = 0;
  const text = renderedText(result.output);
  if (text.includes('{{') || text.includes('}}')) failures.push('unsubstituted placeholder in rendered text');
  for (const cited of result.citations) {
    const client = result.output.citations.find((c) => c.id === cited.id);
    const problems: string[] = [];
    const field = registry.find((f) => patternMatchesIndependently(cited.pointer, f.pattern));
    const hit = resolveIndependently(input.payload, cited.pointer);
    if (!field) problems.push('pointer not in registry');
    if (!hit.found) problems.push('pointer does not resolve');
    if (!client) problems.push('no client citation');
    if (field && hit.found && client) {
      if (canonicalHash(hit.value) !== cited.valueHash) problems.push('value hash differs from snapshot');
      if (formatValue(field.format, hit.value) !== client.displayValue) problems.push('displayed value differs from snapshot');
      if (client.label !== field.label) problems.push('label differs from registry');
      if (client.sourceLabel !== SOURCE_LABELS[field.source]) problems.push('source label differs');
      if (cited.asOf !== input.sourceAsOf[field.source] || client.asOf !== input.sourceAsOf[field.source]) problems.push('as-of differs from snapshot');
      if (!evaluateFreshness(input.sourceAsOf, [field.source], nowMs).allFresh) problems.push('cited source not fresh');
    }
    if (problems.length === 0) verified += 1;
    else failures.push(`citation ${cited.id} (${cited.pointer}): ${problems.join('; ')}`);
  }
  return { verified, total: result.citations.length, failures };
}

interface Tally {
  fixtures: number;
  outputs: number;
  groundedOk: number;
  groundedDen: number;
  claimsOk: number;
  claimsTotal: number;
  advRejected: number;
  advTotal: number;
  benignRejected: number;
  benignTotal: number;
  freshOk: number;
  freshTotal: number;
}
const emptyTally = (): Tally => ({ fixtures: 0, outputs: 0, groundedOk: 0, groundedDen: 0, claimsOk: 0, claimsTotal: 0, advRejected: 0, advTotal: 0, benignRejected: 0, benignTotal: 0, freshOk: 0, freshTotal: 0 });
const metricsOf = (t: Tally): EvalMetrics => ({
  groundedAccuracy: rate(t.groundedOk, t.groundedDen),
  claimVerificationRate: rate(t.claimsOk, t.claimsTotal),
  prohibitedOutputRejectionRate: rate(t.advRejected, t.advTotal),
  falseRejectionRate: rate(t.benignRejected, t.benignTotal),
  freshnessHandlingRate: rate(t.freshOk, t.freshTotal),
});

/** Evaluates fixtures with the production route specs (or injected ones). Same inputs always give the same report. */
export function evaluateFixtures(fixtures: readonly EvalFixture[], specs: Record<AiRouteId, RouteSpec> = ROUTE_SPECS): EvalReport {
  const ordered = fixtures.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const overall = emptyTally();
  const perRoute: Partial<Record<AiRouteId, Tally>> = {};
  const mismatches: string[] = [];
  const knownIssues: string[] = [];
  const integrityErrors: string[] = [];
  const outputs: OutputResult[] = [];

  for (const fixture of ordered) {
    const spec = specs[fixture.route];
    const nowMs = Date.parse(fixture.nowIso);
    if (!spec || spec.deferred || spec.citableFields.length === 0 || !spec.template) {
      integrityErrors.push(`${fixture.id}: route ${fixture.route} has no registry/template to evaluate`);
      continue;
    }
    if (!Number.isFinite(nowMs)) {
      integrityErrors.push(`${fixture.id}: nowIso is not a date`);
      continue;
    }
    const inputSpec = specs[spec.inputKind ?? fixture.route];
    const built = buildAnalysisInput({
      userId: 'eval-user', accountScope: 'eval-scope', route: inputSpec.route, trust: fixture.trust ?? spec.allowedTrust[0], schemaVersion: inputSpec.schemaVersion,
      subjectKey: fixture.id, payload: fixture.payload, sourceAsOf: fixture.sourceAsOf, registry: spec.citableFields, nowMs,
    });
    if (!built.ok) {
      integrityErrors.push(`${fixture.id}: payload rejected (${built.detail})`);
      continue;
    }
    const input = built.input;
    const tally = (perRoute[fixture.route] ??= emptyTally());
    for (const t of [overall, tally]) t.fixtures += 1;

    if (fixture.expectFreshness) {
      const report = evaluateFreshness(input.sourceAsOf, spec.requiredSources, nowMs);
      const outcome = spec.strictFreshness && !report.allFresh ? 'blocked' : 'proceed';
      const disclosures = outcome === 'proceed' ? (report.allFresh ? 0 : report.notFresh.length) + (spec.serverDisclosures?.(input).length ?? 0) : null;
      const okOutcome = outcome === fixture.expectFreshness.outcome;
      const okDisclosures = fixture.expectFreshness.disclosures === undefined || fixture.expectFreshness.disclosures === disclosures;
      for (const t of [overall, tally]) {
        t.freshTotal += 1;
        if (okOutcome && okDisclosures) t.freshOk += 1;
      }
      if (!okOutcome || !okDisclosures) mismatches.push(`${fixture.id}: freshness expected ${JSON.stringify(fixture.expectFreshness)} but got ${JSON.stringify({ outcome, disclosures })}`);
    }

    for (const out of fixture.outputs.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const rawText = typeof out.raw === 'string' ? out.raw : JSON.stringify(out.raw);
      const verdict = validateAndRender({ rawText, registry: spec.citableFields, input, nowMs });
      const label = `${fixture.id}/${out.id}`;
      const accepted = verdict.ok;
      const rule = verdict.ok ? null : verdict.rule;
      outputs.push({ fixtureId: fixture.id, outputId: out.id, class: out.class, accepted, rule });
      for (const t of [overall, tally]) t.outputs += 1;

      let expectationsMet = accepted === out.expect.accepted;
      if (out.expect.knownIssue !== undefined && accepted) mismatches.push(`${label}: known issue no longer reproduces (the output is now accepted); remove the knownIssue note`);
      else if (accepted !== out.expect.accepted) {
        if (out.expect.knownIssue !== undefined && out.expect.accepted && !accepted) knownIssues.push(`${label}: rejected by ${rule}. ${out.expect.knownIssue}`);
        else mismatches.push(`${label}: expected ${out.expect.accepted ? 'accepted' : 'rejected'} but was ${accepted ? 'accepted' : `rejected (${rule})`}`);
      }
      if (!accepted && out.expect.accepted === false && out.expect.rule !== undefined && out.expect.rule !== rule) {
        expectationsMet = false;
        mismatches.push(`${label}: expected rule ${out.expect.rule} but got ${rule}`);
      }
      if (verdict.ok) {
        const text = renderedText(verdict.output);
        for (const needle of out.expect.renderedContains ?? []) {
          if (!text.includes(needle)) {
            expectationsMet = false;
            mismatches.push(`${label}: rendered text lacks "${needle}"`);
          }
        }
        const cited = new Set(verdict.citations.map((c) => c.pointer));
        for (const pointer of out.expect.mustCite ?? []) {
          if (!cited.has(pointer)) {
            expectationsMet = false;
            mismatches.push(`${label}: did not cite ${pointer}`);
          }
        }
        const check = verifyAcceptedCitations(verdict, input, spec.citableFields, nowMs);
        for (const failure of check.failures) mismatches.push(`${label}: ${failure}`);
        for (const t of [overall, tally]) {
          t.claimsOk += check.verified;
          t.claimsTotal += check.total;
        }
      }

      for (const t of [overall, tally]) {
        if (out.class === 'adversarial') {
          t.advTotal += 1;
          if (!accepted) t.advRejected += 1;
        } else {
          t.benignTotal += 1;
          if (!accepted) t.benignRejected += 1;
        }
        if (out.expect.accepted) {
          t.groundedDen += 1;
          if (accepted && expectationsMet) t.groundedOk += 1;
        }
      }
    }
  }

  const routes: EvalReport['perRoute'] = {};
  for (const route of AI_ROUTE_IDS) {
    const t = perRoute[route];
    if (t) routes[route] = { ...metricsOf(t), fixtures: t.fixtures, outputs: t.outputs };
  }
  return {
    validatorVersion: VALIDATOR_VERSION, lexiconVersion: LEXICON_VERSION, fixtureCount: overall.fixtures, outputCount: overall.outputs,
    overall: metricsOf(overall), perRoute: routes, mismatches, knownIssues, integrityErrors, outputs,
  };
}

// ---- Recorded inputs (preview runs and reviewer forms) and the comparison to a gate record ----

export interface RecordedInputs {
  latencyMsSamples: number[];
  costUsdSamples: number[];
  /** Reviewer usefulness scores, 1-5. */
  usefulnessScores: number[];
  /** Human accuracy review: how many outputs were audited and how many were fully accurate. */
  humanReview?: { audited: number; accurate: number };
  /** Consented completed snapshots actually evaluated. */
  consentedSnapshots?: number;
  /** The per-user monthly budget currently configured (AI_POLICY_USER_MONTHLY_BUDGET_USD), for comparison with the approved cap. */
  configuredUserMonthlyBudgetUsd?: number;
}

/** Nearest-rank percentile; null for an empty sample. */
export function percentile(samples: readonly number[], p: number): number | null {
  const clean = samples.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * clean.length));
  return clean[Math.min(rank, clean.length) - 1];
}

export const mean = (samples: readonly number[]): number | null => {
  const clean = samples.filter((n) => Number.isFinite(n));
  return clean.length === 0 ? null : clean.reduce((a, b) => a + b, 0) / clean.length;
};

export interface MeasureComparison {
  measure: MeasureKey;
  comparator: 'gte' | 'lte';
  threshold: number;
  /** null = not measured, so it cannot pass. */
  measured: number | null;
  pass: boolean;
}

export interface GateComparison {
  gateId: string;
  measures: MeasureComparison[];
  sample: { syntheticFixtures: { have: number; need: number; pass: boolean }; consentedSnapshots: { have: number; need: number; pass: boolean }; humanAuditedOutputs: { have: number; need: number; pass: boolean } };
  /** True only if every measure was measured and passed, the sample is sufficient, and the fixtures and validator agree. */
  allPass: boolean;
}

export function compareToGate(report: EvalReport, route: AiRouteId, recorded: RecordedInputs, gate: LaunchGate): GateComparison {
  const routeMetrics = report.perRoute[route];
  const human = recorded.humanReview && recorded.humanReview.audited > 0 ? recorded.humanReview.accurate / recorded.humanReview.audited : null;
  const measuredValues: Record<MeasureKey, number | null> = {
    groundedAccuracy: human,
    claimVerificationRate: routeMetrics?.claimVerificationRate.value ?? null,
    prohibitedOutputRejectionRate: routeMetrics?.prohibitedOutputRejectionRate.value ?? null,
    falseRejectionRate: routeMetrics?.falseRejectionRate.value ?? null,
    freshnessHandlingRate: routeMetrics?.freshnessHandlingRate.value ?? null,
    p95LatencyMs: percentile(recorded.latencyMsSamples, 0.95),
    p95CostPerRequestUsd: percentile(recorded.costUsdSamples, 0.95),
    userMonthlyBudgetUsd: recorded.configuredUserMonthlyBudgetUsd ?? null,
    usefulnessMean: mean(recorded.usefulnessScores),
  };
  const measures = (Object.keys(MEASURES) as MeasureKey[]).map((measure): MeasureComparison => {
    const comparator = MEASURES[measure].comparator;
    const threshold = gate.thresholds[measure];
    const measured = measuredValues[measure];
    const pass = measured !== null && (comparator === 'gte' ? measured >= threshold : measured <= threshold);
    return { measure, comparator, threshold, measured, pass };
  });
  const need = gate.minSample;
  const have = { syntheticFixtures: routeMetrics?.fixtures ?? 0, consentedSnapshots: recorded.consentedSnapshots ?? 0, humanAuditedOutputs: recorded.humanReview?.audited ?? 0 };
  const sample = {
    syntheticFixtures: { have: have.syntheticFixtures, need: need.syntheticFixtures, pass: have.syntheticFixtures >= need.syntheticFixtures },
    consentedSnapshots: { have: have.consentedSnapshots, need: need.consentedSnapshots, pass: have.consentedSnapshots >= need.consentedSnapshots },
    humanAuditedOutputs: { have: have.humanAuditedOutputs, need: need.humanAuditedOutputs, pass: have.humanAuditedOutputs >= need.humanAuditedOutputs },
  };
  const allPass = measures.every((m) => m.pass) && Object.values(sample).every((s) => s.pass) && report.mismatches.length === 0 && report.integrityErrors.length === 0 && gate.route === route;
  return { gateId: gate.id, measures, sample, allPass };
}

/** Shape check for a parsed fixture file. Returns problems (empty = usable). */
export function fixtureProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['not an object'];
  const f = value as Record<string, unknown>;
  if (typeof f.id !== 'string' || !/^[a-z_]+\/[a-z0-9-]+$/.test(f.id)) problems.push('id must look like "<route>/<name>"');
  if (typeof f.route !== 'string' || !(AI_ROUTE_IDS as readonly string[]).includes(f.route)) problems.push('route unknown');
  else if (typeof f.id === 'string' && !f.id.startsWith(`${f.route}/`)) problems.push('id must start with the route');
  if (typeof f.description !== 'string' || f.description.trim() === '') problems.push('description missing');
  if (typeof f.nowIso !== 'string' || !Number.isFinite(Date.parse(f.nowIso))) problems.push('nowIso must be a date');
  const asOf = f.sourceAsOf as Record<string, unknown> | undefined;
  if (typeof asOf !== 'object' || asOf === null || SOURCE_KINDS.some((k) => !(k in asOf) || (asOf[k] !== null && typeof asOf[k] !== 'string'))) problems.push('sourceAsOf must list every source (string or null)');
  if (!('payload' in f)) problems.push('payload missing');
  if (!Array.isArray(f.outputs) || f.outputs.length === 0) return [...problems, 'outputs missing'];
  const ids = new Set<string>();
  f.outputs.forEach((o, i) => {
    const out = o as Record<string, unknown>;
    if (typeof out?.id !== 'string') problems.push(`outputs[${i}].id missing`);
    else if (ids.has(out.id)) problems.push(`outputs[${i}].id duplicate`);
    else ids.add(out.id);
    if (!OUTPUT_CLASSES.includes(out?.class as OutputClass)) problems.push(`outputs[${i}].class must be good, borderline or adversarial`);
    if (typeof out?.raw !== 'string' && (typeof out?.raw !== 'object' || out.raw === null)) problems.push(`outputs[${i}].raw missing`);
    const exp = out?.expect as Record<string, unknown> | undefined;
    if (typeof exp?.accepted !== 'boolean') problems.push(`outputs[${i}].expect.accepted missing`);
    else if ((out?.class === 'adversarial') === exp.accepted) problems.push(`outputs[${i}]: an adversarial output must expect rejection and a good/borderline one acceptance`);
    if (exp?.knownIssue !== undefined && (typeof exp.knownIssue !== 'string' || exp.knownIssue.trim() === '' || exp.accepted !== true)) problems.push(`outputs[${i}].expect.knownIssue must be a note on an output that is expected to be accepted`);
  });
  return problems;
}
