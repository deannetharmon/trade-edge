// lib/portfolio/__tests__/stockAnalysis.test.ts

import { describe, expect, it } from 'vitest';
import { buildStockAnalysisPrompt, buildStockChatContext, parseStockAnalysis } from '../stockAnalysis';

const row: any = {
  key: 'equity:UBER:long', symbol: 'UBER', direction: 'Long', shares: 100, price: 82.5, avgCost: 70, value: 8250, pnl: 1250, pnlPct: 17.857,
  covered: { headline: '1 of 1 contract available', detail: null }, stale: false, sellable: { maxSellableShares: 100 },
};

describe('stock analysis prompt', () => {
  it('uses the holding figures and flags unknowns', () => {
    const p = buildStockAnalysisPrompt(row, { nextEarnings: '2026-11-04' });
    expect(p).toContain('Symbol: UBER');
    expect(p).toContain('Average cost: $70.00');
    expect(p).toContain('Unrealized P/L: $1250.00 (17.9%)');
    expect(p).toContain('Next earnings: 2026-11-04');
    const q = buildStockAnalysisPrompt({ ...row, avgCost: null, pnl: null, pnlPct: null, price: null });
    expect(q).toContain('unknown (basis incomplete)');
    expect(q).toContain('Price now: unknown');
  });
  it('includes the note as context, not command', () => {
    expect(buildStockAnalysisPrompt(row, { note: 'hold for 2027' })).toContain('hold for 2027');
  });
});

describe('parseStockAnalysis', () => {
  it('reads a good reply', () => {
    const a = parseStockAnalysis(JSON.stringify({ recommendation: 'sell covered call', confidence: 'medium', summary: 's', reasoning: 'r', risks: ['a', 3], catalysts: [], flipIf: ' x ' }), row, new Date('2026-10-22T00:00:00Z'));
    expect(a).toMatchObject({ rowKey: 'equity:UBER:long', recommendation: 'SELL_COVERED_CALL', confidence: 'MEDIUM', risks: ['a'], flipIf: 'x' });
  });
  it('falls back on unknown values', () => {
    const a = parseStockAnalysis('{"recommendation":"YOLO"}', row);
    expect(a.recommendation).toBe('WATCH');
    expect(a.confidence).toBe('LOW');
  });
  it('rejects unreadable replies', () => {
    expect(() => parseStockAnalysis('nope', row)).toThrow();
  });
});

describe('stock follow-up chat context', () => {
  const analysis = parseStockAnalysis(JSON.stringify({ recommendation: 'sell covered call', confidence: 'medium', summary: 'Sell a call.', reasoning: 'Because.', risks: ['gap down'], catalysts: ['IV rich'], flipIf: 'price drops 10%' }), row, new Date('2026-10-23T12:00:00Z'));
  it('carries the holding figures and the analysis already given, so follow-ups are answered in context', () => {
    const c = buildStockChatContext(row, analysis, { intent: 'wheel', nextEarnings: '2026-11-04', note: 'hold for 2027' });
    expect(c).toContain('Symbol: UBER');
    expect(c).toContain('Average cost: $70.00');
    expect(c).toContain('Recommendation: SELL COVERED CALL (MEDIUM confidence)');
    expect(c).toContain('Would change the call: price drops 10%');
    expect(c).toContain('Stated intent: wheel');
    expect(c).toContain('hold for 2027');
    expect(c).toContain('Do not claim any order was prepared');
  });
  it('says unknown rather than guessing when figures are missing', () => {
    expect(buildStockChatContext({ ...row, avgCost: null, price: null }, analysis)).toContain('Average cost: unknown (basis incomplete)');
  });
});
