// lib/leaps-analysis/__tests__/qualificationClaims.test.ts
//
// LEAPS-AI-0003 follow-up: the model must never state whether a contract is or is not qualified -- TradeEdge shows
// that status separately. An analysis of a CONTRACT_QUALIFIED contract once said "not fully qualified".

import { describe, expect, it } from 'vitest';
import { validateAnalysisOutput } from '../analysisService';

const base = {
  posture: 'INSUFFICIENT_EVIDENCE' as const,
  evidence: [{ field: 'delta', fact: 'The delta is high, so the call tracks the stock closely.' }],
  inferences: [{ statement: 'Extrinsic value is a modest share of the cost.', uncertainty: 'Depends on implied volatility.' }],
  mechanics: 'Mostly intrinsic value with a small time premium.',
  tradeoffs: 'Lower time premium in exchange for more capital tied up.',
  cautions: [] as string[],
  missing: [] as string[],
};

describe('validateAnalysisOutput: qualification claims', () => {
  it.each([
    'The contract is not fully qualified and I am explaining mechanics only.',
    'This contract is qualified for further review.',
    'The contract does not qualify under the current filters.',
    'It qualifies on delta and open interest.',
    'An unqualified contract carries more risk.',
  ])('rejects: %s', text => {
    expect(validateAnalysisOutput({ ...base, mechanics: text }).valid).toBe(false);
    expect(validateAnalysisOutput({ ...base, cautions: [text] }).valid).toBe(false);
  });

  it('still accepts ordinary mechanics text and status field names used as evidence', () => {
    const output = { ...base, evidence: [{ field: 'qualification.status', fact: 'TradeEdge reports CONTRACT_QUALIFIED for this contract.' }] };
    expect(validateAnalysisOutput(output).valid).toBe(true);
    expect(validateAnalysisOutput(base).valid).toBe(true);
  });
});
