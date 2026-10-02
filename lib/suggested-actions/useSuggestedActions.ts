// lib/suggested-actions/useSuggestedActions.ts
//
// SUGGESTED-ACTIONS-0001 slice 3: dashboard hook. Runs the pure rule over the shared portfolio data
// the dashboard already holds, keeps the saved "armed" state (/api/suggested-actions-state) in step,
// and ticks so cards go stale 2 minutes after the last refresh without a page action.
// Nothing here fetches broker data, evaluates in the background, or touches an order.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';
import { buildIncomeOpportunities } from '@/features/portfolio/positions-workspace/model/buildPositionsWorkspaceModel';
import { buildPmccShortCallSuggestions, type PmccSuggestionResult } from './pmccShortCallSuggestion';

const STATE_URL = '/api/suggested-actions-state';
const TICK_MS = 15_000;

export interface UseSuggestedActionsInput {
  /** LIVE portfolio mode only; when false the hook does nothing (no fetch, no save, no cards). */
  enabled: boolean;
  positions: Position[];
  pendingOrders: PendingOrder[];
  snapshot: PortfolioSnapshot | null;
  snapshotDataQuality: SnapshotDataQuality;
  lastRefresh: Date | null;
}

const EMPTY: PmccSuggestionResult = { cards: [], overflow: 0, armedKeys: {}, stale: false, asOf: null };

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every(key => a[key] === b[key]);
}

export function useSuggestedActions(input: UseSuggestedActionsInput): PmccSuggestionResult {
  const { enabled, positions, pendingOrders, snapshot, snapshotDataQuality, lastRefresh } = input;
  // null until the saved state has loaded; stateless === true when it could not be loaded (rule then needs +100% every time).
  const [armed, setArmed] = useState<Record<string, string> | null>(null);
  const [stateless, setStateless] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const saved = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(STATE_URL);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const map = body?.armed && typeof body.armed === 'object' ? (body.armed as Record<string, string>) : {};
        if (cancelled) return;
        saved.current = map;
        setArmed(map);
      } catch {
        if (cancelled) return;
        setStateless(true); // no error UI: fall back to the plain +100% test
        setArmed({});
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const result = useMemo<PmccSuggestionResult>(() => {
    if (!enabled || armed == null) return EMPTY;
    const evidenceCurrent = snapshot?.freshness === 'current' && snapshot.dataQuality.status === 'ok' && Boolean(snapshot.accountNumber);
    const opportunities = buildIncomeOpportunities({ snapshot, positions, pendingOrders, snapshotDataQuality });
    const intentByKey: Record<string, string> = {};
    for (const position of positions) intentByKey[position.key] = position.intent;
    return buildPmccShortCallSuggestions({
      opportunities, intentByKey, armedKeys: stateless ? {} : armed, evidenceCurrent, lastRefresh, now,
    });
  }, [enabled, armed, stateless, snapshot, positions, pendingOrders, snapshotDataQuality, lastRefresh, now]);

  // Save only when the rule changed the armed set (once per load in practice).
  useEffect(() => {
    if (!enabled || armed == null || stateless) return;
    if (sameMap(result.armedKeys, saved.current)) return;
    const next = result.armedKeys;
    saved.current = next;
    setArmed(next);
    fetch(STATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ armed: next }) }).catch(() => { /* best effort */ });
  }, [enabled, armed, stateless, result.armedKeys]);

  return result;
}
