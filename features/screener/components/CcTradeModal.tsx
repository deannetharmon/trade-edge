'use client';

// features/screener/components/CcTradeModal.tsx
//
// CC-ORDERS-0001 slice B: the covered-call order dialog. A dedicated fork of the CSP order dialog's flow (confirm ->
// dry run -> placing -> done/error, quantity stepper, per-share entry limit, 15-second quote freshness, market-hours
// rule), not a branch inside the multi-leg TradeModal. Differences from the CSP dialog, all Ian's rulings:
//   - Coverage is PROVEN by a fresh broker read when the dialog opens, before the dry run, and again inside the submit
//     gate immediately before the broker call (submitCcOrderIfSafe). Unknown or short coverage means no order.
//   - One contingent exit: a GTC buy-to-close at the profit target. NO stop order (assignment is acceptable).
//   - A strike below the broker cost basis needs an explicit acknowledgment and the dialog states the assignment result.
// Every outside call comes through `deps` (lib/scans/ccOrderDeps.ts), so this file is tested with fakes.

import { useEffect, useMemo, useState } from 'react';
import type { THEMES, Theme } from '@/lib/theme';
import type { CcOrderDeps } from '@/lib/scans/ccOrderDeps';
import { buildCcOrderLeg, buildCreditEntryOto, ccProfitBuyback } from '@/lib/scans/ccOrderMath';
import { costBasisFromReports, guardCcOrder, submitCcOrderIfSafe, type CcOrderRequest } from '@/lib/scans/ccOrderSubmission';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';

export interface CcOrderInput {
  symbol: string;
  occSymbol: string;
  strike: number;
  expiration: string;
  dte: number;
  /** Absolute delta, or null when unknown. */
  delta: number | null;
  /** Mid per share at lookup time, the prefilled limit. */
  midPerShare: number;
  isIndex: boolean;
  initialQuantity?: number;
}

interface Props {
  th: typeof THEMES[Theme];
  order: CcOrderInput;
  deps: CcOrderDeps;
  onClose: () => void;
}

type Phase = 'confirm' | 'dryrun' | 'placing' | 'done' | 'error';

const MAX_QUANTITY = 20;
const QUOTE_MAX_AGE_SECONDS = 15;
const VALIDATION_WINDOW_MS = 15000;
const money0 = (n: number) => '$' + Math.round(n).toLocaleString();
const moneySigned = (n: number) => (n < 0 ? '−' : '+') + '$' + Math.abs(Math.round(n)).toLocaleString();

export function CcTradeModal({ th, order, deps, onClose }: Props) {
  const [quantity, setQuantity] = useState(order.initialQuantity && order.initialQuantity > 0 ? order.initialQuantity : 1);
  const [entryLimit, setEntryLimit] = useState(parseFloat(order.midPerShare.toFixed(2)));
  const [profitPct, setProfitPct] = useState(50);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [reports, setReports] = useState<CoverageReports | null>(null);
  const [coverageLoaded, setCoverageLoaded] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [quoteValidation, setQuoteValidation] = useState<{ at: number; executableCredit: number } | null>(null);
  const [tick, setTick] = useState(0);

  const readFresh = async (): Promise<CoverageReports | null> => {
    try {
      const r = await deps.readCoverage();
      setReports(r);
      return r;
    } catch {
      setReports(null);
      return null;
    }
  };

  // Coverage is read as soon as the dialog opens so the line below is honest from the first frame.
  useEffect(() => {
    let alive = true;
    deps.readCoverage().then(
      (r) => { if (alive) { setReports(r); setCoverageLoaded(true); } },
      () => { if (alive) { setReports(null); setCoverageLoaded(true); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!quoteValidation) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [quoteValidation]);
  void tick;
  const validationFresh = quoteValidation !== null && deps.now() - quoteValidation.at <= VALIDATION_WINDOW_MS;

  const request: CcOrderRequest = useMemo(() => ({
    symbol: order.symbol, expiration: order.expiration, strike: order.strike, quantity, entryPerShare: entryLimit, belowCostBasisAcknowledged: acknowledged,
  }), [order.symbol, order.expiration, order.strike, quantity, entryLimit, acknowledged]);

  const guard = useMemo(() => guardCcOrder(reports, request), [reports, request]);
  const costBasis = costBasisFromReports(reports, order.symbol);
  const belowBasis = costBasis !== null && order.strike < costBasis;
  const legBuild = buildCcOrderLeg(order.occSymbol, quantity, order.isIndex);
  const profitBuyback = entryLimit > 0 ? ccProfitBuyback(entryLimit, profitPct) : 0;
  const premium = entryLimit * 100 * quantity;
  const proceeds = order.strike * 100 * quantity;

  const buildPayload = () => {
    if (!legBuild.ok) throw new Error(legBuild.reason);
    return buildCreditEntryOto({ entryPerShare: entryLimit, profitBuybackPerShare: profitBuyback, quantity, leg: legBuild.leg });
  };

  const validateQuote = async (expectedCredit?: number): Promise<number> => {
    if (!deps.isMarketOpen()) {
      throw new Error('Market is closed. Live executable quotes cannot be validated. Refresh during regular market hours before placing this order.');
    }
    const quote = await deps.fetchQuote(order.occSymbol);
    if (!quote || quote.bid === null || quote.ask === null || quote.bid <= 0 || quote.ask < quote.bid || quote.ageSeconds === null || quote.ageSeconds > QUOTE_MAX_AGE_SECONDS) {
      throw new Error('Live quote is unavailable, crossed, or older than 15 seconds. This order cannot be placed from stale data.');
    }
    const executableCredit = Number(quote.bid.toFixed(2));
    if (expectedCredit !== undefined && Math.abs(executableCredit - expectedCredit) >= 0.01) {
      throw new Error('Market moved from the last validation ($' + expectedCredit.toFixed(2) + ' to $' + executableCredit.toFixed(2) + ' executable credit). Refresh and validate again.');
    }
    setQuoteValidation({ at: deps.now(), executableCredit });
    return executableCredit;
  };

  const runDryRun = async () => {
    setPhase('dryrun');
    setError('');
    try {
      if (!deps.isMarketOpen()) {
        throw new Error('Market is closed. Live executable quotes cannot be validated. Refresh during regular market hours before placing this order.');
      }
      const fresh = await readFresh();
      const g = guardCcOrder(fresh, request);
      if (!g.allowed) throw new Error(g.reason);
      await validateQuote();
      const data = await deps.dryRun(buildPayload());
      setDryRunResult(data);
      setPhase('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dry run failed.');
      setPhase('error');
    }
  };

  const placeOrder = async () => {
    setPhase('placing');
    setError('');
    try {
      if (!quoteValidation || deps.now() - quoteValidation.at > VALIDATION_WINDOW_MS) {
        throw new Error('Validation has expired. Refresh and validate the current market before placing this order.');
      }
      if (!deps.isMarketOpen()) {
        throw new Error('Market is closed. Live executable quotes cannot be validated. Refresh during regular market hours before placing this order.');
      }
      const expected = quoteValidation.executableCredit;
      const payload = buildPayload();
      // Coverage is read again INSIDE the gate, right before the broker call.
      const out = await submitCcOrderIfSafe(
        async () => { const r = await deps.readCoverage(); setReports(r); return r; },
        request,
        async () => {
          await validateQuote(expected);
          return deps.place(payload);
        },
      );
      if (!out.submitted) throw new Error(out.reason);
      setOrderId(out.result.orderId);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed.');
      setPhase('error');
    }
  };

  const bpEffect = dryRunResult && dryRunResult['buying-power-effect'];
  const needsAck = belowBasis;
  const coverageOk = guard.allowed || (needsAck && !acknowledged && guard.coverage !== null && guard.coverage.canOrder);
  const busy = phase === 'placing' || phase === 'dryrun';
  const actionBlocked = !legBuild.ok || busy || !coverageLoaded || (needsAck && !acknowledged) || !(entryLimit > 0);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
      <div role="dialog" aria-modal="true" aria-label={'PLACE COVERED CALL ORDER — ' + order.symbol} className={`${th.sidebar} border ${th.border} rounded-2xl p-6 w-full max-w-xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold ${th.text} tracking-widest`}>PLACE COVERED CALL ORDER {'—'} {order.symbol}</h2>
          <button aria-label="Close covered call order" onClick={onClose} disabled={busy} className="text-slate-400 hover:text-white text-xl disabled:opacity-30">{'✕'}</button>
        </div>

        {!legBuild.ok && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-600 rounded-lg mb-4">
            <p className="text-xs text-yellow-400">{legBuild.reason}</p>
          </div>
        )}

        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-4 space-y-2`}>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Call</span>
            <span className={th.text}>{order.strike}C exp {order.expiration} ({order.dte}d){order.delta !== null ? ' · Δ' + order.delta.toFixed(2) : ''}</span>
          </div>
          <div className="flex justify-between text-xs items-center">
            <span className={th.textFaint}>Entry limit / share <span className="text-[10px]">(${(entryLimit * 100).toLocaleString()} / contract)</span></span>
            <div className="flex items-center gap-1">
              <button aria-label="Lower limit price" onClick={() => setEntryLimit((v) => parseFloat(Math.max(0.01, v - 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs`}>{'−'}</button>
              <span data-testid="cc-entry-limit" className="text-emerald-400 font-bold text-xs w-12 text-center">${entryLimit.toFixed(2)}</span>
              <button aria-label="Raise limit price" onClick={() => setEntryLimit((v) => parseFloat((v + 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs`}>+</button>
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Order type</span>
            <span className={th.text}>Net Credit Limit {'·'} GTC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Quantity</span>
            <div className="flex items-center gap-1">
              <button aria-label="Fewer contracts" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className={`w-6 h-6 rounded border ${th.border} ${th.textMuted} text-xs`}>{'−'}</button>
              <span data-testid="cc-quantity" className={`${th.text} font-bold text-xs w-6 text-center`}>{quantity}</span>
              <button aria-label="More contracts" onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))} className={`w-6 h-6 rounded border ${th.border} ${th.textMuted} text-xs`}>+</button>
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Premium</span>
            <span className="text-emerald-400">{money0(premium)}</span>
          </div>
          <div className="flex justify-between text-[10px] pt-1">
            <span className={th.textFaint}>Execution evidence</span>
            <span className={validationFresh ? 'text-emerald-400' : 'text-amber-300'}>
              {validationFresh && quoteValidation ? 'Validated just now · $' + quoteValidation.executableCredit.toFixed(2) + ' executable credit' : 'Quotes from lookup · refresh required before order'}
            </span>
          </div>
        </div>

        {/* Coverage: proven by the broker, never assumed. */}
        <p
          data-testid="cc-coverage"
          className={`text-xs mb-3 rounded-lg border px-3 py-2 ${!coverageLoaded ? 'border-neutral-600 text-neutral-300' : coverageOk ? 'border-emerald-500/50 text-emerald-300' : 'border-amber-500/60 text-amber-200'}`}
        >
          {!coverageLoaded ? 'Checking your shares and LEAPs…' : guard.allowed ? guard.coverage.message : guard.coverage && guard.coverage.canOrder ? guard.coverage.message : guard.reason}
        </p>

        {/* What assignment means. */}
        <div className={`${th.card} border ${th.border} rounded-xl p-3 mb-4 text-xs space-y-1`}>
          <p className={`text-[10px] font-bold ${th.textMuted} uppercase tracking-wider`}>If assigned</p>
          <div className="flex justify-between"><span className={th.textFaint}>Shares sold at ${order.strike}</span><span className={th.text}>{money0(proceeds)}</span></div>
          <div className="flex justify-between"><span className={th.textFaint}>Premium kept either way</span><span className="text-emerald-400">{money0(premium)}</span></div>
          {costBasis !== null ? (
            <div className="flex justify-between">
              <span className={th.textFaint}>Versus your ${costBasis.toFixed(2)} cost basis</span>
              <span data-testid="cc-vs-basis" className={belowBasis ? 'text-red-400' : 'text-emerald-400'}>
                {moneySigned((order.strike - costBasis) * 100 * quantity)} ({moneySigned((order.strike - costBasis) * 100 * quantity + premium)} with premium)
              </span>
            </div>
          ) : (
            <p className={`text-[10px] ${th.textFaint}`}>Your cost basis is not available, so no gain or loss is shown.</p>
          )}
        </div>

        {belowBasis && (
          <label className="flex items-start gap-2 text-xs text-amber-200 mb-4">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5" />
            <span>I understand assignment would sell my shares below my cost basis.</span>
          </label>
        )}

        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-4 space-y-2`}>
          <p className={`text-[10px] font-bold ${th.textMuted} uppercase tracking-wider`}>GTC Profit Target</p>
          <input aria-label="Profit target percent" type="range" min={10} max={90} step={5} value={profitPct} onChange={(e) => setProfitPct(Number(e.target.value))} className="w-full" />
          <div className="flex justify-between text-[10px]"><span className={th.textFaint}>{profitPct}% of credit</span><span data-testid="cc-buyback" className={th.text}>Buyback ${profitBuyback.toFixed(2)}</span></div>
          <p className={`text-[10px] ${th.textFaint}`}>No stop order: assignment is an acceptable outcome for a covered call.</p>
        </div>

        {phase === 'confirm' && dryRunResult && bpEffect && (
          <div className={`${th.card} border ${th.border} rounded-xl p-3 mb-4 text-[10px] space-y-1`}>
            <p className={`font-bold ${th.textMuted} uppercase tracking-wider`}>Dry Run Result</p>
            <div className="flex justify-between"><span className={th.textFaint}>Buying power effect</span><span className={th.text}>{bpEffect['change-in-buying-power']} {bpEffect['change-in-buying-power-effect']}</span></div>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-red-400 mb-3">{error}</p>}
        {phase === 'done' && <p className="text-xs text-emerald-400 mb-3" role="status">Order submitted. Broker order id: {orderId}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 border border-slate-700 rounded-xl text-xs font-bold tracking-widest disabled:opacity-40">
            {phase === 'done' ? 'CLOSE' : 'CANCEL'}
          </button>
          {phase !== 'done' && (
            <button
              disabled={actionBlocked}
              onClick={() => (dryRunResult ? placeOrder() : runDryRun())}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-widest disabled:opacity-50"
            >
              {phase === 'placing' ? 'PLACING...' : phase === 'dryrun' ? 'VALIDATING...' : needsAck && !acknowledged ? 'ACKNOWLEDGE TO CONTINUE' : dryRunResult ? 'PLACE + GTC' : 'DRY RUN'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
