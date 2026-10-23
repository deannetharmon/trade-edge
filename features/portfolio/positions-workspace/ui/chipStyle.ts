// features/portfolio/positions-workspace/ui/chipStyle.ts
//
// PORTFOLIO-CHIPS-0001: the shared chip and control look (Dean chose "shared styles, then gradual" 2026-10-23). Cards, the Overview page and the
// toolbar controls reuse these so the new and old surfaces read as one app. Pure class strings, no behavior.

export const CONTROL_RADIUS = 'rounded-xl';

export function chipClass(active: boolean, empty: boolean): string {
  const base = `inline-flex min-h-11 items-center gap-2 ${CONTROL_RADIUS} border px-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-400`;
  if (active) return `${base} border-teal-400 bg-teal-400 text-slate-950`;
  return `${base} border-white/20 bg-white/5 ${empty ? 'text-white/50' : 'text-white'} hover:bg-white/10`;
}

export function chipCountClass(active: boolean): string {
  return `rounded-full px-2 py-0.5 text-xs font-bold ${active ? 'bg-slate-950/20 text-slate-950' : 'bg-white/10 text-white/80'}`;
}
