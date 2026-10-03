// lib/discovery/index.ts

// LEAPS-QV-0001 Gate 1 -- public surface of the TradeEdge Discovery Strategy Engine foundation.
// This module is isolated: it imports nothing from the rest of lib/, and nothing in the existing Find LEAPS
// code imports it. QV investment logic (thresholds, scoring, valuation, technicals, scenarios) is NOT here.

export * from './util';
export * from './strategy';
export * from './qvIdentity';
export * from './metrics';
export * from './reasonCodes';
export * from './lifecycle';
export * from './transitions';
export * from './evaluation';
export * from './snapshot';
export * from './candidate';
export * from './observability';
export * from './normalized';
export * from './qv';
