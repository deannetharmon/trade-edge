import { describe, expect, it } from 'vitest';
import { evaluateStandaloneLeapsStopEligibility, standaloneLeapsStopProposal } from '../standaloneLeapsStop';

const base: any = { entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 2000, quantity: 1, identity: { structureType: 'NAKED' }, structureAmbiguous: false, legs: [{ direction: 'Long', optionType: 'C' }], pairedShortCallKey: null, dte: 365 };
describe('standalone LEAPS stop policy', () => {
  it('accepts only a complete standalone long call', () => expect(evaluateStandaloneLeapsStopEligibility(base)).toBe('ELIGIBLE'));
  it('keeps PMCC long legs out of the standalone workflow', () => expect(evaluateStandaloneLeapsStopEligibility({ ...base, pairedShortCallKey: 'short-call' })).toBe('PMCC_MANAGED'));
  it.each([[25, 15], [35, 13], [50, 10]] as const)('calculates %s%% loss from a $20 debit as $%s', (loss, trigger) => expect(standaloneLeapsStopProposal(20, loss).triggerPrice).toBe(trigger));
});
