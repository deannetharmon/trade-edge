import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { results } = await req.json();

  // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — Candidate ID is the
  // canonical ScreenResult.candidateId, propagated through unchanged so a
  // CSV row is unambiguously traceable back to its exact originating
  // contract.
  const headers = [
    'Candidate ID', 'Symbol', 'Strategy', 'Qualified', 'Price', 'IVR',
    'Expiration', 'DTE', 'Short Strike', 'Long Strike',
    'Short Delta', 'Credit', 'ROC %', 'POP %', 'Short OI', 'Long OI',
    'Short Call Strike', 'Long Call Strike', 'Call Credit', 'Total Credit',
    'Fail Reasons'
  ];

  const rows = results.map((r: any) => {
    const c = r.bestCandidate;
    return [
      r.candidateId || '',
      r.symbol,
      r.strategy,
      r.qualified ? 'YES' : 'NO',
      r.price != null ? r.price.toFixed(2) : '',
      r.ivr != null ? r.ivr.toFixed(1) : '',
      c?.expiration || '',
      c?.dte || '',
      c?.shortStrike || '',
      c?.longStrike || '',
      c?.shortDelta?.toFixed(2) || '',
      c?.credit?.toFixed(2) || '',
      c?.roc?.toFixed(0) || '',
      c?.pop != null ? c.pop.toFixed(0) : '',
      c?.shortOI || '',
      c?.longOI || '',
      c?.shortCallStrike || '',
      c?.longCallStrike || '',
      c?.callCredit?.toFixed(2) || '',
      c?.totalCredit?.toFixed(2) || '',
      r.failReasons?.join('; ') || '',
    ].map(v => `"${v}"`).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="hunter-screen-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
