// lib/market-movers/gates.ts

import type { Gate, MacroEvent, MarketMoversSettings } from './types';

const MS_DAY = 86_400_000;

function utcMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/** Day of week for a YYYY-MM-DD string, 0 = Sunday. Date-string math only, so the viewer's time zone cannot shift it. */
export function dayOfWeek(date: string): number | null {
  const ms = utcMs(date);
  return ms == null ? null : new Date(ms).getUTCDay();
}

const LABEL = { FOMC: 'FOMC decision', CPI: 'CPI report', JOBS: 'Jobs report' } as const;

/**
 * Macro gate. `today` is the New York calendar date. Fails closed: an unreadable date, or an event list with
 * no entry in the next 30 days, is No-go ("calendar stale").
 */
export function evaluateMacroGate(today: string, events: MacroEvent[], settings: MarketMoversSettings): Gate {
  const todayMs = utcMs(today);
  if (todayMs == null) return { id: 'macro', status: 'NO_GO', reason: 'Data unavailable: today\'s date could not be read.' };

  const covered = events.some((e) => {
    const ms = utcMs(e.date);
    return ms != null && ms >= todayMs && ms <= todayMs + 30 * MS_DAY;
  });
  if (!covered) return { id: 'macro', status: 'NO_GO', reason: 'Calendar stale: no macro events listed in the next 30 days.' };

  for (const e of events) {
    if (e.date === today && settings.macroToggles[e.kind]) {
      return { id: 'macro', status: 'NO_GO', reason: `${LABEL[e.kind]} today.` };
    }
  }
  if (settings.macroToggles.JOBLESS_CLAIMS && dayOfWeek(today) === 4) {
    return { id: 'macro', status: 'NO_GO', reason: 'Jobless claims report today (Thursday).' };
  }
  return { id: 'macro', status: 'GO', reason: 'No macro event today.' };
}

/** VIX gate. Missing quote is No-go. */
export function evaluateVixGate(last: number | null, priorClose: number | null, settings: MarketMoversSettings): Gate {
  if (last == null || priorClose == null || !Number.isFinite(last) || !Number.isFinite(priorClose) || priorClose <= 0) {
    return { id: 'vix', status: 'NO_GO', reason: 'Data unavailable: VIX could not be read.' };
  }
  const change = ((last - priorClose) / priorClose) * 100;
  const shown = `${last.toFixed(1)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}% today)`;
  if (last >= settings.vixNoGoLevel) return { id: 'vix', status: 'NO_GO', reason: `VIX ${shown} is at or above ${settings.vixNoGoLevel}.` };
  if (change >= settings.vixNoGoDayChangePct) return { id: 'vix', status: 'NO_GO', reason: `VIX ${shown} is up ${settings.vixNoGoDayChangePct}% or more on the day.` };
  if (last >= settings.vixAmberLevel) return { id: 'vix', status: 'AMBER', reason: `VIX ${shown} is elevated (${settings.vixAmberLevel} to ${settings.vixNoGoLevel}).` };
  return { id: 'vix', status: 'GO', reason: `VIX ${shown}.` };
}

/** Today's volume as a multiple of the 20-day average, or null when either figure is missing or not positive. */
export function volumeMultiple(volume: number | null, avg20: number | null): number | null {
  if (volume == null || avg20 == null || !Number.isFinite(volume) || !Number.isFinite(avg20) || avg20 <= 0 || volume < 0) return null;
  return volume / avg20;
}

/**
 * Volume tile: the highest multiple among the tickers shown, as in the approved mock. Any ticker at or above the
 * limit is No-go; no readable ticker is No-go (data unavailable).
 */
export function evaluateVolumeGate(
  multiples: Array<{ symbol: string; multiple: number | null }>,
  settings: MarketMoversSettings,
): Gate {
  const known = multiples.filter((m): m is { symbol: string; multiple: number } => m.multiple != null);
  if (known.length === 0) return { id: 'volume', status: 'NO_GO', reason: 'Data unavailable: volume could not be read.' };
  const top = known.reduce((a, b) => (b.multiple > a.multiple ? b : a));
  const text = `Highest ticker vs its 20-day average (${top.symbol}) is ${top.multiple.toFixed(1)}x. No-go at ${settings.volumeNoGoMultiple}x.`;
  return { id: 'volume', status: top.multiple >= settings.volumeNoGoMultiple ? 'NO_GO' : 'GO', reason: text };
}

/** Overall: any No-go means no trade; otherwise Amber if any tile is amber. */
export function overallStatus(gates: Gate[]): 'GO' | 'AMBER' | 'NO_GO' {
  if (gates.some((g) => g.status === 'NO_GO')) return 'NO_GO';
  if (gates.some((g) => g.status === 'AMBER')) return 'AMBER';
  return 'GO';
}
