// path: lib/performance/period.ts
// ANALYTICS-0001 A0: the Performance period selector's presets and date math, moved out of app/performance/page.tsx
// with no behavior change so Performance and Analytics use one definition. `today` is a New York date (YYYY-MM-DD).
// PERF-0001: one period selector for every panel. Trades are loaded once for 12 months and filtered by close date.
export type PeriodPreset = 'THIS_MONTH' | 'LAST_MONTH' | 'YTD' | '3M' | '6M' | '12M' | 'CUSTOM';
export const PERIOD_PRESETS: [PeriodPreset, string][] = [['THIS_MONTH', 'THIS MONTH'], ['LAST_MONTH', 'LAST MONTH'], ['YTD', 'YTD'], ['3M', '3 MO'], ['6M', '6 MO'], ['12M', '12 MO']];
export function presetDates(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const back = (months: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
  if (preset === 'THIS_MONTH') return { from: iso(y, m, 1), to: today };
  if (preset === 'LAST_MONTH') return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
  if (preset === 'YTD') return { from: iso(y, 1, 1), to: today };
  if (preset === '3M') return { from: back(3), to: today };
  if (preset === '6M') return { from: back(6), to: today };
  return { from: back(12), to: today };
}
