/**
 * Presentation-safe economics for credit-entry positions.
 *
 * A buyback below the entry credit realizes a profit even when the order type
 * is a protective stop. UI copy must describe the signed economic outcome,
 * not assume every stop is a loss.
 */
export function creditClosePnlDollars(
  entryCreditPoints: number,
  closeDebitPoints: number,
  quantity: number,
): number {
  if (![entryCreditPoints, closeDebitPoints, quantity].every(Number.isFinite) || quantity <= 0) {
    return 0;
  }
  return Number(((entryCreditPoints - closeDebitPoints) * quantity * 100).toFixed(2));
}

export function signedDollar(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized >= 0 ? '+' : '-'}$${Math.abs(normalized).toFixed(2)}`;
}

export function protectiveStopOutcomeLabel(pnlDollars: number): string {
  return pnlDollars >= 0
    ? `protected profit ${signedDollar(pnlDollars)}`
    : `loss ${signedDollar(pnlDollars)}`;
}
