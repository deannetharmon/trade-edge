// features/market/MarketMapPanel.tsx
//
// MARKET-MAP-0001: the Market Map. Stocks as tiles grouped by sector, tile size by weight, color by today's % change from TastyTrade
// quotes. Stocks you hold options or shares on are outlined and labelled; a red outline marks one moving against you by 2% or more.
// Layout is computed in a 1000 x 620 space and drawn with percentages, so it scales to any width.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import { ttFetch } from '@/lib/scans/tastytrade-client';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
import { INDEXES, STOCKS, type IndexKey, type SectorName } from '@/lib/market/universe';
import { fetchStockQuotes, type QuoteReport } from '@/lib/market/marketQuotes';
import { buildHoldings, type TileHolding } from '@/lib/market/holdings';
import { colorBucket, holdingLabel, movingAgainst, netExposure, type ColorBucket, type Exposure } from '@/lib/market/marketMapMath';
import { squarify, type Rect } from '@/lib/market/treemap';

const W = 1000;
const H = 620;
const SECTOR_LABEL_H = 20;
const REFRESH_MS = 60_000;

const BUCKET_BG: Record<ColorBucket, string> = {
  dn4: '#c2323c', dn3: '#a3323a', dn2: '#86303a', dn1: '#682d33', flat: '#3a4450',
  up1: '#1f5a42', up2: '#1d7650', up3: '#169468', up4: '#12ad76', none: '#2a2f36',
};
// MARKET-MAP-0003: a held stock must stand out on any tile color (a red outline vanishes on a red tile). A white ring with a dark halo
// shows a holding; amber replaces white when the move is against you. An arrow says which way you gain.
const RING_HELD = 'inset 0 0 0 3px #ffffff, inset 0 0 0 5px rgba(0,0,0,0.8)';
const RING_AGAINST = 'inset 0 0 0 3px #ffd23f, inset 0 0 0 5px rgba(0,0,0,0.8)';
const RING_HELD_THIN = 'inset 0 0 0 2px #ffffff, inset 0 0 0 3px rgba(0,0,0,0.8)';
const RING_AGAINST_THIN = 'inset 0 0 0 2px #ffd23f, inset 0 0 0 3px rgba(0,0,0,0.8)';
const ARROW: Record<Exposure, { glyph: string; hint: string }> = {
  bullish: { glyph: '\u25B2', hint: 'you gain if it rises' },
  bearish: { glyph: '\u25BC', hint: 'you gain if it falls' },
  neutral: { glyph: '\u25C6', hint: 'no net direction' },
};
const LEGEND: ColorBucket[] = ['dn4', 'dn3', 'dn2', 'dn1', 'flat', 'up1', 'up2', 'up3', 'up4'];

interface Tile { ticker: string; rect: Rect; pct: number | null; bucket: ColorBucket; holding: TileHolding | null; against: boolean }
interface SectorBlock { name: SectorName; rect: Rect; tiles: Tile[] }

const fmtPct = (p: number | null) => (p == null ? 'n/a' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(2)}%`);
const pctOf = (r: Rect) => ({ left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` });

export default function MarketMapPanel({ textClass, mutedClass, borderClass, cardClass }: { textClass: string; mutedClass: string; borderClass: string; cardClass: string }) {
  const [indexKey, setIndexKey] = useState<IndexKey>('spx');
  const [mineOnly, setMineOnly] = useState(false);
  const [report, setReport] = useState<QuoteReport | null>(null);
  const [holdings, setHoldings] = useState<Map<string, TileHolding>>(new Map());
  const [holdingsNote, setHoldingsNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const index = INDEXES.find(i => i.key === indexKey)!;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    let held = new Map<string, TileHolding>();
    try {
      const token = await getAccessToken();
      const account = await requireActiveBrokerAccount(token, ttFetch);
      if (account) {
        const data = await ttFetch(`/accounts/${account}/positions`, token);
        held = buildHoldings(data?.data?.items);
        setHoldings(held); setHoldingsNote('');
      }
    } catch { setHoldings(new Map()); setHoldingsNote('Your positions could not be loaded, so none are outlined.'); }
    try {
      const token = await getAccessToken();
      // Held symbols that have no tile on this map (funds, stocks outside the list, other indexes) are quoted too, so they can be listed below.
      const onMap = new Set(index.tickers);
      const extras = Array.from(held.keys()).filter(t => !onMap.has(t));
      const next = await fetchStockQuotes([...index.tickers, ...extras], path => ttFetch(path, token));
      setReport(next); setUpdatedAt(Date.now());
      if (next.received === 0) setError('TastyTrade returned no quotes. Check that you are signed in, then refresh.');
    } catch (e: any) { setError(e?.message ?? 'Could not load quotes.'); }
    setLoading(false);
  }, [index]);

  useEffect(() => { setReport(null); load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const sectors = useMemo<SectorBlock[]>(() => {
    const quotes = report?.quotes;
    const bySector = new Map<SectorName, { ticker: string; weight: number }[]>();
    for (const ticker of index.tickers) {
      const info = STOCKS[ticker];
      if (!info) continue;
      if (mineOnly && !holdings.has(ticker)) continue;
      const weight = index.weighting === 'price' ? (quotes?.get(ticker)?.last ?? 0) : info.cap;
      if (!(weight > 0)) continue;
      const list = bySector.get(info.sector) ?? [];
      list.push({ ticker, weight }); bySector.set(info.sector, list);
    }
    const sectorItems = Array.from(bySector.entries()).map(([name, list]) => ({ value: list.reduce((s, t) => s + t.weight, 0), data: { name, list } }));
    return squarify(sectorItems, { x: 0, y: 0, w: W, h: H }).map(({ item, rect }) => {
      const inner: Rect = { x: rect.x, y: rect.y + SECTOR_LABEL_H, w: rect.w, h: Math.max(0, rect.h - SECTOR_LABEL_H) };
      const placed = squarify(item.data.list.map(t => ({ value: t.weight, data: t.ticker })), inner);
      const tiles: Tile[] = placed.map(({ item: t, rect: r }) => {
        const pct = quotes?.get(t.data)?.pct ?? null;
        const holding = holdings.get(t.data) ?? null;
        return { ticker: t.data, rect: r, pct, bucket: colorBucket(pct), holding, against: holding ? movingAgainst(netExposure(holding), pct) : false };
      });
      return { name: item.data.name, rect, tiles };
    });
  }, [report, index, mineOnly, holdings]);

  // Holdings with no tile on this map: shown under the map so no position is hidden.
  const offMap = useMemo(() => {
    const onMap = new Set(index.tickers.filter(t => STOCKS[t]));
    return Array.from(holdings.entries()).filter(([t]) => !onMap.has(t)).map(([ticker, holding]) => {
      const pct = report?.quotes.get(ticker)?.pct ?? null;
      return { ticker, holding, pct, bucket: colorBucket(pct), against: movingAgainst(netExposure(holding), pct) };
    });
  }, [holdings, report, index]);

  const missing = report ? Math.max(0, report.requested - report.withChange - offMap.filter(o => report.quotes.get(o.ticker)?.pct == null).length) : 0;
  const heldCount = holdings.size;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`inline-flex rounded border ${borderClass} overflow-hidden`} role="group" aria-label="Index">
          {INDEXES.map(i => (
            <button key={i.key} onClick={() => setIndexKey(i.key)} aria-pressed={i.key === indexKey}
              className={`px-3 py-1.5 text-xs ${i.key === indexKey ? 'bg-sky-600 text-white font-semibold' : `${mutedClass}`}`}>{i.label}</button>
          ))}
        </div>
        <div className={`inline-flex rounded border ${borderClass} overflow-hidden`} role="group" aria-label="Show">
          <button onClick={() => setMineOnly(false)} aria-pressed={!mineOnly} className={`px-3 py-1.5 text-xs ${!mineOnly ? 'bg-sky-600 text-white font-semibold' : mutedClass}`}>All</button>
          <button onClick={() => setMineOnly(true)} aria-pressed={mineOnly} className={`px-3 py-1.5 text-xs ${mineOnly ? 'bg-sky-600 text-white font-semibold' : mutedClass}`}>My positions</button>
        </div>
        <button onClick={load} disabled={loading} className={`px-3 py-1.5 text-xs rounded border ${borderClass} ${mutedClass} disabled:opacity-50`}>{loading ? 'Loading…' : 'Refresh'}</button>
        <span className={`ml-auto text-[11px] ${mutedClass}`} data-testid="market-map-updated">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}</span>
      </div>

      {error && <div className="text-xs text-red-400 border border-red-500/40 rounded p-2">{error}</div>}
      {holdingsNote && <div className="text-xs text-amber-300">{holdingsNote}</div>}
      {report && report.received > 0 && missing > 0 && (
        <div className="text-xs text-amber-300" data-testid="market-map-missing">
          {missing} of {report.requested} stocks have no % change ({report.requested - report.received} not returned by TastyTrade, {report.received - report.withChange} returned without a previous close). They are drawn gray.
        </div>
      )}

      <div className={`relative w-full ${cardClass} border ${borderClass} rounded overflow-hidden`} style={{ aspectRatio: `${W} / ${H}`, containerType: 'inline-size' }} data-testid="market-map">
        {sectors.length === 0 && !loading && (
          <div className={`absolute inset-0 flex items-center justify-center text-sm ${mutedClass}`}>{mineOnly ? 'None of your positions are in this index.' : 'Nothing to draw yet.'}</div>
        )}
        {sectors.map(sector => (
          <div key={sector.name} className="absolute" style={pctOf(sector.rect)}>
            <div className={`absolute left-1 top-0.5 uppercase tracking-wider ${mutedClass}`} style={{ fontSize: '1cqw', lineHeight: 1.2 }}>{sector.name}</div>
          </div>
        ))}
        {sectors.flatMap(sector => sector.tiles).map(tile => {
          const minSide = Math.min(tile.rect.w, tile.rect.h);
          const showText = minSide > 26;
          const showPct = minSide > 40;
          // Small tiles keep the ring and the arrow badge; the label (and the tooltip) carry the detail, so nothing spills past the tile.
          const showLabel = minSide > 70;
          const thin = minSide < 45;
          const base = Math.max(0.8, Math.min(3.2, minSide / 28));
          const holding = tile.holding;
          const label = holding ? `${holding.via ? `${holding.via}: ` : ''}${holdingLabel(holding)}` : '';
          return (
            <div key={tile.ticker} title={`${tile.ticker} ${fmtPct(tile.pct)}${label ? ` · ${label}` : ''}`}
              className="absolute flex flex-col items-center justify-center text-center text-white overflow-hidden"
              style={{
                ...pctOf(tile.rect), background: BUCKET_BG[tile.bucket], border: '1px solid rgba(0,0,0,0.45)',
                boxShadow: tile.against ? (thin ? RING_AGAINST_THIN : RING_AGAINST) : holding ? (thin ? RING_HELD_THIN : RING_HELD) : undefined,
              }}>
              {holding && minSide > 30 && (
                <span className="absolute left-1 top-1 rounded font-bold leading-none"
                  style={{ background: tile.against ? '#ffd23f' : '#ffffff', color: '#111', fontSize: `${Math.max(0.8, base * 0.5)}cqw`, padding: '0.25cqw 0.5cqw' }}
                  title={ARROW[netExposure(holding)].hint}>{ARROW[netExposure(holding)].glyph}{tile.against ? ' \u26A0' : ''}</span>
              )}
              {showText && <b style={{ fontSize: `${base}cqw`, lineHeight: 1.1 }}>{tile.ticker}</b>}
              {showPct && <span style={{ fontSize: `${Math.max(0.7, base * 0.7)}cqw` }}>{fmtPct(tile.pct)}</span>}
              {showLabel && holding && <span className="mt-0.5 max-w-full truncate rounded px-1 font-semibold" style={{ background: tile.against ? '#ffd23f' : '#ffffff', color: '#111', fontSize: `${Math.max(0.65, base * 0.45)}cqw`, lineHeight: 1.3 }}>{label}</span>}
            </div>
          );
        })}
      </div>

      {offMap.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="market-map-offmap">
          <div className={`text-[11px] uppercase tracking-wider ${mutedClass}`}>Your other positions (not on this map)</div>
          <div className="flex flex-wrap gap-2">
            {offMap.map(o => (
              <div key={o.ticker} className="flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-white"
                style={{ background: BUCKET_BG[o.bucket], boxShadow: o.against ? RING_AGAINST : RING_HELD }}>
                <span className="rounded px-1 font-bold" style={{ background: o.against ? '#ffd23f' : '#ffffff', color: '#111' }} title={ARROW[netExposure(o.holding)].hint}>{ARROW[netExposure(o.holding)].glyph}{o.against ? ' \u26A0' : ''}</span>
                <b>{o.ticker}</b><span>{fmtPct(o.pct)}</span><span className="rounded px-1 text-[10px] font-semibold" style={{ background: o.against ? '#ffd23f' : '#ffffff', color: '#111' }}>{holdingLabel(o.holding)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-1 text-[11px] ${mutedClass}`} aria-label="Color scale">
        <span>≤ −3%</span>{LEGEND.map(b => <i key={b} style={{ background: BUCKET_BG[b], display: 'inline-block', width: 30, height: 10 }} />)}<span>≥ +3%</span>
      </div>
      <div className={`text-[11px] ${mutedClass}`}>
        {index.scope} Tile size is approximate{index.weighting === 'cap' ? ' (rounded market caps, refreshed by hand)' : ''}. White ring: you hold options or shares on it
        ({heldCount} in all). ▲ you gain if it rises, ▼ you gain if it falls. Amber ring with ⚠: it is moving 2% or more against that position today.
      </div>
    </div>
  );
}
