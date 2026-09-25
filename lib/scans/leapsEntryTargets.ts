// lib/scans/leapsEntryTargets.ts
//
// The default window for NEW LEAPS entries (the LEAPS screen and the long leg of a new PMCC):
// 12 to 18 months, about 365 to 545 days. This is a starting filter the trader adjusts with the
// chips, not a qualification rule. It is deliberately separate from DEFAULT_PMCC_DTE_RANGES.longMin/
// longMax (180 to 730), which are the wider bounds used to recognize and evaluate LEAPS a trader
// already holds; those age below 365 days and must not fall out of view.
//
// Change the numbers here and every LEAPS default and chip follows.

/** New-entry LEAP DTE window, in days. */
export const LEAP_ENTRY_DTE_TARGET: { readonly min: number; readonly max: number } = { min: 365, max: 545 };

/** Chip options on the LEAPS screen. The target window's ends must be chips, so the defaults show as selected. */
export const LEAPS_DTE_MIN_CHIPS: readonly number[] = [90, 120, 180, 270, 365];
export const LEAPS_DTE_MAX_CHIPS: readonly number[] = [365, 455, 545, 640, 730];
