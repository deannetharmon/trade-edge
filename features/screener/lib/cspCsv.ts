import type { ScreenResult } from '@/lib/scans/types';
import type { ScreenerScanSession } from '@/lib/screener/scanSession';

export const CSP_CSV_HEADERS = ['Candidate ID','Session ID','Mode','Symbol','OCC Symbol','Expiration','DTE','Put Strike','Absolute Delta','Bid','Ask','Mid','Width $','Width % of Mid','OI','Underlying Price','OTM %','POP %','Credit per Share','Premium per Contract','Required Cash','Breakeven','Period ROC %','Annualized ROC %','Market Qualification','Mode Qualification','Mode Qualification Reasons','Account Eligibility','Overall Qualified','Warnings / Rejections','CSP Score Status','CSP Score','Rule Snapshot'] as const;

const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function buildCspCsv(results: ScreenResult[], session: ScreenerScanSession): string {
  const rows = results.map(result => {
    const c = result.bestCandidate;
    const otm = c && result.price != null && result.price > 0 ? ((result.price - c.shortStrike) / result.price) * 100 : null;
    return [result.candidateId, session.sessionId, session.mode, result.symbol, c?.shortOccSymbol, c?.expiration, c?.dte, c?.shortStrike, c ? Math.abs(c.shortDelta) : null, c?.shortBid, c?.shortAsk, c?.cspMid, c?.cspBidAskWidth, c?.cspBidAskWidthPct, c?.shortOI, result.price, otm, c?.pop, c?.cspMid, c?.cspMid != null ? c.cspMid * 100 : null, c?.requiredCash, c?.breakeven, c?.roc, c?.annualizedRoc, c?.cspMarketQualification, c?.cspModeQualification, c?.cspModeQualificationReasons?.join('; '), c?.cspAccountEligibility, result.qualified, result.failReasons.join('; '), c?.cspScore?.scoreStatus, c?.cspScore?.total, JSON.stringify(session.ruleSnapshot)].map(csv).join(',');
  });
  return [CSP_CSV_HEADERS.join(','), ...rows].join('\n');
}
