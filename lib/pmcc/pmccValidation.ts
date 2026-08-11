// lib/pmcc/pmccValidation.ts

export interface PmccLegInput {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: 'C' | 'P';
  delta: number;
  bid: number;
  ask: number;
  action: 'BTO' | 'STO';
}

export interface PmccStructureValidation {
  isValid: boolean;
  netDebit: number;
  spreadWidth: number;
  blockingReason: string | null;
}

export function validatePmccStructure(
  longLeg: PmccLegInput,
  shortLeg: PmccLegInput
): PmccStructureValidation {
  const spreadWidth = Math.abs(shortLeg.strike - longLeg.strike);
  const netDebit = parseFloat((longLeg.ask - shortLeg.bid).toFixed(2));

  let blockingReason: string | null = null;

  if (spreadWidth <= netDebit) {
    blockingReason = `Spread width ($${spreadWidth}) must exceed net debit paid ($${netDebit}) to prevent a locked-in loss on assignment.`;
  } else if (longLeg.delta < 0.80) {
    blockingReason = `LEAP delta (${longLeg.delta}) is below the 0.80 threshold for reliable stock replacement.`;
  } else if (shortLeg.delta > 0.35) {
    blockingReason = `Short call delta (${shortLeg.delta}) is too high; target 0.30 or lower.`;
  }

  return {
    isValid: blockingReason === null,
    netDebit,
    spreadWidth,
    blockingReason,
  };
}
