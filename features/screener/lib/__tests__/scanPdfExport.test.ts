import { describe, expect, it, vi } from 'vitest';
import { buildLeapsExportReport, buildScanExportReport } from '../scanPdfExport';
import { buildScanPrintHtml } from '../printScanPdfReport';
import { completeSession, createScanSession, recordSymbolEvaluated, type ScreenerScanSession } from '@/lib/screener/scanSession';
import type { ScreenResult } from '@/lib/scans/types';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const pending = { status: 'pending' as const, value: '—', reason: '—' };
const checks = { ivr: pending, earnings: pending, oi: pending, delta: pending, credit: pending, roc: pending, pop: pending, iv: pending, emClearance: pending };
const result = (symbol: string, qualified: boolean, strategy = 'BPS', heldLeap = false): ScreenResult => ({
  symbol, strategy: heldLeap ? 'PMCC' : strategy, price: 100, ivr: 30, qualified,
  bestCandidate: { strategy: heldLeap ? 'PMCC' : strategy, expiration: '2026-11-20', dte: 40, shortStrike: 95, longStrike: 90, shortDelta: .2, credit: 1, spreadWidth: 5, creditRatio: .2, roc: 25, pop: 72, shortOI: 500, longOI: 450 },
  failReasons: qualified ? [] : ['Insufficient cushion'], checks,
  ...(heldLeap ? { pmccDecision: { policyVersion: 'test', qualification: 'DISQUALIFIED' as const, readiness: 'WAIT_MONITOR' as const, action: 'BLOCKED' as const, entryMode: 'covered-short-call-against-held-leaps' as const, gates: [] } } : {}),
});

function completedSession(): ScreenerScanSession {
  let session = createScanSession({ mode: 'filter', requestedStrategy: 'spreads', scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['AAPL', 'MSFT'] } });
  session = recordSymbolEvaluated(session, 'AAPL', [result('AAPL', true)]);
  session = recordSymbolEvaluated(session, 'MSFT', [result('MSFT', false)]);
  return completeSession(session);
}

describe('scan PDF export view model', () => {
  it('uses the whole completed session for a full export regardless of the current view', () => {
    const session = completedSession();
    const report = buildScanExportReport(session, 'full', [session.results[0]]);
    expect(report.qualified).toHaveLength(1);
    expect(report.otherCandidates).toHaveLength(1);
    expect(report.accounting.disqualifiedCandidateCount).toBe(1);
    expect(report.configuration.find(item => item.label === 'Export scope')?.value).toBe('Full completed scan');
  });

  it('limits only the candidate list for a current-view export while retaining full accounting', () => {
    const session = completedSession();
    const report = buildScanExportReport(session, 'current-view', [session.results[0]]);
    expect(report.qualified).toHaveLength(1);
    expect(report.otherCandidates).toHaveLength(0);
    expect(report.accounting.disqualifiedCandidateCount).toBe(1);
  });

  it('calls an unpaired held LEAP a potential short-call candidate, never an existing PMCC', () => {
    let session = createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['NFLX'], eligibleSymbols: ['NFLX'] } });
    session = recordSymbolEvaluated(session, 'NFLX', [result('NFLX', false, 'PMCC', true)]);
    const report = buildScanExportReport(completeSession(session), 'full');
    expect(report.heldLeapCandidates[0].status).toBe('Potential short-call candidate');
  });

  it('exports standalone LEAPS without pretending it is a PMCC session', () => {
    const report = buildLeapsExportReport([{ symbol: 'AAPL', expiration: '2028-01-21', dte: 480, strike: 150, delta: .75, openInterest: 300, bid: 50, ask: 51, underlyingPrice: 200, spreadPct: 2, extrinsicValue: 1, ivRank: 25, ivx: 30, dataQuality: 'ok', score: 87 }], 'full', 1, ['AAPL']);
    expect(report.requestedStrategy).toBe('leaps');
    expect(report.qualified[0].strategy).toBe('LEAPS');
    expect(report.heldLeapCandidates).toHaveLength(0);
  });

  it('renders BPS, BCS, and IC structures from one completed spread session', () => {
    let session = createScanSession({ mode: 'rank', requestedStrategy: 'spreads', scope: { universeSymbols: ['A', 'B', 'C'], eligibleSymbols: ['A', 'B', 'C'] } });
    session = recordSymbolEvaluated(session, 'A', [result('A', true, 'BPS')]);
    session = recordSymbolEvaluated(session, 'B', [result('B', true, 'BCS')]);
    session = recordSymbolEvaluated(session, 'C', [result('C', true, 'IC')]);
    const report = buildScanExportReport(completeSession(session), 'full');
    expect(report.qualified.map(candidate => candidate.strategy)).toEqual(['BPS', 'BCS', 'IC']);
  });

  it('renders CSP, covered-call, and new-PMCC snapshots without spread-only assumptions', () => {
    const sessions = [
      createScanSession({ mode: 'rank', requestedStrategy: 'csp', scope: { universeSymbols: ['CSP'], eligibleSymbols: ['CSP'] }, ruleSnapshot: buildCspRuleSnapshot(DEFAULT_CSP_RULES, { mode: 'rank' }) }),
      createScanSession({ mode: 'filter', requestedStrategy: 'cc', scope: { universeSymbols: ['CC'], eligibleSymbols: ['CC'] } }),
      createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['PMCC'], eligibleSymbols: ['PMCC'] } }),
    ];
    const reports = [
      buildScanExportReport(completeSession(recordSymbolEvaluated(sessions[0], 'CSP', [result('CSP', true, 'CSP')])), 'full'),
      buildScanExportReport(completeSession(recordSymbolEvaluated(sessions[1], 'CC', [result('CC', true, 'CC')])), 'full'),
      buildScanExportReport(completeSession(recordSymbolEvaluated(sessions[2], 'PMCC', [result('PMCC', true, 'PMCC')])), 'full'),
    ];
    expect(reports.map(report => report.qualified[0].strategy)).toEqual(['CSP', 'CC', 'PMCC']);
    expect(reports[0].configuration.some(item => item.label === 'DTE range')).toBe(true);
  });

  it('exports a zero-result completed session with its accounting and outcomes', () => {
    let session = createScanSession({ mode: 'filter', requestedStrategy: 'cc', scope: { universeSymbols: ['NONE'], eligibleSymbols: ['NONE'] } });
    session = recordSymbolEvaluated(session, 'NONE', [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    const report = buildScanExportReport(completeSession(session), 'full');
    expect(report.qualified).toHaveLength(0);
    expect(report.symbolOutcomes).toEqual([expect.objectContaining({ symbol: 'NONE', reason: 'No qualifying candidate generated' })]);
  });

  it('creates a print-only, multi-page-capable report without network calls or interactive controls', () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', { value: fetchSpy, configurable: true });
    try {
      let session = createScanSession({ mode: 'rank', requestedStrategy: 'spreads', scope: { universeSymbols: Array.from({ length: 60 }, (_, i) => `S${i}`), eligibleSymbols: Array.from({ length: 60 }, (_, i) => `S${i}`) } });
      for (let i = 0; i < 60; i += 1) session = recordSymbolEvaluated(session, `S${i}`, [result(`S${i}`, true, i % 3 === 0 ? 'BPS' : i % 3 === 1 ? 'BCS' : 'IC')]);
      const html = buildScanPrintHtml(buildScanExportReport(completeSession(session), 'full'));
      expect(html).toContain('Qualified opportunities (60)');
      expect(html).toContain('Held LEAP short-call candidates');
      expect(html).toContain('Other non-actionable candidates');
      expect(html).toContain('Symbol outcomes and scan failures');
      expect(html).toContain('@page { size: Letter');
      expect(html).toContain('page-break-inside:avoid');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('PLACE ORDER');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true });
    }
  });
});
