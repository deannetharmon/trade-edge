'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_RULES, BASE } from '@/lib/scans/constants';
import { daysUntil } from '@/lib/scans/scan-utils';
import { getAccessToken, getChain, getCspCapitalContext } from '@/lib/scans/tastytrade-client';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';

type Direction = 'C' | 'P';
type Step = 'criteria' | 'results' | 'review' | 'confirm' | 'status';

interface LeapsCandidate {
  ticker: string;
  occSymbol: string;
  expiration: string;
  dte: number;
  strike: number;
  direction: Direction;
  delta: number;
  openInterest: number;
  bid: number;
  ask: number;
  mid: number;
  quoteUpdatedAt: string | null;
}

interface Props {
  th: ScanModalTheme;
  universe: string[];
  onClose: () => void;
}

const DTE_PRESETS = [
  { label: '90–180', min: 90, max: 180 },
  { label: '180–365', min: 180, max: 365 },
  { label: '365–730', min: 365, max: 730 },
  { label: '180–730', min: 180, max: 730 },
];

const money = (value: number) => `$${value.toFixed(2)}`;
const errorText = (data: any, status: number) => data?.error?.message ?? data?.['error-message'] ?? data?.errors?.[0]?.message ?? `Broker request failed (${status}).`;

/**
 * Standalone LEAPS discovery and broker-order flow. It deliberately has no
 * Long Book/local-storage interaction: broker acknowledgement, order status,
 * and Portfolio are the only durable sources of truth.
 */
export function LeapsScanModal({ th, universe, onClose }: Props) {
  const [step, setStep] = useState<Step>('criteria');
  const [direction, setDirection] = useState<Direction>('C');
  const [dteMin, setDteMin] = useState(365);
  const [dteMax, setDteMax] = useState(730);
  const [deltaMin, setDeltaMin] = useState(0.70);
  const [deltaMax, setDeltaMax] = useState(0.85);
  const [minOi, setMinOi] = useState(100);
  const [maxWidth, setMaxWidth] = useState(0.20);
  const [candidates, setCandidates] = useState<LeapsCandidate[]>([]);
  const [selected, setSelected] = useState<LeapsCandidate | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(0);
  const [scanProgress, setScanProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [buyingPower, setBuyingPower] = useState<number | null>(null);
  const [freshQuoteAt, setFreshQuoteAt] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState('Submitted to broker');

  const totalDebit = limitPrice * quantity * 100;
  const validCriteria = dteMin >= 90 && dteMax <= 730 && dteMin < dteMax && deltaMin >= 0 && deltaMax <= 1 && deltaMin < deltaMax && minOi >= 0 && maxWidth >= 0;
  const canSubmit = Boolean(selected && accountId && buyingPower != null && buyingPower >= totalDebit && freshQuoteAt && !busy);

  const setDtePreset = (preset: typeof DTE_PRESETS[number]) => { setDteMin(preset.min); setDteMax(preset.max); };

  const scan = async () => {
    if (!validCriteria) { setError('Choose a valid DTE, delta, open-interest, and width range.'); return; }
    setBusy(true); setError(''); setScanProgress('Connecting to broker…');
    try {
      const token = await getAccessToken();
      const all: LeapsCandidate[] = [];
      for (let index = 0; index < universe.length; index += 1) {
        const ticker = universe[index];
        setScanProgress(`Scanning ${ticker} (${index + 1} of ${universe.length})…`);
        const chain = await getChain(ticker, token, DEFAULT_RULES, { min: dteMin, max: dteMax });
        for (const contracts of Object.values(chain.chains)) {
          for (const contract of contracts as any[]) {
            const delta = Math.abs(Number(contract.delta));
            const bid = Number(contract.bid); const ask = Number(contract.ask);
            const dte = daysUntil(contract.expirationDate);
            if (contract.optionType !== direction || !Number.isFinite(delta) || delta < deltaMin || delta > deltaMax ||
              !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || ask - bid > maxWidth ||
              Number(contract.openInterest) < minOi || dte < dteMin || dte > dteMax) continue;
            all.push({ ticker, occSymbol: contract.occSymbol, expiration: contract.expirationDate, dte, strike: Number(contract.strikePrice), direction, delta, openInterest: Number(contract.openInterest), bid, ask, mid: Number(contract.mid), quoteUpdatedAt: contract.quoteUpdatedAt ?? null });
          }
        }
      }
      all.sort((a, b) => b.delta - a.delta || a.ask - a.bid - (b.ask - b.bid));
      setCandidates(all); setStep('results'); setScanProgress('');
    } catch (cause: any) { setError(cause?.message ?? 'The broker scan could not be completed.'); }
    finally { setBusy(false); setScanProgress(''); }
  };

  const chooseCandidate = (candidate: LeapsCandidate) => {
    setSelected(candidate); setLimitPrice(Number(candidate.mid.toFixed(2))); setFreshQuoteAt(null); setBuyingPower(null); setAccountId(null); setError(''); setStep('review');
  };

  const refreshForOrder = async (): Promise<{ candidate: LeapsCandidate; accountId: string; buyingPower: number } | null> => {
    if (!selected) return null;
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      const [capital, chain] = await Promise.all([
        getCspCapitalContext(token),
        getChain(selected.ticker, token, DEFAULT_RULES, { min: Math.max(90, selected.dte - 3), max: Math.min(730, selected.dte + 3) }),
      ]);
      if (!capital.accountSelected || !capital.accountId || capital.optionBuyingPower == null) throw new Error('Select a single broker account with available option buying power before submitting.');
      const current = Object.values(chain.chains).flat().find((contract: any) => contract.occSymbol === selected.occSymbol) as any;
      if (!current || Number(current.bid) <= 0 || Number(current.ask) < Number(current.bid)) throw new Error('A fresh tradable quote is unavailable for this contract.');
      const refreshed = { ...selected, bid: Number(current.bid), ask: Number(current.ask), mid: Number(current.mid), quoteUpdatedAt: current.quoteUpdatedAt ?? null, openInterest: Number(current.openInterest), delta: Math.abs(Number(current.delta)) };
      if (refreshed.delta < deltaMin || refreshed.delta > deltaMax || refreshed.openInterest < minOi || refreshed.ask - refreshed.bid > maxWidth) throw new Error('This contract no longer matches the selected result filters after refresh.');
      setSelected(refreshed); setLimitPrice(Number(refreshed.mid.toFixed(2))); setAccountId(capital.accountId); setBuyingPower(capital.optionBuyingPower); setFreshQuoteAt(new Date().toISOString()); setStep('confirm');
      return { candidate: refreshed, accountId: capital.accountId, buyingPower: capital.optionBuyingPower };
    } catch (cause: any) { setError(cause?.message ?? 'Unable to refresh quote and buying power.'); }
    finally { setBusy(false); }
    return null;
  };

  const submit = async () => {
    if (!selected || !accountId || !canSubmit) return;
    setBusy(true); setError('');
    try {
      // Recheck directly before the irreversible broker action. A stale quote
      // or insufficient buying power must fail closed rather than place an order.
      const verified = await refreshForOrder();
      if (!verified) return;
      const freshLimit = Number(verified.candidate.mid.toFixed(2));
      const freshTotalDebit = freshLimit * quantity * 100;
      if (verified.buyingPower < freshTotalDebit) throw new Error('Available option buying power is insufficient after the final broker refresh.');
      const token = await getAccessToken();
      const payload = { 'time-in-force': 'Day', 'order-type': 'Limit', price: freshLimit.toFixed(2), 'price-effect': 'Debit', legs: [{ 'instrument-type': 'Equity Option', symbol: verified.candidate.occSymbol, quantity, action: 'Buy to Open' }] };
      const response = await fetch(`${BASE}/accounts/${verified.accountId}/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, response.status));
      setOrderId(String(data?.data?.order?.id ?? data?.data?.id ?? 'submitted')); setOrderStatus('Submitted to broker'); setStep('status');
    } catch (cause: any) { setError(cause?.message ?? 'Order submission failed.'); }
    finally { setBusy(false); }
  };

  const refreshOrderStatus = async () => {
    if (!accountId || !orderId) return;
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      const data = await (await fetch(`${BASE}/accounts/${accountId}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })).json();
      const order = data?.data?.order ?? data?.data ?? {};
      setOrderStatus(String(order.status ?? order['status'] ?? 'Status unavailable'));
    } catch { setError('Order status could not be refreshed. Check Portfolio or your broker.'); }
    finally { setBusy(false); }
  };

  const heading = step === 'criteria' ? 'FIND LEAPS' : step === 'results' ? 'LEAPS RESULTS' : step === 'review' ? 'CONTRACT REVIEW' : step === 'confirm' ? 'BROKER ORDER CONFIRMATION' : 'BROKER ORDER STATUS';
  const criteriaSummary = `DTE ${dteMin}–${dteMax} · Δ ${deltaMin.toFixed(2)}–${deltaMax.toFixed(2)} · OI ≥ ${minOi} · width ≤ ${money(maxWidth)}`;

  return <ScanModalShell th={th} titleId="leaps-scan-title" title={heading} subtitle="Standalone LEAPS · broker-first flow" closeLabel="Close LEAPS flow" onClose={onClose} maxWidthClassName="max-w-4xl">
    <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider text-cyan-300" aria-label={`LEAPS flow step ${step}`}>
      {['Find', 'Results', 'Review', 'Confirm', 'Status'].map((label, index) => <span key={label} className={index <= ['criteria','results','review','confirm','status'].indexOf(step) ? 'text-cyan-300' : th.textFaint}>{index + 1}. {label}</span>)}
    </div>
    {step === 'criteria' && <div className="space-y-5">
      <p className={`text-xs ${th.textMuted}`}>Scan the Opportunity Universe for liquid, long-dated contracts. Long Book is not part of this flow.</p>
      <section><p className={`mb-2 text-xs font-bold ${th.text}`}>Direction</p><div className="flex gap-2"><button onClick={() => setDirection('C')} className={`rounded border px-4 py-2 text-xs font-bold ${direction === 'C' ? 'border-blue-400 bg-blue-500/20 text-blue-200' : `${th.inputBorder} ${th.textMuted}`}`}>▲ Calls (Bullish)</button><button onClick={() => setDirection('P')} className={`rounded border px-4 py-2 text-xs font-bold ${direction === 'P' ? 'border-blue-400 bg-blue-500/20 text-blue-200' : `${th.inputBorder} ${th.textMuted}`}`}>▼ Puts (Bearish)</button></div></section>
      <section><p className={`mb-2 text-xs font-bold ${th.text}`}>Days to expiration</p><div className="flex flex-wrap gap-2">{DTE_PRESETS.map(preset => <button key={preset.label} onClick={() => setDtePreset(preset)} className={`rounded border px-3 py-1.5 text-xs ${dteMin === preset.min && dteMax === preset.max ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200' : `${th.inputBorder} ${th.textMuted}`}`}>{preset.label}</button>)}</div></section>
      <div className="grid gap-3 sm:grid-cols-4">{[["Minimum DTE", dteMin, setDteMin, 1], ["Maximum DTE", dteMax, setDteMax, 1], ["Minimum delta", deltaMin, setDeltaMin, 0.01], ["Maximum delta", deltaMax, setDeltaMax, 0.01], ["Minimum open interest", minOi, setMinOi, 1], ["Maximum bid/ask width", maxWidth, setMaxWidth, 0.01]].map(([label, value, setter, increment]: any) => <label key={label} className={`flex flex-col gap-1 text-[10px] ${th.textMuted}`}>{label}<input type="number" min="0" step={increment} value={value} onChange={event => setter(Number(event.target.value))} className={`${th.input} border ${th.inputBorder} rounded px-3 py-2 text-sm ${th.text}`} /></label>)}</div>
      <p className={`rounded border ${th.border} p-3 text-[11px] ${th.textMuted}`}>{criteriaSummary}</p>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}<button disabled={busy || !validCriteria || !universe.length} onClick={() => void scan()} className="rounded-lg bg-blue-600 px-5 py-3 text-xs font-bold tracking-wider text-white disabled:opacity-50">{busy ? scanProgress || 'SCANNING…' : 'RUN LEAPS SCAN →'}</button>
    </div>}
    {step === 'results' && <div className="space-y-4"><p className={`text-xs ${th.textMuted}`}>{candidates.length} contracts found · {criteriaSummary}</p>{candidates.length === 0 ? <p className={`rounded border ${th.border} p-4 text-xs ${th.textMuted}`}>No contracts meet these filters. Adjust the criteria and scan again.</p> : <div className={`overflow-x-auto rounded border ${th.border}`}><table className="w-full text-left text-xs"><thead className={th.textFaint}><tr><th className="p-2">Ticker</th><th>Contract</th><th>DTE</th><th>Δ</th><th>Bid</th><th>Ask</th><th>OI</th><th /></tr></thead><tbody>{candidates.slice(0, 100).map(candidate => <tr key={candidate.occSymbol} className={`border-t ${th.border}`}><td className={`p-2 font-bold ${th.text}`}>{candidate.ticker}</td><td className={th.textMuted}>{candidate.expiration} {candidate.strike} {candidate.direction === 'C' ? 'Call' : 'Put'}</td><td>{candidate.dte}</td><td>{candidate.delta.toFixed(2)}</td><td>{money(candidate.bid)}</td><td>{money(candidate.ask)}</td><td>{candidate.openInterest}</td><td className="p-2"><button onClick={() => chooseCandidate(candidate)} className="rounded border border-cyan-500 px-2 py-1 text-[10px] font-bold text-cyan-300">REVIEW</button></td></tr>)}</tbody></table></div>}<button onClick={() => setStep('criteria')} className={`rounded border ${th.inputBorder} px-3 py-2 text-xs ${th.textMuted}`}>Back to criteria</button></div>}
    {step === 'review' && selected && <div className="space-y-4"><section className={`rounded border ${th.border} p-4`}><p className={`text-lg font-bold ${th.text}`}>{selected.ticker} {selected.expiration} {selected.strike} {selected.direction === 'C' ? 'Call' : 'Put'}</p><p className={`mt-1 text-xs ${th.textMuted}`}>OCC: {selected.occSymbol}</p><div className={`mt-3 grid grid-cols-4 gap-3 text-xs ${th.textMuted}`}><span>Bid <b className={th.text}>{money(selected.bid)}</b></span><span>Ask <b className={th.text}>{money(selected.ask)}</b></span><span>Mid <b className={th.text}>{money(selected.mid)}</b></span><span>OI <b className={th.text}>{selected.openInterest}</b></span></div><p className="mt-3 rounded border border-emerald-700 bg-emerald-500/10 p-2 text-xs text-emerald-300">✓ Matches selected delta range</p></section><p className={`text-xs ${th.textMuted}`}>A fresh quote and buying-power check are required before an order can be submitted.</p>{error && <p role="alert" className="text-xs text-red-400">{error}</p>}<div className="flex gap-2"><button onClick={() => setStep('results')} className={`rounded border ${th.inputBorder} px-3 py-2 text-xs ${th.textMuted}`}>Back</button><button disabled={busy} onClick={() => void refreshForOrder()} className="rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'VERIFYING…' : 'CONTINUE TO ORDER →'}</button></div></div>}
    {step === 'confirm' && selected && <div className="space-y-4"><section className={`rounded border ${th.border} p-4 text-xs`}><p className={`font-bold ${th.text}`}>Buy to Open · {selected.ticker} {selected.expiration} {selected.strike} {selected.direction === 'C' ? 'Call' : 'Put'}</p><p className={`mt-2 ${th.textMuted}`}>Fresh quote {freshQuoteAt ? new Date(freshQuoteAt).toLocaleTimeString() : 'unavailable'} · Buying power {buyingPower == null ? 'unavailable' : money(buyingPower)}</p><label className={`mt-4 flex flex-col gap-1 ${th.textMuted}`}>Contracts<input type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value)))} className={`${th.input} border ${th.inputBorder} mt-1 w-24 rounded px-2 py-1 ${th.text}`} /></label><label className={`mt-3 flex flex-col gap-1 ${th.textMuted}`}>Limit debit per contract<input type="number" min="0.01" step="0.01" value={limitPrice} onChange={event => { setLimitPrice(Number(event.target.value)); setFreshQuoteAt(null); }} className={`${th.input} border ${th.inputBorder} mt-1 w-24 rounded px-2 py-1 ${th.text}`} /></label><p className={`mt-4 ${th.text}`}>Estimated total debit: <b>{money(totalDebit)}</b> · Maximum loss is limited to premium paid.</p></section><p className="rounded border border-amber-600 bg-amber-500/10 p-3 text-xs text-amber-200">Submitting sends a limit order to your broker; it is not a fill. No automatic profit target or stop is attached.</p>{error && <p role="alert" className="text-xs text-red-400">{error}</p>}<div className="flex gap-2"><button onClick={() => setStep('review')} className={`rounded border ${th.inputBorder} px-3 py-2 text-xs ${th.textMuted}`}>Back</button><button disabled={busy} onClick={() => void refreshForOrder()} className={`rounded border border-cyan-500 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50`}>Refresh quote & buying power</button><button disabled={!canSubmit} onClick={() => void submit()} className="rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'SUBMITTING…' : 'SUBMIT BROKER ORDER →'}</button></div></div>}
    {step === 'status' && <div className="space-y-4"><section className={`rounded border border-cyan-600 bg-cyan-500/10 p-4`}><p className="text-xs font-bold text-cyan-200">{orderStatus}</p><p className={`mt-1 text-xs ${th.textMuted}`}>Order ID: {orderId}</p><p className={`mt-3 text-xs ${th.textMuted}`}>A filled order appears in Portfolio from broker data. A working, canceled, rejected, or expired order does not create a position.</p></section>{error && <p role="alert" className="text-xs text-red-400">{error}</p>}<div className="flex gap-2"><button disabled={busy} onClick={() => void refreshOrderStatus()} className="rounded border border-cyan-500 px-3 py-2 text-xs font-bold text-cyan-300">Refresh order status</button><a href="/portfolio" className="rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white">View Portfolio →</a><button onClick={onClose} className={`rounded border ${th.inputBorder} px-3 py-2 text-xs ${th.textMuted}`}>Close</button></div></div>}
  </ScanModalShell>;
}
