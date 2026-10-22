// lib/scans/buyingPowerStatus.ts
//
// OBP-LINE-0001: every order screen shows the account's option buying power next to what the order needs, so the trader sees
// the shortfall before the broker or the collateral guard says so. Pure: no fetching here.

export type BuyingPowerState = 'unknown' | 'enough' | 'short';

export interface BuyingPowerStatus {
  state: BuyingPowerState;
  /** Buying power left after this order; negative when short. Null when the broker did not report buying power. */
  remaining: number | null;
  /** How much more the order needs than is available; 0 unless short. */
  shortBy: number;
}

/** `available` is the broker's option buying power (null when not reported); `required` is what the order ties up. */
export function buyingPowerStatus(available: number | null | undefined, required: number): BuyingPowerStatus {
  if (available == null || !Number.isFinite(available) || !Number.isFinite(required)) return { state: 'unknown', remaining: null, shortBy: 0 };
  const remaining = Math.round((available - required) * 100) / 100;
  return remaining < 0 ? { state: 'short', remaining, shortBy: -remaining } : { state: 'enough', remaining, shortBy: 0 };
}
