// features/trade-map/SendDialog.tsx
//
// ORDER-SEND-0001 S3c: the Send step for a credit trade (BPS, BCS, IC). Review, validate (a broker dry run of the
// exact order), then place. The order itself is built by lib/orders (the same builders the screener uses). A live
// order is only reachable from a successful validation of the identical payload that is at most 15 seconds old.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import { recordOrderLifecycleEvent } from '@/lib/order-lifecycle/client';
import { tickTableFromNestedChain } from '@/lib/portfolio/tickSize';
import { occRoot } from '@/lib/portfolio/tickSize';
import { ttFetch } from '@/lib/tastytrade/client';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
import { getExecutableOptionQuotes } from '@/lib/scans/tastytrade-client';
import { isMarketOpen } from '@/lib/wheel/marketHours';
import { DEFAULT_GTC_PCT, DEFAULT_STOP_MULTIPLE, VALIDATION_MAX_AGE_MS } from '@/lib/orders/tradeMapEntry';
import { placeSend, validateSend, type SendDeps, type Validated } from '@/lib/orders/tradeMapSend';
import { evaluateRuleChecks, isIndexSymbol, needsAcknowledgement, type RuleCheck } from '@/lib/trademap/ruleChecks';
import type { LegSpec, StrategyId } from '@/lib/trademap/strategies';

const BROKER = 'https://api.tastytrade.com';

function brokerDeps(): SendDeps {
  return {
    now: () => Date.now(),
    marketOpen: () => isMarketOpen(),
    getToken: () => getAccessToken(),
    getAccountNumber: async () => requireActiveBrokerAccount(await getAccessToken(), ttFetch, { forceValidation: true }),
    fetchQuotes: (symbols, token) => getExecutableOptionQuotes(symbols, token),
    post: async (path, token, body) => {
      const res = await fetch(`${BROKER}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
  };
}

export interface SendDialogProps {
  th: any;
  symbol: string;
  strategy: StrategyId;
  strategyLabel: string;
  specs: LegSpec[];
  expiration: string;
  dte: number;
  /** Net credit per share at the mid the trader is looking at. */
  displayedCredit: number;
  /** Widest wing per share. */
  width: number;
  ivRankPct: number | null;
  earningsDate: string | null;
  shortDeltas: Array<number | null>;
  shortOis: Array<number | null>;
  onClose: () => void;
}

type Phase = 'review' | 'validating' | 'validated' | 'placing' | 'done' | 'error';

const statusMark = (c: RuleCheck) => (c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '!');
const statusColor = (c: RuleCheck) => (c.status === 'pass' ? 'text-emerald-400' : c.status === 'fail' ? 'text-rose-400' : 'text-amber-400');

export default function SendDialog(p: SendDialogProps) {
  const { th } = p;
  const [quantity, setQuantity] = useState(1);
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<Phase>('review');
  const [message, setMessage] = useState<string | null>(null);
  const [validated, setValidated] = useState<Validated | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  // After a live order was sent and failed or went unanswered, only Close is offered: a second try could double-place.
  const [mayBeSent, setMayBeSent] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const checks = useMemo(
    () => evaluateRuleChecks({
      strategy: p.strategy as 'bps' | 'bcs' | 'ic', symbol: p.symbol, dte: p.dte, ivRankPct: p.ivRankPct,
      shortDeltas: p.shortDeltas, shortOis: p.shortOis, earningsDate: p.earningsDate, expiration: p.expiration,
      credit: p.displayedCredit, width: p.width,
    }),
    [p.strategy, p.symbol, p.dte, p.ivRankPct, p.shortDeltas, p.shortOis, p.earningsDate, p.expiration, p.displayedCredit, p.width],
  );
  const mustAck = needsAcknowledgement(checks);

  const credit = p.displayedCredit;
  const maxLoss = (p.width - credit) * 100 * quantity;
  const secondsLeft = validated ? Math.max(0, Math.ceil((validated.record.atMs + VALIDATION_MAX_AGE_MS - nowMs) / 1000)) : 0;

  // A validation that has aged out goes back to review: it can no longer be placed.
  useEffect(() => {
    if (phase === 'validated' && secondsLeft === 0) {
      setPhase('review'); setValidated(null);
      setMessage('The validation expired after 15 seconds. Validate again to place the order.');
    }
  }, [phase, secondsLeft]);

  const validate = async () => {
    setPhase('validating'); setMessage(null); setValidated(null);
    try {
      const deps = brokerDeps();
      let tickTable = null;
      try {
        const token = await getAccessToken();
        tickTable = tickTableFromNestedChain(await ttFetch(`/option-chains/${encodeURIComponent(p.symbol)}/nested`, token), p.specs[0].symbol);
      } catch { tickTable = null; }
      const result = await validateSend(deps, {
        strategy: p.strategy, specs: p.specs, isIndex: isIndexSymbol(p.symbol), displayedCredit: p.displayedCredit,
        quantity, tickTable, root: occRoot(p.specs[0].symbol),
        gtcPct: DEFAULT_GTC_PCT, stopMultiple: DEFAULT_STOP_MULTIPLE,
      });
      if (!result.ok) { setMessage(result.reason); setPhase('review'); return; }
      setValidated(result); setPhase('validated');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Validation failed. Nothing was sent.');
      setPhase('review');
    }
  };

  const place = async () => {
    if (!validated) return;
    setPhase('placing'); setMessage(null);
    const result = await placeSend(brokerDeps(), validated);
    if (!result.ok) { setMessage(result.reason); setMayBeSent(result.sent); setPhase('error'); return; }
    setOrderId(result.orderId);
    setPhase('done');
    await recordOrderLifecycleEvent({
      brokerOrderId: result.orderId, brokerComplexOrderId: result.orderId, accountNumber: validated.accountNumber,
      symbol: p.symbol, strategy: p.strategy.toUpperCase(), requestedPrice: validated.entry, orderType: 'Limit', quantity,
      kind: 'entry', status: 'submitted',
    }).catch(e => console.error('Order placed but lifecycle recording failed:', e));
  };

  const busy = phase === 'validating' || phase === 'placing';
  const btn = `px-3 py-1.5 text-xs rounded border ${th.border}`;
  const primary = 'px-3 py-1.5 text-xs rounded border border-[var(--accent,#3b82f6)] text-[var(--accent,#3b82f6)] disabled:opacity-40';
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Send to TastyTrade">
      <div className={`${th.card} ${th.border} border rounded-lg p-4 w-full max-w-md flex flex-col gap-3 max-h-[90vh] overflow-y-auto`}>
        <div className={`text-sm font-semibold ${th.text}`}>Send {p.symbol} {p.strategyLabel}</div>
        <div className={`text-xs ${th.textFaint}`}>{p.specs.map(s => `${s.side === 'long' ? '+' : '−'}${s.strike}${s.right}`).join('  ')} · {p.expiration} · {p.dte}d</div>

        {phase !== 'done' && (
          <label className={`text-xs ${th.textFaint} flex items-center gap-2`}>Contracts
            <input type="number" min={1} step={1} value={quantity} disabled={busy || phase === 'validated'} onChange={e => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className={`${th.input} ${th.inputBorder} ${th.text} border rounded px-2 py-1 w-16`} />
          </label>
        )}

        <div className={`grid grid-cols-2 gap-2 text-xs ${th.text}`}>
          <div><span className={th.textFaint}>Credit (mid) </span>{fmt(credit)} · {fmt(credit * 100 * quantity)}</div>
          <div><span className={th.textFaint}>Max loss </span>{fmt(maxLoss)}</div>
          <div><span className={th.textFaint}>Profit target </span>{validated ? fmt(validated.profitBuyback) : `${DEFAULT_GTC_PCT}% of credit`}</div>
          <div><span className={th.textFaint}>Stop </span>{validated ? fmt(validated.stopTrigger) : `${DEFAULT_STOP_MULTIPLE}× credit`}</div>
        </div>
        <div className={`text-[11px] ${th.textFaint}`}>Placed as one order with a good-till-canceled profit target and stop attached.</div>

        <div className="flex flex-col gap-1">
          {checks.map(c => (
            <div key={c.key} className={`text-xs ${statusColor(c)}`}>{statusMark(c)} {c.value} <span className={th.textFaint}>({c.rule})</span></div>
          ))}
          <div className={`text-[10px] ${th.textFaint}`}>Checked against the default scan rules; custom scan settings are not applied here.</div>
        </div>

        {mustAck && phase === 'review' && (
          <label className="text-xs text-rose-400 flex items-start gap-2">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            This trade fails one or more rules above. I want to validate it anyway.
          </label>
        )}

        {phase === 'validated' && validated && (
          <div className="text-xs text-emerald-400">
            Validated by the broker at {fmt(validated.entry)} credit{validated.healNote ? ` (adjusted to the broker's ${fmt(validated.healNote.tick)} tick)` : ''}. Place within {secondsLeft}s.
          </div>
        )}
        {phase === 'done' && <div className="text-xs text-emerald-400">Order placed (id {orderId}). Check it under Pending orders in your portfolio.</div>}
        {message && <div className="text-xs text-rose-400">{message}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={p.onClose} disabled={phase === 'placing'} className={`${btn} ${th.textFaint}`}>{phase === 'done' ? 'Close' : 'Cancel'}</button>
          {(phase === 'review' || phase === 'validating' || (phase === 'error' && !mayBeSent)) && (
            <button onClick={validate} disabled={busy || (mustAck && !ack)} className={primary}>{phase === 'validating' ? 'Validating…' : phase === 'error' ? 'Validate again' : 'Validate with broker'}</button>
          )}
          {(phase === 'validated' || phase === 'placing') && (
            <button onClick={place} disabled={phase === 'placing' || secondsLeft === 0} className={primary}>{phase === 'placing' ? 'Placing…' : 'Place order'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
