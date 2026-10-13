// lib/entry-walk/fillLog.ts
//
// ENTRY-WALK-0001 acceptance 7: every walked fill is logged with its price against the bid and mid at order time,
// so after about 20 fills we can judge whether to keep or tune the 75% start. Browser-local, best effort.

export const WALK_FILL_LOG_KEY = 'tradeedge.entryWalk.fills';
const MAX_ENTRIES = 200;

export interface WalkFillRecord {
  at: string;
  symbol: string;
  strategy: string;
  quantity: number;
  fillPrice: number;
  bidAtOrder: number;
  midAtOrder: number;
  firstPrice: number;
  /** Dollars per contract versus the bid (price - bid) x 100. */
  gainVsBidPerContract: number;
  /** Dollars per contract versus the mid (price - mid) x 100. */
  gainVsMidPerContract: number;
}

export function buildFillRecord(input: { symbol: string; strategy: string; quantity: number; fillPrice: number; bid: number; mid: number; firstPrice: number; at?: Date }): WalkFillRecord {
  return {
    at: (input.at ?? new Date()).toISOString(), symbol: input.symbol, strategy: input.strategy, quantity: input.quantity,
    fillPrice: input.fillPrice, bidAtOrder: input.bid, midAtOrder: input.mid, firstPrice: input.firstPrice,
    gainVsBidPerContract: Math.round((input.fillPrice - input.bid) * 100),
    gainVsMidPerContract: Math.round((input.fillPrice - input.mid) * 100),
  };
}

export function recordWalkFill(record: WalkFillRecord, storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage): void {
  try {
    if (!storage) return;
    const parsed = JSON.parse(storage.getItem(WALK_FILL_LOG_KEY) ?? '[]');
    const list: WalkFillRecord[] = Array.isArray(parsed) ? parsed : [];
    list.push(record);
    storage.setItem(WALK_FILL_LOG_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch { /* browser storage can be unavailable; the fill itself is already recorded at the broker */ }
}
