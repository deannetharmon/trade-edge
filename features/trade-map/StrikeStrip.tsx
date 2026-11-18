// features/trade-map/StrikeStrip.tsx
//
// OPTMAP-0001 S2i: the strike strip. The strategy's legs are markers on the listed strikes; drag a marker, click a
// strike to move the nearest leg, or use the arrow keys on a focused marker. Bars show open interest (thin strikes are
// dimmed). Moving a marker only changes the strikes; it never sends anything.

'use client';

import { useEffect, useRef, useState } from 'react';
import { labelEvery, strikeAtX, THIN_OI, nearestMover, widthLabel, type StripMarker } from '@/lib/trademap/stripModel';

export interface StripLegInfo { label: string; text: string; tone: 'good' | 'thin' | 'plain' }

export interface StrikeStripProps {
  th: any;
  strikes: number[];
  spot: number;
  markers: StripMarker[];
  oi: Record<number, number | null>;
  legInfo: StripLegInfo[];
  onMove: (role: 'anchor' | 'width' | 'slide', strike: number) => void;
  onStep: (role: 'anchor' | 'width', dir: -1 | 1) => void;
}

export default function StrikeStrip({ th, strikes, spot, markers, oi, legInfo, onMove, onStep }: StrikeStripProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<number | null>(null);
  // Set while the whole spread is being slid: the strike grabbed and the short strike when the grab began.
  const slideRef = useRef<{ grab: number; anchor: number } | null>(null);
  // The strip fills the card, so changing the zoom really changes how wide each strike (and a $5 spread) looks.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(1000);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => { if (el.clientWidth > 0) setBoxW(el.clientWidth); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const count = strikes.length;
  if (count < 2) return null;

  const px = Math.max(3, Math.min(44, (boxW - 2) / count));
  const width = count * px;
  const every = labelEvery(count);
  const idxOf = (k: number) => strikes.indexOf(k);
  const centerOf = (k: number) => idxOf(k) * px + px / 2;
  const maxOi = Math.max(1, ...strikes.map(k => oi[k] ?? 0));
  const markerStrikes = markers.map(m => m.strike);

  // The stock's position, interpolated between the two listed strikes around it.
  let spotX: number | null = null;
  if (spot >= strikes[0] && spot <= strikes[count - 1]) {
    let i = 0;
    while (i < count - 2 && strikes[i + 1] <= spot) i += 1;
    const frac = (spot - strikes[i]) / (strikes[i + 1] - strikes[i]);
    spotX = (i + frac) * px + px / 2;
  }

  // Shade the span of each side's legs.
  const spans: Array<{ left: number; width: number; label: string }> = [];
  for (const right of ['P', 'C'] as const) {
    const ks = markers.filter(m => m.right === right).map(m => m.strike).filter(k => idxOf(k) >= 0);
    if (ks.length >= 2) {
      const lo = Math.min(...ks); const hi = Math.max(...ks);
      spans.push({ left: centerOf(lo), width: centerOf(hi) - centerOf(lo), label: widthLabel(lo, hi) });
    }
  }

  const trackX = (clientX: number) => clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
  const moveTo = (role: 'anchor' | 'width', clientX: number) => {
    const k = strikeAtX(strikes, trackX(clientX), px);
    if (k == null || k === lastRef.current) return;
    lastRef.current = k;
    onMove(role, k);
  };

  const anchorStrike = markers.find(m => m.role === 'anchor')?.strike ?? null;
  const beginSlide = (e: React.PointerEvent<HTMLElement>) => {
    const grab = strikeAtX(strikes, trackX(e.clientX), px);
    if (grab == null || anchorStrike == null) return false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    slideRef.current = { grab, anchor: anchorStrike };
    lastRef.current = anchorStrike;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
  const slideTo = (clientX: number) => {
    const sl = slideRef.current;
    const at = strikeAtX(strikes, trackX(clientX), px);
    if (!sl || at == null) return;
    const idx = strikes.indexOf(sl.anchor) + (strikes.indexOf(at) - strikes.indexOf(sl.grab));
    const k = strikes[Math.min(strikes.length - 1, Math.max(0, idx))];
    if (k === lastRef.current) return;
    lastRef.current = k;
    onMove('slide', k);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className={`text-xs ${th.textFaint}`}>Drag a circle to change one leg. Drag the shaded band (or Shift-drag a circle) to slide the whole spread. Click a strike to move the nearest leg.</div>
      <div className="overflow-x-auto" ref={boxRef}>
        <div
          ref={trackRef}
          className="relative mx-auto select-none"
          style={{ width, height: 170, touchAction: 'pan-y' }}
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button')) return;
            const k = strikeAtX(strikes, trackX(e.clientX), px);
            const m = k == null ? null : nearestMover(markers, k);
            if (k != null && m && (m.role === 'anchor' || m.role === 'width')) { lastRef.current = null; onMove(m.role, k); }
          }}
        >
          {spans.map((sp, i) => (
            <div
              key={i}
              data-testid="spread-band"
              className="absolute"
              style={{ left: sp.left, width: sp.width, top: 28, bottom: 34, background: 'rgba(106,160,255,0.10)', borderLeft: '1px solid #6aa0ff', borderRight: '1px solid #6aa0ff', cursor: 'grab', touchAction: 'none' }}
              onPointerDown={e => { beginSlide(e); }}
              onPointerMove={e => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) slideTo(e.clientX); }}
              onPointerUp={() => { slideRef.current = null; }}
              onPointerCancel={() => { slideRef.current = null; }}
            >
              <div className="absolute text-[11px] font-semibold whitespace-nowrap" style={{ left: '50%', top: 4, transform: 'translateX(-50%)', color: '#9fc0ff', pointerEvents: 'none' }}>{sp.label}</div>
            </div>
          ))}
          {strikes.map((k, i) => {
            const v = oi[k];
            const h = v == null ? 4 : Math.max(6, Math.round((v / maxOi) * 64));
            const thin = v == null || v < THIN_OI;
            return (
              <div key={k}>
                <div title={`${k}: ${v == null ? 'open interest unavailable' : `open interest ${v.toLocaleString()}`}`} className="absolute" style={{ left: i * px + Math.max(1, px * 0.18), bottom: 34, width: Math.max(2, px * 0.64), height: h, background: thin ? '#2a3347' : '#3a465e', borderRadius: '3px 3px 0 0' }} />
                {(i % every === 0 || markerStrikes.indexOf(k) >= 0) && (
                  <div className="absolute text-[11px] text-center" style={{ left: i * px - 8, width: px + 16, bottom: 12, color: markerStrikes.indexOf(k) >= 0 ? '#e8ecf4' : '#7c88a1', pointerEvents: 'none' }}>{k}</div>
                )}
              </div>
            );
          })}
          {spotX != null && (
            <>
              <div className="absolute" style={{ left: spotX, top: 22, bottom: 34, borderLeft: '1px dashed rgba(255,255,255,0.75)', pointerEvents: 'none' }} />
              <div className="absolute text-[11px]" style={{ left: spotX, top: 4, transform: 'translateX(-50%)', color: '#cfd6e6', pointerEvents: 'none' }}>${spot.toFixed(2)}</div>
            </>
          )}
          {markers.map(m => {
            if (idxOf(m.strike) < 0) return null;
            const movable = m.role === 'anchor' || m.role === 'width';
            const filled = m.side === 'short';
            return (
              <button
                key={`${m.right}-${m.side}-${m.role}`}
                type="button"
                disabled={!movable}
                aria-label={`${m.side === 'short' ? 'Short' : 'Long'} ${m.strike} ${m.right === 'P' ? 'put' : 'call'}${movable ? ', drag or use arrow keys to move' : ', follows the other side'}`}
                className="absolute rounded-full font-bold"
                style={{
                  left: centerOf(m.strike), top: 62, width: 36, height: 36, marginLeft: -18, fontSize: 20, lineHeight: '30px',
                  border: '2px solid #6aa0ff', background: filled ? '#6aa0ff' : '#0d121c', color: filled ? '#0d121c' : '#6aa0ff',
                  cursor: movable ? 'grab' : 'default', opacity: movable ? 1 : 0.6, touchAction: 'none',
                }}
                onPointerDown={e => {
                  if (!movable) return;
                  if (e.shiftKey && m.role === 'anchor' && beginSlide(e)) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  slideRef.current = null;
                  lastRef.current = m.strike;
                  e.preventDefault();
                }}
                onPointerMove={e => {
                  if (!movable || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
                  if (slideRef.current) { slideTo(e.clientX); return; }
                  moveTo(m.role as 'anchor' | 'width', e.clientX);
                }}
                onPointerUp={() => { slideRef.current = null; }}
                onKeyDown={e => {
                  if (!movable) return;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(m.role as 'anchor' | 'width', -1); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); onStep(m.role as 'anchor' | 'width', 1); }
                }}
              >{filled ? '−' : '+'}</button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 text-xs">
        {legInfo.map(l => (
          <div key={l.label} className={th.textFaint}>
            <span className={th.text}>{l.label}</span> · {l.text}{' '}
            {l.tone === 'good' && <span className="text-emerald-400">liquid</span>}
            {l.tone === 'thin' && <span className="text-rose-400">thin open interest</span>}
          </div>
        ))}
      </div>
      <div className={`text-[11px] ${th.textFaint}`}>Dimmed bars: open interest under {THIN_OI}. Arrow keys move a focused marker one strike.</div>
    </div>
  );
}
