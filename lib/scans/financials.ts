export const STANDARD_EQUITY_OPTION_MULTIPLIER = 100;

export type OptionPriceUnit = 'per_share';

export interface CanonicalCapital {
  capitalRequired: number;
  theoreticalMaxLoss: number;
}

export interface CanonicalPmccFinancials extends CanonicalCapital {
  netDebit: number;
  netDebitUnit: 'per_share';
  contractMultiplier: number;
  quantity: number;
}

function positiveFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number.`);
  }
}

export function resolveOptionContractMultiplier(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return STANDARD_EQUITY_OPTION_MULTIPLIER;
  }
  const multiplier = Number(raw);
  positiveFinite(multiplier, 'contractMultiplier');
  return multiplier;
}

export function calculatePmccCapital(input: {
  netDebit: number;
  netDebitUnit: OptionPriceUnit;
  contractMultiplier: number;
  quantity: number;
}): CanonicalCapital {
  if (input.netDebitUnit !== 'per_share') throw new Error('Unsupported PMCC netDebit unit.');
  positiveFinite(input.netDebit, 'netDebit');
  positiveFinite(input.contractMultiplier, 'contractMultiplier');
  positiveFinite(input.quantity, 'quantity');
  const total = input.netDebit * input.contractMultiplier * input.quantity;
  positiveFinite(total, 'PMCC total net debit');
  return { capitalRequired: total, theoreticalMaxLoss: total };
}

export function buildPmccFinancialsFromQuotes(input: {
  longCostPerShare: number;
  shortCreditPerShare: number;
  contractMultiplier: number;
  quantity: number;
}): CanonicalPmccFinancials {
  positiveFinite(input.longCostPerShare, 'longCostPerShare');
  positiveFinite(input.shortCreditPerShare, 'shortCreditPerShare');
  const netDebit = Number((input.longCostPerShare - input.shortCreditPerShare).toFixed(2));
  const capital = calculatePmccCapital({
    netDebit,
    netDebitUnit: 'per_share',
    contractMultiplier: input.contractMultiplier,
    quantity: input.quantity,
  });
  return {
    netDebit,
    netDebitUnit: 'per_share',
    contractMultiplier: input.contractMultiplier,
    quantity: input.quantity,
    ...capital,
  };
}

export function calculateIronCondorCapital(input: {
  putWidth: number;
  callWidth: number;
  totalCredit: number;
  creditUnit: OptionPriceUnit;
  contractMultiplier: number;
  quantity: number;
}): CanonicalCapital {
  if (input.creditUnit !== 'per_share') throw new Error('Unsupported Iron Condor credit unit.');
  positiveFinite(input.putWidth, 'putWidth');
  positiveFinite(input.callWidth, 'callWidth');
  positiveFinite(input.totalCredit, 'totalCredit');
  positiveFinite(input.contractMultiplier, 'contractMultiplier');
  positiveFinite(input.quantity, 'quantity');
  const maximumLossPerShare = Math.max(input.putWidth, input.callWidth) - input.totalCredit;
  positiveFinite(maximumLossPerShare, 'Iron Condor maximum loss per share');
  const total = maximumLossPerShare * input.contractMultiplier * input.quantity;
  positiveFinite(total, 'Iron Condor total maximum loss');
  return { capitalRequired: total, theoreticalMaxLoss: total };
}
