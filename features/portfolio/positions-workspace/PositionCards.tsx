// features/portfolio/positions-workspace/PositionCards.tsx
//
// POSITIONS-CARDS-0001: the Cards view of the option positions. Opt-in (the Table stays the default). Display only: every number comes from the
// same helpers the table uses, and every action reuses the table's own handlers (Analyze, Close/Roll, stop and profit-target control, intent).

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { IntentSelect } from './IntentSelect';
import { SalvageEntry } from './salvage/SalvagePanel';
import { buildPositionCard, type CardBucket, type CardChipTone, type PositionCard } from './model/cardModel';
import { SEMANTIC_TONE_CLASS } from './model/presentation';
import { standaloneLongOptionLabel } from '@/lib/portfolio/positionStrategyFilter';
import { canonicalRecommendationToAction } from '@/lib/portfolio/canonicalRecommendationPresentation';
import { CONTROL_RADIUS } from './ui/chipStyle';
import type { ActionType, Position, PositionIntent } from '@/lib/portfolio-data/types';

const ACTION_LABELS: Partial<Record<ActionType, string>> = { TAKE_PROFIT: 'Take Profit Now', CLOSE_ROLL: 'Close Position', PLACE_GTC: 'Set/Edit Profit Target', CUT_LOSSES: 'Cut Losses' };

const usd = (v: number | null) => v == null || !Number.isFinite(v) ? 'Unavailable' : `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;

const BUCKET_CLASS: Record<CardBucket, string> = {
  Close: 'border-red-400/60 bg-red-400/10 text-red-200',
  Roll: 'border-purple-400/60 bg-purple-400/10 text-purple-200',
  Manage: 'border-amber-400/60 bg-amber-400/10 text-amber-200',
  Hold: 'border-white/20 bg-white/5 text-white/80',
  Unjudged: 'border-white/20 bg-white/5 text-white/50',
};
const CHIP_CLASS: Record<CardChipTone, string> = {
  bad: 'border-red-400/50 bg-red-400/10 text-red-200',
  warn: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
  ok: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  info: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
};

function detailLine(p: Position): string {
  const legs = p.legs ?? [];
  const what = legs.length === 1 ? `${legs[0].strikePrice} ${legs[0].optionType === 'P' ? 'Put' : 'Call'}`
    : legs.length > 1 ? `${legs.map(l => `${l.strikePrice}${l.optionType}`).join('/')}` : p.strategy;
  const qty = `${p.quantity}x`;
  return `${what} · ${qty} · Exp ${p.expDate} · ${p.dte} DTE`;
}

export interface PositionCardsProps {
  positions: Position[];
  /** Already sorted by the caller (the sort menu lives in the toolbar). */
  order: (cards: PositionCard[]) => PositionCard[];
  pctOfTarget: (p: Position) => number | null;
  getManagementActions?: (position: Position) => ActionType[];
  onExecute?: (position: Position, action: ActionType, initialRollMode?: 'close' | 'roll') => void;
  renderStopControl?: (position: Position) => ReactNode;
  onAnalyze?: (position: Position) => void;
  onIntentChange?: (key: string, intent: PositionIntent) => void;
  onRefresh?: () => void;
  th: { textFaint: string; textMuted: string; border: string };
  emptyText: string;
}

export function PositionCards({ positions, order, pctOfTarget, getManagementActions, onExecute, renderStopControl, onAnalyze, onIntentChange, onRefresh, th, emptyText }: PositionCardsProps) {
  const cards = useMemo(() => order(positions.map(p => buildPositionCard(p, { pctOfTarget: pctOfTarget(p) }))), [positions, order, pctOfTarget]);
  if (cards.length === 0) return <p role="status" className={`rounded-xl border ${th.border} p-6 text-center text-sm ${th.textFaint}`}>{emptyText}</p>;
  return <div data-testid="position-cards" className="grid gap-3 lg:grid-cols-2">{cards.map(card => <CardItem key={card.key} card={card} th={th} actions={getManagementActions?.(card.position) ?? []} onExecute={onExecute} renderStopControl={renderStopControl} onAnalyze={onAnalyze} onIntentChange={onIntentChange} onRefresh={onRefresh} />)}</div>;
}

function CardItem({ card, th, actions, onExecute, renderStopControl, onAnalyze, onIntentChange, onRefresh }: { card: PositionCard; th: PositionCardsProps['th']; actions: ActionType[]; onExecute?: PositionCardsProps['onExecute']; renderStopControl?: PositionCardsProps['renderStopControl']; onAnalyze?: PositionCardsProps['onAnalyze']; onIntentChange?: PositionCardsProps['onIntentChange']; onRefresh?: () => void }) {
  const p = card.position;
  const [moreOpen, setMoreOpen] = useState(false);
  const horizon = standaloneLongOptionLabel(p);
  const suggested = p.recommendation ? canonicalRecommendationToAction(p.recommendation.kind) : null;
  const primary = actions.find(a => a === suggested) ?? null;
  const rest = actions.filter(a => a !== primary);
  const pnlTone = card.pnl == null || Math.abs(card.pnl) < 0.005 ? SEMANTIC_TONE_CLASS.neutral : card.pnl > 0 ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.negative;
  const stopControl = moreOpen ? renderStopControl?.(p) ?? null : null;
  const run = (action: ActionType, mode?: 'close' | 'roll') => { setMoreOpen(false); onExecute?.(p, action, mode); };
  return (
    <article aria-label={`${p.symbol} ${horizon ?? p.strategy} position`} className={`rounded-xl border ${th.border} bg-white/[0.02] p-4`}>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-white">{p.symbol}<span className="rounded border border-amber-300/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">{horizon ?? p.strategy}</span></h3>
          <p className={`mt-0.5 text-xs ${th.textMuted}`}>{detailLine(p)}</p>
        </div>
        <div className="text-right">
          <b data-testid="card-pnl" className={`block text-xl ${pnlTone}`}>{usd(card.pnl)}</b>
          <span className={`block text-[11px] ${card.unverifiedQuote ? 'text-amber-300' : th.textFaint}`}>{card.pnlNote}</span>
        </div>
        <p className="col-span-2 mt-2 flex flex-wrap items-center gap-2">
          <span data-testid="card-bucket" className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${BUCKET_CLASS[card.bucket]}`}>{card.bucket === 'Unjudged' ? 'No verdict' : card.bucket}</span>
          <span className="text-sm font-semibold text-white">{card.verdictLabel}</span>
          {!p.recommendation && <button type="button" onClick={() => onRefresh?.()} disabled={!onRefresh} className="text-xs underline decoration-dotted underline-offset-2 disabled:opacity-40">Refresh</button>}
        </p>
        {card.reason && <p className={`col-span-2 text-xs ${th.textFaint}`}>{card.reason}</p>}
      </div>
      {card.assignment && (
        <p data-testid="card-assignment" className={`mt-2 text-xs ${th.textMuted}`}>
          Assigned: {card.assignment.shares} sh{card.assignment.netPrice != null ? ` @ ${usd2(card.assignment.netPrice)} net` : ''}{card.assignment.underwaterNow != null ? <span className={SEMANTIC_TONE_CLASS.negative}>, {usd(card.assignment.underwaterNow)} now</span> : null}
        </p>
      )}
      {card.chips.length > 0 && <ul aria-label="Signals" className="mt-3 flex flex-wrap gap-1.5">{card.chips.map(chip => <li key={chip.id} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CHIP_CLASS[chip.tone]}`}>{chip.label}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onAnalyze?.(p)} disabled={!onAnalyze} title={!onAnalyze ? 'Canonical analysis is unavailable' : undefined} className={`min-h-9 ${CONTROL_RADIUS} border border-blue-500/50 px-3 text-xs text-blue-300 focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40`}>Analyze with AI</button>
        {primary && <button type="button" onClick={() => run(primary, primary === 'CLOSE_ROLL' ? (p.recommendation?.kind === 'roll-soon' ? 'roll' : 'close') : undefined)} className={`min-h-9 ${CONTROL_RADIUS} border border-teal-400/60 bg-teal-400/10 px-3 text-xs font-semibold text-white focus:ring-2 focus:ring-teal-400`}>{primary === 'CLOSE_ROLL' && p.recommendation?.kind === 'roll-soon' ? 'Roll Position' : ACTION_LABELS[primary] ?? primary}</button>}
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)} className={`min-h-9 ${CONTROL_RADIUS} border border-white/20 px-3 text-xs text-white focus:ring-2 focus:ring-teal-400`}>More ▾</button>
        <span className="ml-auto"><IntentSelect position={p} onIntentChange={onIntentChange} /></span>
      </div>
      {moreOpen && (
        <div role="group" aria-label={`More actions for ${p.symbol}`} className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-wrap gap-2">
            {rest.map(action => action === 'CLOSE_ROLL' ? (
              <span key={action} className="contents">
                <button type="button" onClick={() => run(action, 'close')} className="min-h-8 rounded border border-white/20 px-2 text-xs text-white">Close Position</button>
                <button type="button" onClick={() => run(action, 'roll')} className="min-h-8 rounded border border-purple-500/50 px-2 text-xs text-purple-300">Roll Position</button>
              </span>
            ) : <button key={action} type="button" onClick={() => run(action)} className={`min-h-8 rounded border px-2 text-xs ${action === 'CUT_LOSSES' ? 'border-amber-500/50 text-amber-300' : 'border-white/20 text-white'}`}>{ACTION_LABELS[action] ?? action}</button>)}
            {primary === 'CLOSE_ROLL' && p.recommendation?.kind !== 'roll-soon' && <button type="button" onClick={() => run('CLOSE_ROLL', 'roll')} className="min-h-8 rounded border border-purple-500/50 px-2 text-xs text-purple-300">Roll Position</button>}
            {primary === 'CLOSE_ROLL' && p.recommendation?.kind === 'roll-soon' && <button type="button" onClick={() => run('CLOSE_ROLL', 'close')} className="min-h-8 rounded border border-white/20 px-2 text-xs text-white">Close Position</button>}
          </div>
          {stopControl && <div>{stopControl}</div>}
          <SalvageEntry position={p} />
        </div>
      )}
    </article>
  );
}
