// app/api/csv/__tests__/route.test.ts
//
// CSP-WORKFLOW-0001 core-correction (BLOCKER-04 identity propagation) --
// final hop of the canonical candidateId chain: the CSV export's
// "Candidate ID" column carries ScreenResult.candidateId through unchanged
// (not re-derived, not dropped for a missing value).

import { describe, expect, it } from 'vitest';
import { POST } from '../route';

function csvRows(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));
}

describe('POST /api/csv', () => {
  it('carries each result\'s canonical candidateId through unchanged as the first CSV column', async () => {
    const results = [
      { candidateId: 'occ:AMD240119P00415000', symbol: 'AMD', strategy: 'CSP', qualified: true, price: 200, ivr: 55, bestCandidate: { expiration: '2026-01-19', dte: 30, shortStrike: 415 } },
      { candidateId: 'composite:CSP:NKE:2026-01-19:P:38', symbol: 'NKE', strategy: 'CSP', qualified: true, price: 100, ivr: 40, bestCandidate: { expiration: '2026-01-19', dte: 30, shortStrike: 38 } },
    ];
    const req = new Request('http://localhost/api/csv', {
      method: 'POST',
      body: JSON.stringify({ results }),
    }) as any;

    const res = await POST(req);
    const text = await res.text();
    const rows = csvRows(text);

    expect(rows[0][0]).toBe('Candidate ID');
    expect(rows[1][0]).toBe('occ:AMD240119P00415000');
    expect(rows[2][0]).toBe('composite:CSP:NKE:2026-01-19:P:38');
  });

  it('never fabricates a candidateId -- a result with none produces an empty (not guessed) first column', async () => {
    const results = [
      { candidateId: undefined, symbol: 'XYZ', strategy: 'BPS', qualified: false, price: 50, ivr: 20, bestCandidate: null },
    ];
    const req = new Request('http://localhost/api/csv', {
      method: 'POST',
      body: JSON.stringify({ results }),
    }) as any;

    const res = await POST(req);
    const text = await res.text();
    const rows = csvRows(text);

    expect(rows[1][0]).toBe('');
  });
});
