// features/portfolio/positions-workspace/LeapRsi.tsx

// STOCK-RSI-0002 -- RSI on a held LEAP call's card, so Dean can see when the underlying is ready for the income call
// (PMCC). Same daily RSI, same saved covered-call cutoff and same "Calls:" chip as the stock card. The RSI is of the
// UNDERLYING stock. "At open" uses the LEAP's own open date from the broker and never estimates: outside the loaded
// chart window it shows a dash. Display only.

import { ccRsiChip } from '@/lib/scans/ccRsiChip';
import { rsiAtEntry, type StockRsi } from '@/lib/portfolio/stockRsi';
import { standaloneLongOptionLabel } from '@/lib/portfolio/positionStrategyFilter';
import { RsiSparkline } from './RsiSparkline';
import type { Position } from '@/lib/portfolio-data/types';

const ARROW = { up: { glyph: '▲', label: 'rising' }, down: { glyph: '▼', label: 'falling' }, flat: { glyph: '–', label: 'flat' } } as const;
const TONE = {
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  recovery: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  wait: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
} as const;

/** A single long call that the card labels LEAP (not a LEAP put, not a short or multi-leg position). */
export function isLeapCall(p: Position): boolean {
  return standaloneLongOptionLabel(p) === 'LEAP' && p.legs?.[0]?.optionType === 'C';
}

/** The LEAP's open date (YYYY-MM-DD) from the broker leg, or null. */
export function leapOpenDate(p: Position): string | null {
  const raw = p.legs?.[0]?.openedAt;
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function view(p: Position, rsi: StockRsi | null | undefined, cutoff: number) {
  // costBasis null: the stock cost-basis "Recovery" state is about shares, not a LEAP.
  const chip = rsi ? ccRsiChip({ rsi: rsi.rsi, price: null, costBasis: null, cutoff }) : null;
  const openDate = leapOpenDate(p);
  const atOpen = rsi ? rsiAtEntry(rsi.points, openDate) : null;
  return { chip, openDate, atOpen };
}

export function LeapRsiChips({ position, rsi, cutoff, textFaint }: { position: Position; rsi: StockRsi | null | undefined; cutoff: number; textFaint: string }) {
  if (rsi === undefined) return null;
  const { chip, atOpen } = view(position, rsi, cutoff);
  const arrow = rsi ? ARROW[rsi.direction] : null;
  return (
    <ul aria-label="RSI" data-testid={`leap-rsi-${position.key}`} className="mt-2 flex flex-wrap items-center gap-1.5 sm:justify-end">
      <li className="text-[11px] text-white">
        {position.symbol} RSI <b>{rsi ? Math.round(rsi.rsi) : '—'}</b>
        {arrow && <span className={`ml-1 text-[10px] ${textFaint}`} aria-label={arrow.label}>{arrow.glyph}</span>}
        {atOpen && rsi && <span className={textFaint}> · {Math.round(atOpen.rsi)} at open</span>}
      </li>
      {chip && <li title={chip.reason} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${TONE[chip.state]}`}>Calls: {chip.label}</li>}
    </ul>
  );
}

export function LeapRsiDetail({ position, rsi, cutoff, textFaint }: { position: Position; rsi: StockRsi | null | undefined; cutoff: number; textFaint: string }) {
  const { chip, openDate, atOpen } = view(position, rsi, cutoff);
  return (
    <div data-testid="leap-rsi-detail" className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[auto_1fr]">
      <div className={textFaint}>
        {rsi?.points && rsi.points.length >= 2 ? <RsiSparkline points={rsi.points} cutoff={cutoff} entryDate={openDate} symbol={position.symbol} /> : <span className="text-[11px]">RSI history unavailable</span>}
        <span className="block text-[9px]">{position.symbol} daily RSI(14), last 30 sessions · dashed line = {cutoff} cutoff</span>
      </div>
      <div className="space-y-2">
        <dl className="grid grid-cols-3 gap-2 text-xs text-white">
          <div><dt className={`text-[10px] ${textFaint}`}>Now</dt><dd className="font-bold">{rsi ? Math.round(rsi.rsi) : '—'}</dd></div>
          <div><dt className={`text-[10px] ${textFaint}`}>Yesterday</dt><dd className="font-bold">{rsi ? Math.round(rsi.previous) : '—'}</dd></div>
          <div><dt className={`text-[10px] ${textFaint}`}>At LEAP open</dt><dd className="font-bold">{atOpen ? Math.round(atOpen.rsi) : '—'}</dd></div>
        </dl>
        {openDate && !atOpen && rsi && <p className="text-[10px] text-amber-300">The LEAP opened before the last ~5 months of chart history, so RSI at open is not shown.</p>}
        {chip && <p className={`text-[11px] ${textFaint}`}>{chip.reason}</p>}
      </div>
    </div>
  );
}
