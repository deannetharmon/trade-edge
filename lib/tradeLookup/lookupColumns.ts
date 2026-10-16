// lib/tradeLookup/lookupColumns.ts

// TRADE-LOOKUP-0001D: the chain table's columns and which are shown. Same pattern as Portfolio's "Customize columns"
// (a checkbox per column with its group, a locked first column, a reset), applied to the lookup's own column ids.
// Max risk is hidden by default and always shown in the Selected bar instead.

export type LookupColumnId =
  | 'strike' | 'expiration' | 'delta' | 'pop' | 'credit' | 'bidAsk' | 'breakeven' | 'openInterest'
  | 'creditVsPick' | 'popVsPick' | 'maxRisk' | 'flags';

export const LOOKUP_COLUMNS: ReadonlyArray<{ id: LookupColumnId; label: string; group: string }> = [
  { id: 'strike', label: 'Strike', group: 'Contract' },
  { id: 'expiration', label: 'Exp / DTE', group: 'Contract' },
  { id: 'delta', label: 'Delta', group: 'Risk' },
  { id: 'pop', label: 'POP', group: 'Risk' },
  { id: 'credit', label: 'Credit (mid / natural)', group: 'Economics' },
  { id: 'bidAsk', label: 'Bid / Ask', group: 'Economics' },
  { id: 'breakeven', label: 'Breakeven', group: 'Economics' },
  { id: 'maxRisk', label: 'Max risk', group: 'Economics' },
  { id: 'openInterest', label: 'Open interest', group: 'Liquidity' },
  { id: 'creditVsPick', label: 'Credit vs pick', group: 'Compare' },
  { id: 'popVsPick', label: 'POP vs pick', group: 'Compare' },
  { id: 'flags', label: 'Flags', group: 'Compare' },
];

export const DEFAULT_LOOKUP_COLUMNS: LookupColumnId[] = [
  'strike', 'expiration', 'delta', 'pop', 'credit', 'bidAsk', 'breakeven', 'openInterest', 'creditVsPick', 'popVsPick', 'flags',
];

export const LOCKED_COLUMN: LookupColumnId = 'strike';
export const LOOKUP_COLUMNS_STORAGE_KEY = 'tradeedge.tradeLookup.columns.v1';

/** Keeps only known ids, in table order, with the strike column always present. Anything unusable falls back to the default. */
export function sanitizeLookupColumns(value: unknown): LookupColumnId[] {
  if (!Array.isArray(value)) return DEFAULT_LOOKUP_COLUMNS.slice();
  const wanted: string[] = value.filter(function (v): v is string { return typeof v === 'string'; });
  const out: LookupColumnId[] = [];
  for (let i = 0; i < LOOKUP_COLUMNS.length; i++) {
    const id = LOOKUP_COLUMNS[i].id;
    if (id === LOCKED_COLUMN || wanted.indexOf(id) !== -1) out.push(id);
  }
  return out.length >= 2 ? out : DEFAULT_LOOKUP_COLUMNS.slice();
}

export function toggleLookupColumn(current: LookupColumnId[], id: LookupColumnId): LookupColumnId[] {
  if (id === LOCKED_COLUMN) return current;
  return sanitizeLookupColumns(current.indexOf(id) === -1 ? current.concat([id]) : current.filter(function (c) { return c !== id; }));
}

export function loadLookupColumns(): LookupColumnId[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LOOKUP_COLUMNS_STORAGE_KEY) : null;
    return raw ? sanitizeLookupColumns(JSON.parse(raw)) : DEFAULT_LOOKUP_COLUMNS.slice();
  } catch {
    return DEFAULT_LOOKUP_COLUMNS.slice();
  }
}

export function saveLookupColumns(columns: LookupColumnId[]): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LOOKUP_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Storage can be blocked; the table still works with the choice kept in memory.
  }
}
