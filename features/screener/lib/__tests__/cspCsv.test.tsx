import { describe, expect, it } from 'vitest';
import { buildCspCsv, CSP_CSV_HEADERS } from '../cspCsv';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import { createScanSession } from '@/lib/screener/scanSession';

describe('CSP CSV canonical qualification fields', () => {
  it('exports mode qualification, reasons, and overall qualification with the matching headers', () => {
    const ruleSnapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES, { mode: 'targeted', popMin: 70 });
    const session = createScanSession({ mode: 'targeted', requestedStrategy: 'csp', scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] }, ruleSnapshot });
    const result: any = {
      candidateId: 'amd-put-1', symbol: 'AMD', strategy: 'CSP', price: 100, ivr: 40,
      qualified: false, failReasons: ['POP below 70%'], checks: {},
      bestCandidate: {
        strategy: 'CSP', expiration: '2026-09-18', dte: 42, shortStrike: 95,
        shortDelta: -0.2, shortOI: 500, credit: 1.5, spreadWidth: 0, creditRatio: 0,
        roc: 1.58, pop: 68, cspMarketQualification: 'QUALIFIED',
        cspModeQualification: 'FAILED', cspModeQualificationReasons: ['POP below 70%', 'ROC below 2%'],
        cspAccountEligibility: 'ELIGIBLE',
      },
    };

    const csv = buildCspCsv([result], session);
    expect(CSP_CSV_HEADERS.slice(24, 30)).toEqual([
      'Market Qualification', 'Mode Qualification', 'Mode Qualification Reasons',
      'Account Eligibility', 'Overall Qualified', 'Warnings / Rejections',
    ]);
    expect(csv).toContain('"QUALIFIED","FAILED","POP below 70%; ROC below 2%","ELIGIBLE","false","POP below 70%"');
  });
});
