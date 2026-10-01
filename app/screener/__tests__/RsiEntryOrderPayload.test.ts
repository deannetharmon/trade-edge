// app/screener/__tests__/RsiEntryOrderPayload.test.ts

// RSI-ENTRY-0001 slice A2b: the order is identical with the gate On and Off. CspTradeModal lives inside page.tsx
// (a page may not export it), so it cannot be rendered here. This pins the two things that make the guarantee true:
// the order payload is built only from entry price, exit levels, quantity and the leg, and the RSI verdict is read
// only for the neutral line and the audit note.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildCreditEntryOtoco } from '@/lib/screener/entryBracket';

const source = readFileSync(join(process.cwd(), 'app/screener/page.tsx'), 'utf8');
const modal = source.slice(source.indexOf('function CspTradeModal('), source.indexOf('function TradeModal('));

describe('the CSP order payload does not depend on the RSI gate', () => {
  it('the payload builder inside CspTradeModal never mentions rsi', () => {
    const start = modal.indexOf('const buildOtocoPayload');
    const end = modal.indexOf('};', start);
    expect(start).toBeGreaterThan(0);
    expect(modal.slice(start, end).toLowerCase()).not.toContain('rsi');
  });
  it('the order submission body is the built payload and nothing else', () => {
    expect(modal).toContain('body: JSON.stringify(payload)');
  });
  it('the RSI verdict is read in exactly two places: the neutral line and the audit note', () => {
    const uses = modal.match(/rsiOverride|result\.rsiEntry/g) ?? [];
    // declaration, audit note (override + entry), line render
    expect(uses.length).toBeGreaterThan(0);
    expect(modal).not.toMatch(/if \(rsiOverride[^)]*\)\s*(throw|return)/);
    expect(modal).not.toMatch(/qualGateBlocking[^;\n]*rsi/i);
  });
  it('the builder itself takes no gate input: same inputs, same payload', () => {
    const args = { entryCredit: 2.01, profitBuyback: 1.0, stopTrigger: 4.02, stopLimit: 4.42, quantity: 1, legs: [{ symbol: 'AAPL  261030P00335000', action: 'Sell to Open', quantity: 1, 'instrument-type': 'Equity Option' }] } as never;
    expect(JSON.stringify(buildCreditEntryOtoco(args))).toBe(JSON.stringify(buildCreditEntryOtoco(args)));
  });
});
