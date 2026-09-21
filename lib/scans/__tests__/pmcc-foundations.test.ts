import { describe, expect, it } from 'vitest';
import { buildPmccFoundationReport } from '../pmcc-foundations';

const longCall = (symbol: string, quantity = 1) => ({ 'instrument-type': 'Equity Option', 'quantity-direction': 'Long', quantity, symbol, multiplier: 100 });
const shortCall = (symbol: string, quantity = 1) => ({ 'instrument-type': 'Equity Option', 'quantity-direction': 'Short', quantity, symbol, multiplier: 100 });

describe('buildPmccFoundationReport', () => {
  it('uses the exact broker long call as a capacity-bearing foundation', () => {
    const report = buildPmccFoundationReport('ACCT', [longCall('AAPL270119C00150000', 2)], []);
    expect(report).toMatchObject({ status: 'ok', foundations: [{ foundationId: 'ACCT:AAPL270119C00150000', underlyingSymbol: 'AAPL', strike: 150, expiration: '2027-01-19', contracts: 2, availableShortCallContracts: 2 }] });
  });

  it('reserves known existing and working short calls against the sole foundation', () => {
    const report = buildPmccFoundationReport('ACCT', [longCall('AAPL270119C00150000', 3), shortCall('AAPL261218C00200000')], [{ status: 'Working', legs: [{ action: 'Sell to Open', symbol: 'AAPL261225C00210000', quantity: 1, 'instrument-type': 'Equity Option' }] }]);
    expect(report.foundations[0]).toMatchObject({ availableShortCallContracts: 1, existingShortCallContracts: 1, workingShortCallContracts: 1 });
  });

  it('blocks same-underlying multi-LEAP capacity when short exposure is ambiguous', () => {
    const report = buildPmccFoundationReport('ACCT', [longCall('AAPL270119C00150000'), longCall('AAPL280119C00160000'), shortCall('AAPL261218C00200000')], []);
    expect(report.foundations.map(item => item.availableShortCallContracts)).toEqual([0, 0]);
    expect(report.warnings.join(' ')).toMatch(/cannot be attributed/i);
  });

  it('fails closed on unattributable open short exposure', () => {
    expect(buildPmccFoundationReport('ACCT', [longCall('AAPL270119C00150000'), shortCall('unknown')], []).status).toBe('unavailable');
  });
});
