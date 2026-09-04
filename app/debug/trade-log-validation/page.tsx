// app/debug/trade-log-validation/page.tsx
//
// TRADELOG-0001: a bare developer/debug view joining Trade Log's
// reconstructed ClosedTrade[] to the lifecycle snapshot engine's
// POSITION_CLOSE events, so the Net Edge (PW-0003) and POP (POP-0001)
// thresholds can be checked against what actually happened to real closed
// trades, split by classifyExit()'s real-vs-likely-premature outcome
// (Ian). No analytics, no charts, no filtering UI (Diane) -- plain table,
// newest-first, same intentionally-unstyled register as the existing
// /debug/position-snapshots page this one is modeled on.
//
// Join guard (Alan): position.key is only `${symbol}::${expiration}` --
// coarse enough that the SAME key can be reused across two genuinely
// different trades (a closed position, then a fresh re-entry at the same
// symbol+expiration later). Matching by key alone would risk pulling the
// wrong trade's close snapshot. Matched here by symbol AND the snapshot's
// capturedAt date landing on/near the specific trade's own closeDate --
// anchored to that trade's own known window, not just "any snapshot under
// this key".
//
// No new persisted state or API route (Quinn) -- reads the two existing
// stores (lifecycle snapshots, Trade Log reconstruction) and computes the
// join at render time, client-side.

'use client';

import { useEffect, useState } from 'react';
import type { PositionSnapshotStore, PositionLifecycleSnapshot } from '@/lib/position-snapshot';
import type { ClosedTrade } from '@/lib/tradeLog/types';
import { fetchAndReconstructTrades } from '@/lib/tradeLog/reconstructTrades';

// A POSITION_CLOSE snapshot's capturedAt is a full ISO timestamp; a trade's
// closeDate is a YYYY-MM-DD. "Near" means within this many days either side
// -- covers the snapshot engine capturing close a day late/early relative
// to the broker's reported close date, without matching a wildly different
// close event under the same symbol.
const CLOSE_MATCH_WINDOW_DAYS = 1;

interface Row {
  trade: ClosedTrade;
  closeSnapshot: PositionLifecycleSnapshot | null;
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / msPerDay;
}

function findCloseSnapshot(trade: ClosedTrade, store: PositionSnapshotStore): PositionLifecycleSnapshot | null {
  const allSnapshots = Object.values(store).flat();
  const candidates = allSnapshots.filter(s =>
    s.event === 'POSITION_CLOSE'
    && s.symbol === trade.symbol
    && daysBetween(s.capturedAt.slice(0, 10), trade.closeDate) <= CLOSE_MATCH_WINDOW_DAYS
  );
  if (candidates.length === 0) return null;
  // Multiple candidates (rare -- same symbol closed more than once within
  // the match window): take the one closest in time to the trade's own
  // closeDate, same "nearest wins" principle as PW-0003/PAIR-0001 rather
  // than an arbitrary pick.
  return candidates.reduce((nearest, s) =>
    daysBetween(s.capturedAt.slice(0, 10), trade.closeDate) < daysBetween(nearest.capturedAt.slice(0, 10), trade.closeDate) ? s : nearest
  );
}

// classifyExit's own categories, split by whether they're driven by a real,
// pre-defined rule (target/stop/time) vs. likely closed before either
// (Ian) -- the exact split that matters for reading this table honestly,
// per the circularity discussed earlier this session.
const LIKELY_PREMATURE: ClosedTrade['exitType'][] = ['SCRATCH_WIN', 'FAST_CUT'];

export default function TradeLogValidationDebugPage() {
  const [trades, setTrades] = useState<ClosedTrade[] | null>(null);
  const [snapshotStore, setSnapshotStore] = useState<PositionSnapshotStore | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetchAndReconstructTrades('12m'),
      fetch('/api/position-lifecycle-snapshots').then(res => (res.ok ? res.json() : Promise.reject(new Error(`fetch ${res.status}`)))),
    ])
      .then(([reconstruction, snapshotData]) => {
        setTrades(reconstruction.trades);
        setSnapshotStore(snapshotData?.snapshots ?? {});
      })
      .catch(e => setError(e.message));
  }, []);

  const rows: Row[] = trades && snapshotStore
    ? trades
        .map(trade => ({ trade, closeSnapshot: findCloseSnapshot(trade, snapshotStore) }))
        .sort((a, b) => b.trade.closeDate.localeCompare(a.trade.closeDate))
    : [];

  const matchedCount = rows.filter(r => r.closeSnapshot != null).length;

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Trade Log Validation (debug)</h1>
      <p style={{ marginBottom: 12, opacity: 0.7, maxWidth: 720 }}>
        Joins closed trades to their POSITION_CLOSE lifecycle snapshot, so Net Edge / POP thresholds can be checked
        against what actually happened. Exit Type splits real rule-driven exits (target/stop/time) from likely-premature
        closes (scratch win / fast cut) -- read the "likely premature" rows with more caution, since your own early-close
        pattern is exactly what those categories are flagging.
      </p>
      {error && <p style={{ color: '#f66' }}>Error: {error}</p>}
      {(!trades || !snapshotStore) && !error && <p>Loading...</p>}
      {trades && snapshotStore && (
        <>
          <p style={{ marginBottom: 12, opacity: 0.7 }}>
            {rows.length} closed trade{rows.length === 1 ? '' : 's'} · {matchedCount} matched to a close snapshot · {rows.length - matchedCount} with no snapshot data
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Close Date', 'Symbol', 'Strategy', 'P/L', 'P/L %', 'Exit Type', 'Net Edge @ Close', 'POP @ Close', 'Recommendation @ Close', 'Confidence'].map(h => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '4px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trade, closeSnapshot }) => (
                <tr key={trade.id}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>{trade.closeDate}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{trade.symbol}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{trade.strategy}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222', color: trade.pnl >= 0 ? '#6f6' : '#f66' }}>{trade.pnl.toFixed(0)}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{trade.pnlPct.toFixed(0)}%</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222', color: LIKELY_PREMATURE.includes(trade.exitType) ? '#fc6' : '#ddd' }}>
                    {trade.exitType}{LIKELY_PREMATURE.includes(trade.exitType) ? ' (likely premature)' : ''}
                  </td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{closeSnapshot?.netEdge != null ? closeSnapshot.netEdge.toFixed(0) : (closeSnapshot ? '—' : 'No snapshot data')}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{closeSnapshot?.pop != null ? `${closeSnapshot.pop.toFixed(0)}%` : (closeSnapshot ? '—' : 'No snapshot data')}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{closeSnapshot?.recommendation ?? (closeSnapshot ? '—' : 'No snapshot data')}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>{closeSnapshot?.confidence ?? (closeSnapshot ? '—' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
