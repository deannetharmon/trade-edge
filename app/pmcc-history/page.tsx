'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Snapshot = { id: string; symbol: string; submittedAt: string; brokerOrderId: string; policyVersion: string; expiresAt: string; long: { occSymbol: string | null; ask: number | null; quoteAt: string | null }; short: { occSymbol: string | null; bid: number | null; quoteAt: string | null }; eventRisk: { status: string; blockers: string[]; cautions: string[]; policyVersion: string }; occAcknowledgedAt: string | null };
type LifecycleEvent = { id: string; symbol: string; positionKey: string; observedAt: string; status: string; alerts: { id: string; severity: string; message: string }[]; expiresAt: string };
const displayDate = (value: string) => new Date(value).toLocaleString();

export default function PmccHistoryPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [lifecycleEvents, setLifecycleEvents] = useState<LifecycleEvent[]>([]);
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams();
    if (symbol) params.set('symbol', symbol);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setLoading(true); setError(null);
    fetch(`/api/pmcc-history?${params}`).then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Unable to load PMCC history');
      return response.json();
    }).then(data => { setSnapshots(data.snapshots ?? []); setLifecycleEvents(data.lifecycleEvents ?? []); }).catch(e => setError(e instanceof Error ? e.message : 'Unable to load PMCC history')).finally(() => setLoading(false));
  }, [symbol, status, from, to]);
  const events = useMemo(() => [
    ...snapshots.map(row => ({ time: row.submittedAt, type: 'Submitted Review Snapshot', row })),
    ...lifecycleEvents.map(row => ({ time: row.observedAt, type: 'Post-Entry Lifecycle Alert', row })),
  ].sort((a, b) => b.time.localeCompare(a.time)), [snapshots, lifecycleEvents]);
  return <main className="min-h-screen bg-[#07090c] px-5 py-8 text-slate-100">
    <div className="mx-auto max-w-6xl"><div className="mb-6 flex items-center justify-between"><div><h1 className="text-2xl font-bold">PMCC History</h1><p className="mt-1 text-sm text-slate-400">Read-only audit history. Records show facts captured at submission or monitoring time; no action is taken here.</p></div><Link href="/portfolio" className="rounded border border-cyan-700 px-3 py-2 text-sm text-cyan-300">Back to Portfolio</Link></div>
      <section className="mb-5 grid gap-2 rounded border border-slate-800 bg-slate-950 p-3 sm:grid-cols-4"><input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol" className="rounded bg-slate-900 px-3 py-2 text-sm" /><select value={status} onChange={e => setStatus(e.target.value)} className="rounded bg-slate-900 px-3 py-2 text-sm"><option value="">All statuses</option><option>ON_TRACK</option><option>MONITOR</option><option>ACTION_REQUIRED</option><option>DATA_UNAVAILABLE</option></select><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded bg-slate-900 px-3 py-2 text-sm" /><input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded bg-slate-900 px-3 py-2 text-sm" /></section>
      {loading ? <p className="text-slate-400">Loading history…</p> : error ? <p className="rounded border border-red-800 bg-red-950/30 p-3 text-red-200">{error}</p> : events.length === 0 ? <p className="rounded border border-slate-800 bg-slate-950 p-5 text-slate-400">History appears after a PMCC is submitted and/or a confirmed PMCC position is monitored.</p> : <div className="space-y-3">{events.map(event => <details key={`${event.type}-${event.row.id}`} className="rounded border border-slate-800 bg-slate-950 p-4"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b>{event.type}</b><span className="font-sans text-cyan-300">{event.row.symbol}</span><span className="text-sm text-slate-400">{displayDate(event.time)}</span>{'status' in event.row && <span className="rounded bg-amber-950 px-2 py-0.5 text-xs text-amber-200">{event.row.status.replaceAll('_', ' ')}</span>}</div></summary>{event.type === 'Submitted Review Snapshot' ? <SnapshotDetail row={event.row as Snapshot} /> : <LifecycleDetail row={event.row as LifecycleEvent} />}</details>)}</div>}
    </div></main>;
}
function SnapshotDetail({ row }: { row: Snapshot }) { return <div className="mt-4 space-y-2 border-t border-slate-800 pt-3 text-sm text-slate-300"><p>Broker order ID: <b>{row.brokerOrderId}</b> · Policy: {row.policyVersion} · Retained through {displayDate(row.expiresAt)}</p><p>Long: {row.long.occSymbol ?? 'unavailable'} · ask ${row.long.ask ?? '—'} · {row.long.quoteAt ?? 'timestamp unavailable'}</p><p>Short: {row.short.occSymbol ?? 'unavailable'} · bid ${row.short.bid ?? '—'} · {row.short.quoteAt ?? 'timestamp unavailable'}</p><p>Event review: {row.eventRisk.status} ({row.eventRisk.policyVersion})</p><p>OCC acknowledgment: {row.occAcknowledgedAt ?? 'not recorded'}</p>{[...row.eventRisk.blockers, ...row.eventRisk.cautions].map(reason => <p key={reason} className="text-amber-200">• {reason}</p>)}</div>; }
function LifecycleDetail({ row }: { row: LifecycleEvent }) { return <div className="mt-4 space-y-2 border-t border-slate-800 pt-3 text-sm text-slate-300"><p>Position pair: {row.positionKey} · Retained through {displayDate(row.expiresAt)}</p><p className="text-slate-400">Informational/manual-review item only. It does not place, roll, or close an order.</p>{row.alerts.length ? row.alerts.map(alert => <p key={alert.id} className={alert.severity === 'critical' ? 'text-red-300' : 'text-amber-200'}>• {alert.message}</p>) : <p className="text-emerald-300">No current lifecycle alert.</p>}</div>; }
