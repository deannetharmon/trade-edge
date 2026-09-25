import type { ScanExportReport } from './scanPdfExport';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function candidateHtml(candidate: ScanExportReport['qualified'][number]) {
  return `<article class="candidate"><h3>${esc(candidate.symbol)} <span>${esc(candidate.strategy)}</span></h3><p class="status">Status: ${esc(candidate.status)}</p><dl>${candidate.details.map(detail => `<div><dt>${esc(detail.label)}</dt><dd>${esc(detail.value)}</dd></div>`).join('')}</dl><p class="reasons"><strong>Decision evidence:</strong> ${candidate.reasons.map(esc).join('; ')}</p></article>`;
}

/** Pure print document generation. No React tree, broker call, or network access. */
export function buildScanPrintHtml(report: ScanExportReport): string {
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
