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

const leapsRow = (over: Partial<Parameters<typeof buildLeapsExportReport>[0][number]> = {}) => ({
  symbol: 'QQQ', expiration: '2027-06-17', dte: 265, strike: 545, delta: .85, openInterest: 1289, bid: 219.73, ask: 223, underlyingPrice: 740.27,
  spreadPct: 1.5, extrinsicValue: 26.1, ivRank: 6, ivx: 26.3, dataQuality: 'ok' as const, score: 73, ...over,
});
const criteria = { deltaMin: .7, deltaMax: .85, dteMin: 180, dteMax: 730, oiMin: 100, extrinsicPctMax: 20, hiddenSymbols: [] as string[] };

describe('LEAPS summary table export', () => {
  it('computes cost, breakeven, ITM % of underlying and extrinsic % of cost', () => {
    const report = buildLeapsExportReport([leapsRow()], 'full', 1, ['QQQ'], 'summary', criteria);
    const row = report.leapsSummary!.qualified[0];
    expect(row.cost).toBeCloseTo(22136.5, 1);
    expect(row.breakeven).toBeCloseTo(766.365, 2);
    expect(row.breakevenPct).toBeCloseTo(3.53, 1);
    expect(row.itmPct).toBeCloseTo(26.4, 1);
    expect(row.extrinsicPctOfCost).toBeCloseTo(11.8, 1);
    expect(row.status).toBe('Q');
  });

  it('keeps one global list sorted by score with ranks, regardless of symbol', () => {
    const rows = [leapsRow({ symbol: 'AAPL', score: 60 }), leapsRow({ symbol: 'QQQ', score: 73 }), leapsRow({ symbol: 'AAPL', score: 70 })];
    const q = buildLeapsExportReport(rows, 'full', 1, ['AAPL', 'QQQ'], 'summary', criteria).leapsSummary!.qualified;
    expect(q.map(r => [r.rank, r.symbol, r.score])).toEqual([[1, 'QQQ', 73], [2, 'AAPL', 70], [3, 'AAPL', 60]]);
  });

  it('lists every failed criterion for a disqualified row', () => {
    const report = buildLeapsExportReport([leapsRow({ symbol: 'NVDA', delta: .86, openInterest: 85 })], 'full', 1, ['NVDA'], 'summary', criteria);
    const [row] = report.leapsSummary!.excluded;
    expect(row.status).toBe('DQ');
    expect(row.reasons).toEqual(['Delta 0.86 above 0.85', 'Open interest 85 below 100']);
    expect(report.leapsSummary!.qualified).toHaveLength(0);
  });

  it('marks insufficient rows DATA? naming the missing field, never a zero', () => {
    const report = buildLeapsExportReport([leapsRow({ symbol: 'MU', delta: null, dataQuality: 'insufficient', ask: null, bid: null })], 'full', 1, ['MU'], 'summary', criteria);
    const [row] = report.leapsSummary!.excluded;
    expect(row.status).toBe('DATA?');
    expect(row.reasons[0]).toContain('delta');
    expect(row.ask).toBeNull();
    expect(row.cost).toBeNull();
  });

  it('cards layout does not produce a summary, so today\'s export is unchanged', () => {
    expect(buildLeapsExportReport([leapsRow()], 'full', 1, ['QQQ'], 'cards', criteria).leapsSummary).toBeUndefined();
    expect(buildLeapsExportReport([leapsRow()], 'full', 1, ['QQQ']).leapsSummary).toBeUndefined();
  });

  it('renders landscape print HTML with counts, legend, DQ words, and no cut-off rows', () => {
    const rows = [leapsRow(), leapsRow({ symbol: 'NVDA', delta: .86, score: null }), leapsRow({ symbol: 'MU', delta: null, dataQuality: 'insufficient', score: null })];
    const html = buildScanPrintHtml(buildLeapsExportReport(rows, 'full', 1, ['QQQ', 'NVDA', 'MU'], 'summary', criteria));
    expect(html).toContain('size: Letter landscape');
    expect(html).toContain('1 qualified');
    expect(html).toContain('2 disqualified or incomplete rows included');
    expect(html).toContain('Q = qualified · DQ = disqualified · DATA? = insufficient data');
    expect(html).toContain('none are cut off');
    expect(html).toContain('>DQ<');
    expect(html).toContain('>DATA?<');
    expect(html).toContain('$22,137');
    expect(html).toContain('Research snapshot only. Quotes and eligibility are not live execution authorization.');
  });

  it('escapes HTML in symbols and reasons', () => {
    const html = buildScanPrintHtml(buildLeapsExportReport([leapsRow({ symbol: '<b>X' })], 'full', 1, [], 'summary', criteria));
    expect(html).not.toContain('<b>X');
  });
});

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
