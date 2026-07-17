// app/debug/position-snapshots/page.tsx
//
// PI-0009A: Position Snapshot Engine, V1. A bare developer/debug view that
// confirms lifecycle snapshots are actually being recorded -- nothing more.
// No analytics, no charts, no reporting: just the raw store, one row per
// snapshot, newest first. Intentionally unstyled beyond basic legibility.

'use client';

import { useEffect, useState } from 'react';
import type { PositionSnapshotStore, PositionLifecycleSnapshot } from '@/lib/position-snapshot';

interface Row extends PositionLifecycleSnapshot {
  positionKeyCol: string;
}

export default function PositionSnapshotsDebugPage() {
  const [store, setStore] = useState<PositionSnapshotStore | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/position-lifecycle-snapshots')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`fetch ${res.status}`))))
      .then(data => setStore(data?.snapshots ?? {}))
      .catch(e => setError(e.message));
  }, []);

  const rows: Row[] = store
    ? Object.entries(store)
        .flatMap(([positionKey, snapshots]) => snapshots.map(s => ({ ...s, positionKeyCol: positionKey })))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    : [];

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Position Lifecycle Snapshots (debug)</h1>
      {error && <p style={{ color: '#f66' }}>Error: {error}</p>}
      {!store && !error && <p>Loading...</p>}
      {store && (
        <>
          <p style={{ marginBottom: 12, opacity: 0.7 }}>
            {rows.length} snapshot{rows.length === 1 ? '' : 's'} across {Object.keys(store).length} position key{Object.keys(store).length === 1 ? '' : 's'}
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Captured At', 'Event', 'Position Key', 'Symbol', 'Strategy', 'DTE', 'Recommendation', 'Confidence', 'Health', 'Net Edge', 'Opp Remaining %', 'Key Evidence'].map(h => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '4px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>{r.capturedAt}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.event}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.positionKeyCol}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.symbol}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.strategy}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.dte}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.recommendation ?? '—'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.confidence ?? '—'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.healthScore ?? '—'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.netEdge ?? '—'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{r.remainingOpportunityPct ?? '—'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222', maxWidth: 320 }}>{r.keyEvidence.join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
