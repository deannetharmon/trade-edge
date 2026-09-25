// Scan-session report view model.  This module is deliberately pure: it only
// reads the completed scan snapshot and never asks the scanner, broker, or a
// market-data provider for anything.
import type { ScreenResult } from '@/lib/scans/types';
import { computeSessionAccounting, REASON_CODE_LABELS, type ScreenerScanSession } from '@/lib/screener/scanSession';

export type ScanExportScope = 'full' | 'current-view';

export interface ScanExportCandidate {
  symbol: string;
  status: 'Qualified opportunity' | 'Potential short-call candidate' | 'Other non-actionable candidate';
  strategy: string;
  details: Array<{ label: string; value: string }>;
  reasons: string[];
}

export interface ScanExportReport {
  scope: ScanExportScope;
  sessionId: string;
  completedAt: number | null;
  mode: string;
  requestedStrategy: string;
  selectedSymbols: string[];
  accounting: ReturnType<typeof computeSessionAccounting>;
  configuration: Array<{ label: string; value: string }>;
  quoteStatement: string;
  qualified: ScanExportCandidate[];
  heldLeapCandidates: ScanExportCandidate[];
  otherCandidates: ScanExportCandidate[];
  symbolOutcomes: Array<{ symbol: string; status: string; reason: string; candidateCount: number }>;
}

export interface LeapsExportRow {
  symbol: string; expiration: string; dte: number; strike: number; delta: number | null;
  openInterest: number | null; bid: number | null; ask: number | null; underlyingPrice: number | null;
  spreadPct: number | null; extrinsicValue: number | null; ivRank: number | null; ivx: number | null;
  dataQuality: 'ok' | 'insufficient'; score: number | null;
}

const unavailable = 'Not available in this scan snapshot';
const n = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? unavailable : value.toFixed(digits);
const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? unavailable : `$${value.toFixed(2)}`;
const percent = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? unavailable : `${value.toFixed(digits)}%`;

function candidateFor(result: ScreenResult): ScanExportCandidate {
  const c = result.bestCandidate;
  const pmcc = result.pmccPair;
  const heldLeap = result.pmccDecision?.entryMode === 'covered-short-call-against-held-leaps'
    || pmcc?.entryMode === 'covered-short-call-against-held-leaps';
  const status: ScanExportCandidate['status'] = heldLeap
    ? 'Potential short-call candidate'
    : result.qualified ? 'Qualified opportunity' : 'Other non-actionable candidate';
  const details: ScanExportCandidate['details'] = [
    { label: 'Underlying price', value: money(result.price) },
    { label: 'Strategy', value: result.strategy },
    { label: 'IVR', value: percent(result.ivr) },
  ];
  if (c) {
    details.push(
      { label: 'Expiration / DTE', value: `${c.expiration || unavailable} / ${c.dte ?? unavailable}` },
      { label: 'Short strike', value: n(c.shortStrike) },
      { label: 'Long strike', value: n(c.longStrike) },
      { label: 'Credit / debit', value: c.netDebit != null ? `Debit ${money(c.netDebit)}` : `Credit ${money(c.credit)}` },
      { label: 'POP / ROC', value: `${percent(c.pop)} / ${percent(c.roc)}` },
      { label: 'Short delta', value: n(c.shortDelta) },
      { label: 'Open interest', value: `${c.shortOI ?? unavailable} / ${c.longOI ?? unavailable}` },
    );
  }
  if (pmcc) {
    details.push(
      { label: 'Long LEAP', value: `${n(pmcc.longLeg.strike)} · ${pmcc.longLeg.expiration} (${pmcc.longLeg.dte} DTE)` },
      { label: heldLeap ? 'Proposed short call' : 'Short call', value: `${n(pmcc.shortLeg.strike)} · ${pmcc.shortLeg.expiration} (${pmcc.shortLeg.dte} DTE)` },
      { label: 'Quote evidence', value: `${pmcc.longLeg.quote.status} / ${pmcc.shortLeg.quote.status}` },
    );
  }
  const reasons = [
    ...result.failReasons,
    ...(result.pmccDecision?.gates.filter(g => g.status !== 'pass').map(g => `${g.code}: ${g.explanation}`) ?? []),
    ...(pmcc?.failureReasons.map(reason => `${reason.code}: ${reason.message}`) ?? []),
  ];
  return { symbol: result.symbol, status, strategy: result.strategy, details, reasons: reasons.length ? reasons : ['No adverse decision reasons recorded in this scan snapshot.'] };
}

/** Builds a report entirely from saved scan facts. No I/O or network access. */
export function buildScanExportReport(
  session: ScreenerScanSession,
  scope: ScanExportScope,
  currentViewResults?: ScreenResult[],
): ScanExportReport {
  const included = scope === 'full' ? session.results : (currentViewResults ?? session.results);
  const candidates = included.map(candidateFor);
  const heldLeapCandidates = candidates.filter(candidate => candidate.status === 'Potential short-call candidate');
  const qualified = candidates.filter(candidate => candidate.status === 'Qualified opportunity');
  const otherCandidates = candidates.filter(candidate => candidate.status === 'Other non-actionable candidate');
  const snapshot = session.ruleSnapshot;
  const configuration: ScanExportReport['configuration'] = [
    { label: 'Export scope', value: scope === 'full' ? 'Full completed scan' : 'Current filtered view' },
    { label: 'Scan mode', value: session.mode },
    { label: 'Requested strategy', value: session.requestedStrategy },
    { label: 'Selected universe', value: `${session.selectedSymbols.length} symbols: ${session.selectedSymbols.join(', ') || unavailable}` },
    { label: 'Ruleset version', value: String(session.schemaVersion) },
  ];
  if (snapshot) configuration.push(
    { label: 'DTE range', value: `${snapshot.dteMin}–${snapshot.dteMax}` },
    { label: 'IVR range', value: `${snapshot.ivrMin}–${snapshot.ivrMax}` },
    { label: 'Open-interest minimum', value: String(snapshot.oiMin) },
    { label: 'Bid/ask maximum', value: String(snapshot.bidAskMax) },
    { label: 'POP / OTM / ROC minimums', value: `${snapshot.popMin ?? unavailable} / ${snapshot.otmMin ?? unavailable} / ${snapshot.rocMin ?? unavailable}` },
  );
  if (session.targetedSnapshot) configuration.push(
    { label: 'Targeted credit/risk minimum', value: percent(session.targetedSnapshot.minimumCreditRatio * 100) },
    { label: 'Targeted preset', value: session.targetedSnapshot.preset },
  );
  const quoteStatement = session.cacheProvenance === 'idb-cache'
    ? 'CAUTION — restored scan snapshot. Quotes may be stale and are not live execution pricing.'
    : 'Quote timestamps and market status are preserved only where this scan snapshot recorded them. Revalidate before trading.';
  return {
    scope, sessionId: session.sessionId, completedAt: session.completedAt, mode: session.mode,
    requestedStrategy: session.requestedStrategy, selectedSymbols: session.selectedSymbols,
    accounting: computeSessionAccounting(session), configuration, quoteStatement,
    qualified, heldLeapCandidates, otherCandidates,
    symbolOutcomes: session.symbolOutcomes.map(outcome => ({
      symbol: outcome.symbol, status: outcome.status,
      reason: outcome.reasonCode ? REASON_CODE_LABELS[outcome.reasonCode] : 'No reason recorded',
      candidateCount: outcome.candidateCount,
    })),
  };
}

/** Standalone LEAPS uses its own persisted result cache, not ScreenerScanSession. */
export function buildLeapsExportReport(rows: LeapsExportRow[], scope: ScanExportScope, completedAt: number | null, selectedSymbols: string[]): ScanExportReport {
  const candidates: ScanExportCandidate[] = rows.map(row => ({
    symbol: row.symbol, status: row.dataQuality === 'ok' ? 'Qualified opportunity' : 'Other non-actionable candidate', strategy: 'LEAPS',
    details: [
      { label: 'Underlying price', value: money(row.underlyingPrice) }, { label: 'Expiration / DTE', value: `${row.expiration} / ${row.dte}` },
      { label: 'Strike / delta', value: `${n(row.strike)} / ${n(row.delta)}` }, { label: 'Bid / ask', value: `${money(row.bid)} / ${money(row.ask)}` },
      { label: 'Open interest', value: row.openInterest == null ? unavailable : String(row.openInterest) }, { label: 'IVR / IVx', value: `${percent(row.ivRank)} / ${percent(row.ivx)}` },
      { label: 'Score', value: n(row.score, 0) }, { label: 'Spread / extrinsic', value: `${percent(row.spreadPct)} / ${money(row.extrinsicValue)}` },
    ],
    reasons: row.dataQuality === 'ok' ? ['LEAPS candidate retained by this scan. Revalidate pricing before trading.'] : ['Missing delta or open-interest evidence in this scan snapshot.'],
  }));
  const qualified = candidates.filter(candidate => candidate.status === 'Qualified opportunity');
  const otherCandidates = candidates.filter(candidate => candidate.status === 'Other non-actionable candidate');
  return {
    scope, sessionId: 'standalone-leaps', completedAt, mode: 'leaps', requestedStrategy: 'leaps', selectedSymbols,
    accounting: { selectedCount: selectedSymbols.length, plannedCount: selectedSymbols.length, attemptedCount: selectedSymbols.length, evaluatedCount: selectedSymbols.length, failedCount: 0, skippedCount: 0, candidateCount: rows.length, qualifiedCandidateCount: qualified.length, disqualifiedCandidateCount: otherCandidates.length, accountActionableCount: qualified.length },
    configuration: [{ label: 'Export scope', value: scope === 'full' ? 'Full completed scan' : 'Current filtered view' }, { label: 'Scan mode', value: 'LEAPS' }, { label: 'Selected universe', value: `${selectedSymbols.length} symbols: ${selectedSymbols.join(', ') || unavailable}` }, { label: 'Ruleset version', value: 'Not available in this scan snapshot' }],
    quoteStatement: 'LEAPS scan snapshot. Quotes are not live execution pricing. Revalidate before trading.',
    qualified, heldLeapCandidates: [], otherCandidates, symbolOutcomes: [],
  };
}
