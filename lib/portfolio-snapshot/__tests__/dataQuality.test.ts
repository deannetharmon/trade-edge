// lib/portfolio-snapshot/__tests__/dataQuality.test.ts
// LCC-0001A PR 2 — data-quality / fail-closed status tests. Traces to
// docs/design/LCC-0001A-technical-spec.md §9 and the "Data failure" acceptance criterion.
import { describe, it, expect } from 'vitest';
import {
  buildDataQuality,
  UNATTRIBUTABLE_EXPOSURE_REASON,
  ACCOUNT_UNRESOLVED_REASON,
  POSITIONS_UNAVAILABLE_REASON,
  ORDERS_UNAVAILABLE_REASON,
  ADJUSTED_DELIVERABLE_REASON,
} from '../dataQuality';

const okShortCallResult = { bySymbol: {}, unclassifiedSymbols: new Set<string>(), hasUnattributableExposure: false, hasAdjustedOrUnknownDeliverable: false, warnings: [] };
const okWorkingCallResult = { bySymbol: {}, unclassifiedSymbols: new Set<string>(), hasUnattributableExposure: false, hasAdjustedOrUnknownDeliverable: false, warnings: [] };

describe('buildDataQuality', () => {
  it('fails closed when account identity is unresolved, before any per-symbol computation', () => {
    const result = buildDataQuality({
      accountResolved: false,
      positionsLoaded: false,
      ordersLoaded: false,
      shortCallResult: null,
      workingCallResult: null,
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe(ACCOUNT_UNRESOLVED_REASON);
  });

  it('fails closed when positions cannot be loaded (Data failure acceptance criterion, position side)', () => {
    const result = buildDataQuality({
      accountResolved: true,
      positionsLoaded: false,
      ordersLoaded: true,
      shortCallResult: null,
      workingCallResult: okWorkingCallResult,
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe(POSITIONS_UNAVAILABLE_REASON);
  });

  it('fails the entire report closed when short-call exposure is unattributable', () => {
    const result = buildDataQuality({
      accountResolved: true,
      positionsLoaded: true,
      ordersLoaded: true,
      shortCallResult: { ...okShortCallResult, hasUnattributableExposure: true, warnings: ['w1'] },
      workingCallResult: okWorkingCallResult,
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe(UNATTRIBUTABLE_EXPOSURE_REASON);
    expect(result.warnings).toContain('w1');
  });

  it('fails the entire report closed when working-order exposure is unattributable', () => {
    const result = buildDataQuality({
      accountResolved: true,
      positionsLoaded: true,
      ordersLoaded: true,
      shortCallResult: okShortCallResult,
      workingCallResult: { ...okWorkingCallResult, hasUnattributableExposure: true, warnings: ['w2'] },
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe(UNATTRIBUTABLE_EXPOSURE_REASON);
  });

  it('positions succeed but orders fail: capacity fails closed while holdings remain available to callers', () => {
    const result = buildDataQuality({
      accountResolved: true,
      positionsLoaded: true,
      ordersLoaded: false,
      shortCallResult: okShortCallResult,
      workingCallResult: null,
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe(ORDERS_UNAVAILABLE_REASON);
    expect(result.warnings).toContain(ORDERS_UNAVAILABLE_REASON);
  });

  it('fails capacity closed for adjusted deliverables', () => {
    const result = buildDataQuality({
      accountResolved: true, positionsLoaded: true, ordersLoaded: true,
      shortCallResult: { ...okShortCallResult, hasAdjustedOrUnknownDeliverable: true },
      workingCallResult: okWorkingCallResult,
    });
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: ADJUSTED_DELIVERABLE_REASON });
  });

  it('returns ok with no warnings when everything loads cleanly', () => {
    const result = buildDataQuality({
      accountResolved: true,
      positionsLoaded: true,
      ordersLoaded: true,
      shortCallResult: okShortCallResult,
      workingCallResult: okWorkingCallResult,
    });
    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
    expect(result.unavailableReason).toBeUndefined();
  });
});
