// features/screener/lib/printScanPdfReport.ts

import type { LeapsSummaryRow, ScanExportReport } from './scanPdfExport';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function candidateHtml(candidate: ScanExportReport['qualified'][number]) {
  return `<article class="candidate"><h3>${esc(candidate.symbol)} <span>${esc(candidate.strategy)}</span></h3><p class="status">Status: ${esc(candidate.status)}</p><dl>${candidate.details.map(detail => `<div><dt>${esc(detail.label)}</dt><dd>${esc(detail.value)}</dd></div>`).join('')}</dl><p class="reasons"><strong>Decision evidence:</strong> ${candidate.reasons.map(esc).join('; ')}</p></article>`;
}

const dash = '–';
const fixed = (value: number | null, digits = 2) => value == null ? dash : value.toFixed(digits);
const pct = (value: number | null, digits = 1) => value == null ? dash : `${value.toFixed(digits)}%`;
const cost = (value: number | null) => value == null ? dash : `$${Math.round(value).toLocaleString('en-US')}`;

function summaryRowHtml(row: LeapsSummaryRow) {
  const breakeven = row.breakeven == null ? dash : `${row.breakeven.toFixed(2)}${row.breakevenPct == null ? '' : ` (${row.breakevenPct >= 0 ? '+' : ''}${row.breakevenPct.toFixed(1)}%)`}`;
  return `<tr><td>${row.rank}</td><td>${esc(row.symbol)}</td><td>${esc(row.contract)}</td><td>${row.dte}</td><td>${fixed(row.delta)}</td><td>${fixed(row.ask)}</td><td>${cost(row.cost)}</td><td>${esc(breakeven)}</td><td>${pct(row.itmPct)}</td><td>${pct(row.extrinsicPctOfCost)}</td><td>${pct(row.spreadPct)}</td><td>${row.openInterest ?? dash}</td><td>${pct(row.ivRank, 0)}</td><td class="score">${fixed(row.score, 0)}</td><td>${esc(row.status)}</td></tr>`;
}

function excludedRowHtml(row: LeapsSummaryRow) {
  return `<tr class="dq"><td>${esc(row.symbol)}</td><td>${esc(row.contract)}</td><td>${row.dte}</td><td>${fixed(row.delta)}</td><td>${fixed(row.ask)}</td><td>${row.openInterest ?? dash}</td><td>${fixed(row.score, 0)}</td><td>${esc(row.status)}</td><td class="reason">${esc(row.reasons.join('; '))}</td></tr>`;
}

function buildLeapsSummaryPrintHtml(report: ScanExportReport): string {
  const summary = report.leapsSummary!;
  const completed = report.completedAt == null ? 'Not available in this scan snapshot' : new Date(report.completedAt).toLocaleString();
  const shown = summary.qualified.length + summary.excluded.length;
  const scopeLabel = report.scope === 'full' ? 'Full completed scan' : 'Current filtered view';
  return `<!doctype html><html><head><title>TradeEdge Scan Report</title><style>
    @page { size: Letter landscape; margin: .4in .4in .55in; @bottom-right { content: 'Page ' counter(page) ' of ' counter(pages); font: 7pt Arial,sans-serif; color:#40566d; } }
    * { box-sizing: border-box; } body { color:#102033;font:7.6pt Arial,sans-serif;line-height:1.25; } h1 { margin:0;color:#087f70;font-size:12pt; } .sub { color:#40566d;margin:2px 0 6px; }
    .strip { display:grid;grid-template-columns:repeat(${summary.criteria.length + 1},1fr);gap:2px 10px;color:#40566d;border-bottom:1px solid #ccd5dd;padding:4px 0 6px; } .strip b { display:block;color:#102033; }
    .warning { border-left:4px solid #ad6400;background:#fff8e5;padding:5px 8px;margin:6px 0;font-weight:bold;color:#4a3300; } .legend { color:#40566d;margin:4px 0; }
    h2 { border-bottom:2px solid #087f70;margin:9px 0 4px;padding-bottom:2px;font-size:9pt; }
    table { border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums; } thead { display:table-header-group; } tr { break-inside:avoid;page-break-inside:avoid; }
    th { color:#40566d;text-align:right;border-bottom:1px solid #9aaabb;padding:2px 4px;white-space:nowrap; } td { text-align:right;border-bottom:1px solid #e3e9ef;padding:2px 4px;white-space:nowrap; }
    th:nth-child(-n+2),td:nth-child(-n+2) { text-align:left; } td.score { font-weight:bold;color:#087f70; }
    tr.dq td { color:#5b6b7c; } tr.dq td:nth-child(8) { font-weight:bold;color:#7a3b00; } table.excluded th:nth-child(3),table.excluded td:nth-child(3) { text-align:right; } th.reason,td.reason { text-align:left;white-space:normal; }
    footer { position:fixed;bottom:0;left:0;right:0;border-top:1px solid #9aaabb;padding-top:3px;font-size:6.5pt;color:#40566d; }
  </style></head><body><header><h1>TradeEdge Scan Report · LEAPS</h1>
  <div class="sub">${esc(scopeLabel)} · completed ${esc(completed)} · sorted by score · <b>${summary.qualified.length} qualified</b> · ${summary.excluded.length} disqualified or incomplete rows included</div>
  <div class="strip">${summary.criteria.map(item => `<span>${esc(item.label)}<b>${esc(item.value)}</b></span>`).join('')}<span>Symbols<b>${report.selectedSymbols.length} scanned</b></span></div>
  <div class="warning">${esc(report.quoteStatement)}</div>
  <div class="legend">Status: Q = qualified · DQ = disqualified · DATA? = insufficient data (missing field named in Reason). ITM % is measured against the underlying price. Cost is mid price × 100. All ${shown} rows are included; none are cut off.</div></header>
  <h2>Qualified contracts (${summary.qualified.length})</h2>
  ${summary.qualified.length ? `<table><thead><tr><th>#</th><th>Symbol</th><th>Contract</th><th>DTE</th><th>Δ</th><th>Ask</th><th>Cost</th><th>Breakeven</th><th>ITM % of underlying</th><th>Ext % cost</th><th>Spread</th><th>OI</th><th>IVR</th><th>Score</th><th>Status</th></tr></thead><tbody>${summary.qualified.map(summaryRowHtml).join('')}</tbody></table>` : '<p>No qualified contracts.</p>'}
  <h2>Disqualified or incomplete contracts (${summary.excluded.length}): each row shows why</h2>
  ${summary.excluded.length ? `<table class="excluded"><thead><tr><th>Symbol</th><th>Contract</th><th>DTE</th><th>Δ</th><th>Ask</th><th>OI</th><th>Score</th><th>Status</th><th class="reason">Reason</th></tr></thead><tbody>${summary.excluded.map(excludedRowHtml).join('')}</tbody></table>` : '<p>No disqualified or incomplete contracts.</p>'}
  <footer>Research snapshot only. Quotes and eligibility are not live execution authorization. Revalidate before trading. · TradeEdge research snapshot</footer></body></html>`;
}

/** Pure print document generation. No React tree, broker call, or network access. */
export function buildScanPrintHtml(report: ScanExportReport): string {
  if (report.leapsSummary) return buildLeapsSummaryPrintHtml(report);
  const completed = report.completedAt == null ? 'Not available in this scan snapshot' : new Date(report.completedAt).toLocaleString();
  const accounting = report.accounting;
  const section = (title: string, candidates: ScanExportReport['qualified']) => `<section><h2>${esc(title)} (${candidates.length})</h2>${candidates.length ? candidates.map(candidateHtml).join('') : '<p>No results in this section.</p>'}</section>`;
  return `<!doctype html><html><head><title>TradeEdge Scan Report</title><style>
    @page { size: Letter; margin: .55in; } * { box-sizing: border-box; } body { color:#102033;font:10pt Arial,sans-serif; line-height:1.35; } h1 { margin:0;color:#087f70;font-size:20pt; } h2 { border-bottom:2px solid #087f70;margin:22px 0 8px;padding-bottom:3px;font-size:13pt; } h3 { margin:0 0 3px;font-size:11pt; } h3 span,.status { color:#40566d;font-size:9pt; } .warning { border-left:4px solid #ad6400;background:#fff8e5;padding:8px;margin:8px 0;font-weight:bold; } .summary,.configuration { display:grid;grid-template-columns:repeat(2,1fr);gap:5px 16px;margin:12px 0; } .summary div,.configuration div { break-inside:avoid; } dt { color:#516478;font-weight:bold; } dd { margin:0; } .candidate { border:1px solid #b9c5d0;border-radius:4px;padding:9px;margin:8px 0;break-inside:avoid;page-break-inside:avoid; } .candidate dl { display:grid;grid-template-columns:repeat(2,1fr);gap:4px 15px;margin:7px 0; } .reasons { margin:7px 0 0; } table { border-collapse:collapse;width:100%; } th,td { border-bottom:1px solid #ccd5dd;padding:5px;text-align:left;vertical-align:top; } th { color:#40566d; } header { border-bottom:1px solid #9aaabb;padding-bottom:8px; } footer { position:fixed;bottom:0;left:0;right:0;border-top:1px solid #9aaabb;padding-top:4px;font-size:8pt;color:#40566d; } @media print { footer:after { content:'TradeEdge research snapshot'; float:right; } }
  </style></head><body><header><h1>TradeEdge Scan Report</h1><p><strong>${esc(report.requestedStrategy.toUpperCase())}</strong> · ${esc(report.mode)} scan · completed ${esc(completed)}</p><div class="warning">${esc(report.quoteStatement)}</div></header>
  <h2>Scan configuration and accounting</h2><div class="configuration">${report.configuration.map(item => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join('')}</div><div class="summary"><div><dt>Selected / planned / attempted</dt><dd>${accounting.selectedCount} / ${accounting.plannedCount} / ${accounting.attemptedCount}</dd></div><div><dt>Evaluated / failed / skipped</dt><dd>${accounting.evaluatedCount} / ${accounting.failedCount} / ${accounting.skippedCount}</dd></div><div><dt>Qualified / non-actionable</dt><dd>${accounting.qualifiedCandidateCount} / ${accounting.disqualifiedCandidateCount}</dd></div><div><dt>Candidate structures</dt><dd>${accounting.candidateCount}</dd></div></div>
  ${section('Qualified opportunities', report.qualified)}${section('Held LEAP short-call candidates', report.heldLeapCandidates)}${section('Other non-actionable candidates', report.otherCandidates)}
  <section><h2>Symbol outcomes and scan failures (${report.symbolOutcomes.length})</h2><table><thead><tr><th>Symbol</th><th>Outcome</th><th>Reason</th><th>Candidate count</th></tr></thead><tbody>${report.symbolOutcomes.map(outcome => `<tr><td>${esc(outcome.symbol)}</td><td>${esc(outcome.status)}</td><td>${esc(outcome.reason)}</td><td>${outcome.candidateCount}</td></tr>`).join('')}</tbody></table></section>
  <footer>Research snapshot only. Quotes and eligibility are not live execution authorization. Revalidate before trading.</footer></body></html>`;
}

/** Opens a self-contained print-only document; it does not fetch or mutate scan data. */
export function printScanPdfReport(report: ScanExportReport): boolean {
  if (typeof window === 'undefined') return false;
  // Keep a same-origin handle long enough to write the self-contained report,
  // then sever the opener before printing it.
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.opener = null;
  printWindow.document.write(buildScanPrintHtml(report));
  printWindow.document.close();
  printWindow.onload = () => printWindow.print();
  return true;
}
