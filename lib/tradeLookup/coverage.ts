// lib/tradeLookup/coverage.ts

// TRADE-LOOKUP-0001B: can this call be placed as a covered call? Pure. The broker reads happen elsewhere.
//
// A call may go to the order dialog only if shares cover it, or a long LEAP that expires AFTER the call
// covers it. Both answers come from the existing broker-authoritative reports:
//   - shares: lib/scans/covered-call-capacity.ts  (availableCoveredContracts, already net of open and working short calls)
//   - LEAP:   lib/scans/pmcc-foundations.ts       (availableShortCallContracts per long call, ambiguity already blocked there)
// If either report is unavailable and the other does not cover the call, the answer is "unknown" and
// ordering stays off. Naked calls are never offered.

import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import type { PmccFoundationReport } from '@/lib/scans/pmcc-foundations';
import type { CoverageResult } from './lookupTypes';
import type { IsoDate, LookupStrategy } from './types';

export interface CoverageInput {
  strategy: LookupStrategy;
  symbol: string;
  contracts: number;
  /** Expiration of the call being looked up. */
  expiration: IsoDate;
  capacity: CoveredCallCapacityReport | null;
  foundations: PmccFoundationReport | null;
}

export function evaluateCoverage(input: CoverageInput): CoverageResult {
  const need = input.contracts;
  if (input.strategy === 'CSP') {
    return { status: 'not_applicable', contractsNeeded: need, canOrder: true, message: '' };
  }

  const symbol = input.symbol.toUpperCase();
  const capacityOk = !!input.capacity && input.capacity.status === 'ok';
  const foundationsOk = !!input.foundations && input.foundations.status === 'ok';

  let sharesAvailable: number | null = null;
  if (capacityOk && input.capacity) {
    const entry = input.capacity.bySymbol[symbol];
    sharesAvailable = entry ? entry.availableCoveredContracts : 0;
  }
  if (sharesAvailable !== null && sharesAvailable >= need) {
    return {
      status: 'covered_by_shares',
      contractsNeeded: need,
      canOrder: true,
      message: 'Covered by shares: ' + sharesAvailable + ' contract' + (sharesAvailable === 1 ? '' : 's') + ' available.',
    };
  }

  if (foundationsOk && input.foundations) {
    const list = input.foundations.foundations;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      // ISO dates compare correctly as strings. The LEAP must outlive the short call.
      if (f.underlyingSymbol.toUpperCase() === symbol && f.expiration > input.expiration && f.availableShortCallContracts >= need) {
        return {
          status: 'covered_by_leap',
          contractsNeeded: need,
          canOrder: true,
          message: 'Covered by your ' + f.strike + ' call LEAP expiring ' + f.expiration + ' (' + f.availableShortCallContracts + ' available).',
        };
      }
    }
  }

  if (capacityOk && foundationsOk) {
    return {
      status: 'not_covered',
      contractsNeeded: need,
      canOrder: false,
      message:
        'No share coverage. You have ' + (sharesAvailable === null ? 0 : sharesAvailable) + ' covered contract(s) available on ' + symbol +
        ' and no LEAP that expires after this call. The chain is for inspection only.',
    };
  }

  return {
    status: 'unknown',
    contractsNeeded: need,
    canOrder: false,
    message: "Couldn't verify coverage from your broker account, so ordering stays off. The chain is for inspection only.",
  };
}
