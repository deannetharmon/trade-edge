// lib/discovery/qv/__tests__/policy.test.ts

// LEAPS-QV-0001 Gate 3 (Section 45.15) -- policy is centralized and pinned; reasons are structured and registered;
// evaluation is deterministic; classifier code carries no thresholds of its own.

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { explainReasons, fingerprint, IMPLEMENTED_METRIC_IDS, stableStringify } from '../..';
import { QV_ALL_REASON_CODES, QV_REASON, QV_SPEC_REASON_CONCEPTS, QV_V1_0_ASSUMPTIONS, QV_V1_0_POLICY, QV_V1_0_STRATEGY } from '..';
import { codesOf, evaluate, inputWith, stateOf, STABILIZING_TECH } from './qvFixtures';
import { runStrategy } from '../..';

const QV_DIR = resolve(__dirname, '..');
const CLASSIFIERS = ['fcf.ts', 'quality.ts', 'valuation.ts', 'fundamentals.ts', 'technical.ts', 'risk.ts', 'strategy.ts'];

// Pin: any change to a threshold or input contract changes this value and must be a deliberate, versioned decision.
const POLICY_FINGERPRINT = '19cb810ab46f4766369067a4233cbc073abff5294a0771bd257b5fc60cd82f98';

describe('QV-v1.0 policy', () => {
  it('is frozen and fingerprint-pinned', () => {
    expect(Object.isFrozen(QV_V1_0_POLICY)).toBe(true);
    expect(fingerprint(stableStringify(QV_V1_0_POLICY))).toBe(POLICY_FINGERPRINT);
  });

  it('records every qualitative-spec interpretation as an assumption for ratification', () => {
    expect(QV_V1_0_ASSUMPTIONS.map((a) => a.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
  });

  it('every assumption is classified DIRECT / POLICY / DATA and A1-A8 carry the round 4 ratification record', () => {
    QV_V1_0_ASSUMPTIONS.forEach((assumption) => {
      expect(['DIRECT', 'POLICY', 'DATA']).toContain(assumption.basis);
      expect(assumption.policyQuestion.length).toBeGreaterThan(0);
      expect(assumption.ratification).toBe('RATIFIED');
      expect(assumption.ratificationRecord).toContain('round 4');
    });
  });

  it('documents the contract-only inputs: they are not produced by the normalizer today (update the docs when one is)', () => {
    const contractOnly = [
      QV_V1_0_POLICY.inputs.quality.fcfHistory,
      QV_V1_0_POLICY.inputs.technical.weeklyRsiSlope,
      QV_V1_0_POLICY.inputs.technical.sma50GapChange,
      QV_V1_0_POLICY.inputs.technical.relativeStrengthChange,
    ];
    contractOnly.forEach((id) => expect(IMPLEMENTED_METRIC_IDS).not.toContain(id));
  });

  it('classifier files hold no numeric thresholds: every number lives in policy.ts', () => {
    const offenders: string[] = [];
    CLASSIFIERS.forEach((file) => {
      readFileSync(join(QV_DIR, file), 'utf8').split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0 || trimmed.indexOf('/*') === 0) return;
        const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');
        (code.match(/(?<![\w.])\d+(\.\d+)?(?![\w])/g) || []).forEach((literal) => {
          if (['0', '1', '2'].indexOf(literal) < 0) offenders.push(`${file}:${index + 1}: ${literal}`);
        });
      });
    });
    expect(offenders).toEqual([]);
  });

  it('the strategy layer imports no provider, route, UI or network code', () => {
    const offenders: string[] = [];
    readdirSync(QV_DIR).filter((f) => f.endsWith('.ts')).forEach((file) => {
      const text = readFileSync(join(QV_DIR, file), 'utf8');
      (text.match(/from '[^']+'/g) || []).forEach((spec) => {
        // Only siblings in qv/ ('./x') or the discovery core ('../x') may be imported; nothing that leaves lib/discovery.
        if (!/^from '\.\.?\/[\w]+'$|^from '\.\.'$/.test(spec) || /\.\.\/\.\.\//.test(spec)) offenders.push(`${file}: ${spec}`);
      });
    });
    expect(offenders).toEqual([]);
  });
});

describe('reason codes', () => {
  it('every emitted reason is registered, categorized and carries its evidence/params', () => {
    const scenarios = [evaluate(), evaluate(STABILIZING_TECH), evaluate({ weeklyRsi: null }), evaluate({ percentile5y: 18, discount5y: 5 }), evaluate({ margin: -1 })];
    scenarios.forEach((evaluation) => {
      evaluation.reasonCodes.forEach((reason) => {
        expect(QV_ALL_REASON_CODES).toContain(reason.code);
        expect(reason.code.indexOf(reason.category)).toBe(0);
      });
    });
  });

  it('maps every Section 45.12 concept to an emitted, registered code', () => {
    Object.keys(QV_SPEC_REASON_CONCEPTS).forEach((name) => expect(QV_ALL_REASON_CODES).toContain(QV_SPEC_REASON_CONCEPTS[name]));
    expect(Object.keys(QV_REASON).length).toBeGreaterThan(40);
  });

  it('explanation text is derived from the same reason objects that classified', () => {
    const evaluation = evaluate(STABILIZING_TECH);
    const text = explainReasons(evaluation.reasonCodes);
    expect(text.length).toBe(evaluation.reasonCodes.length);
    expect(text.join('\n')).toContain('Lifecycle: state setup [supports]');
  });

  it('every gate outcome carries reasons, and a failed hard gate names its cause', () => {
    const evaluation = evaluate({ margin: -1 });
    const quality = evaluation.gateOutcomes.find((g) => g.gateId === 'qv_quality');
    expect(quality?.result).toBe('FAIL');
    expect(quality?.reasonCodes.map((r) => r.code)).toContain('QUALITY_FAIL_OPERATING_MARGIN');
  });
});

describe('determinism', () => {
  it('equal input gives an equal evaluation, repeatedly', () => {
    const first = runStrategy(QV_V1_0_STRATEGY, inputWith(STABILIZING_TECH));
    const second = runStrategy(QV_V1_0_STRATEGY, inputWith(STABILIZING_TECH));
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(stateOf(first)).toBe('SETUP');
    expect(codesOf(first)).toEqual(codesOf(second));
  });

  it('does not mutate its input', () => {
    const input = inputWith();
    const before = stableStringify(input);
    runStrategy(QV_V1_0_STRATEGY, input);
    expect(stableStringify(input)).toBe(before);
  });
});
