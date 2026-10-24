// features/portfolio/positions-workspace/model/positionsViewSetting.ts
//
// POSITIONS-CARDS-0001 opt-in safety: Cards are never the default. The Profile page "Positions view" setting picks Table (default), Cards,
// or Last used; it is a per-browser preference like the other table preferences. An environment kill switch hides Cards entirely.
// Missing, corrupt or unknown stored values always resolve to Table.

export type PositionsView = 'table' | 'cards';
export type PositionsViewSetting = 'table' | 'cards' | 'last';

export const POSITIONS_VIEW_KEY = 'tradeedge:positions-view:v1';

export interface PositionsViewStored { setting: PositionsViewSetting; last: PositionsView }
export const DEFAULT_POSITIONS_VIEW_STORED: PositionsViewStored = { setting: 'table', last: 'table' };

/** NEXT_PUBLIC_POSITIONS_CARDS_DISABLED=true hides Cards everywhere (same flag style as the workspace V2 switch). */
export function isCardsDisabled(value = process.env.NEXT_PUBLIC_POSITIONS_CARDS_DISABLED): boolean {
  return value === 'true';
}

export function decodePositionsViewStored(raw: string | null): PositionsViewStored {
  if (!raw) return DEFAULT_POSITIONS_VIEW_STORED;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const setting: PositionsViewSetting = value.setting === 'cards' || value.setting === 'last' ? value.setting : 'table';
    const last: PositionsView = value.last === 'cards' ? 'cards' : 'table';
    return { setting, last };
  } catch { return DEFAULT_POSITIONS_VIEW_STORED; }
}

/** The view to open with. The kill switch always wins. */
export function resolvePositionsView(stored: PositionsViewStored, cardsDisabled: boolean): PositionsView {
  if (cardsDisabled) return 'table';
  if (stored.setting === 'cards') return 'cards';
  if (stored.setting === 'last') return stored.last;
  return 'table';
}

export function loadPositionsViewStored(): PositionsViewStored {
  if (typeof window === 'undefined') return DEFAULT_POSITIONS_VIEW_STORED;
  try { return decodePositionsViewStored(window.localStorage.getItem(POSITIONS_VIEW_KEY)); }
  catch { return DEFAULT_POSITIONS_VIEW_STORED; }
}

export function savePositionsViewStored(value: PositionsViewStored): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(POSITIONS_VIEW_KEY, JSON.stringify(value)); } catch { /* UI preferences never block holdings. */ }
}
