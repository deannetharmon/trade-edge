// app/screener/__tests__/CspRankBadgeWiring.test.ts

// CSP-RANK-BADGE-0001 -- the generic rank model (scoreCandidate) is
// spread-oriented and has no CSP branch, so a qualified CSP card showed
// "Qualified", "35 — Marginal" and "CSP 81" side by side, plus a tier-coloured
// left edge. ResultCard is a local function inside page.tsx, so this follows
// the source-wiring convention of OiAndSortWiring.test.tsx.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');

describe('CSP-RANK-BADGE-0001: CSP cards never carry the generic rank score', () => {
  it('ResultCard skips scoreCandidate for CSP, so the tier badge, tier edge and score panel all drop out', () => {
    expect(src).toContain(
      "const scored = rankConfig && c?.strategy !== 'CSP' ? scoreCandidate(result, rankConfig) : null;",
    );
    expect(src).toContain('const light = scored ? trafficLight(scored.score, rankConfig!) : null;');
  });

  it('the tier badge and the left-edge colour read only from scored/light, never from a second scoreCandidate call', () => {
    const start = src.indexOf('function GenericResultCard(');
    const end = src.indexOf('\nfunction ', start + 1);
    const card = src.slice(start, end);
    const direct = card.match(/scoreCandidate\(result,/g) ?? [];
    expect(direct).toHaveLength(1);
    expect(card).toMatch(/const scoreBorderL = [\s\S]*?: light\s*\?/);
  });

  it('CSP keeps its own authoritative score badge', () => {
    expect(src).toContain("c?.strategy === 'CSP' && c.cspScore?.scoreStatus === 'AVAILABLE'");
    expect(src).toContain("<span className=\"font-bold text-[9px]\">{cspScore ?? '—'}</span>");
  });
});
