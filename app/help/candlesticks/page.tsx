'use client';
// app/help/candlesticks/page.tsx
//
// Help lesson — Candlestick Analysis: Reading the Battle Between Buyers and
// Sellers (Lesson 1 of 6). Static educational content with illustrative
// example candles. Not a recommendation, screening, or execution surface;
// imports nothing from the decision/opportunity engines.
import { useState, useEffect } from 'react';
import { AppHeader } from '@/components/nav/AppHeader';
import { THEMES, getSavedTheme, type Theme } from '@/lib/theme';

type Candle = { o: number; h: number; l: number; c: number; v?: number };
type Th = typeof THEMES[Theme];

const GREEN = '#22a06b';
const RED = '#e24b4a';
const BLUE = '#3b82f6';

// ── Candle drawing ──────────────────────────────────────────────────────────
// Prices are on a 0–100 scale (100 = top of the chart).
function drawCandle(k: Candle, x: number, w: number, top: number, bottom: number, key: string | number) {
  const y = (v: number) => top + ((100 - v) / 100) * (bottom - top);
  const color = k.c >= k.o ? GREEN : RED;
  const bodyTop = y(Math.max(k.o, k.c));
  const bodyH = Math.max(Math.abs(y(k.o) - y(k.c)), 2);
  return (
    <g key={key}>
      <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth={2} />
      <rect x={x - w / 2} y={bodyTop} width={w} height={bodyH} rx={1} fill={color} />
    </g>
  );
}

function breakdown(k: Candle) {
  const range = k.h - k.l || 1;
  const top = Math.max(k.o, k.c);
  const bot = Math.min(k.o, k.c);
  return {
    upper: Math.round(((k.h - top) / range) * 100),
    body: Math.round(((top - bot) / range) * 100),
    lower: Math.round(((bot - k.l) / range) * 100),
  };
}

function directionOf(k: Candle): 'Bullish' | 'Bearish' | 'Neutral' {
  const range = k.h - k.l || 1;
  if (Math.abs(k.c - k.o) / range < 0.03) return 'Neutral';
  return k.c > k.o ? 'Bullish' : 'Bearish';
}

function DirectionTag({ d }: { d: 'Bullish' | 'Bearish' | 'Neutral' }) {
  const cls =
    d === 'Bullish' ? 'text-emerald-500 border-emerald-500/50'
    : d === 'Bearish' ? 'text-red-500 border-red-500/50'
    : 'text-slate-400 border-slate-500/50';
  return <span className={`border rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${cls}`}>{d}</span>;
}

function SingleCandle({ k }: { k: Candle }) {
  return (
    <svg viewBox="0 0 80 110" width="80" height="110" role="img" aria-label="Example candlestick">
      {drawCandle(k, 40, 22, 8, 102, 'c')}
    </svg>
  );
}

function CandleCard({ title, note, k, th }: { title: string; note: string; k: Candle; th: Th }) {
  const b = breakdown(k);
  return (
    <div className={`border ${th.border} ${th.card} rounded-lg p-3 flex flex-col items-center text-center gap-1.5`}>
      <div className="flex items-center justify-between w-full gap-2">
        <p className={`text-[11px] font-bold ${th.textMuted} text-left`}>{title}</p>
        <DirectionTag d={directionOf(k)} />
      </div>
      <SingleCandle k={k} />
      <p className={`text-[10px] ${th.textFaint} leading-snug`}>{note}</p>
      <p className={`text-[9px] ${th.textFaint}`}>
        Upper wick {b.upper}% · Body {b.body}% · Lower wick {b.lower}%
      </p>
    </div>
  );
}

function SeriesChart({
  candles, level, levelLabel, showVolume,
}: { candles: Candle[]; level?: number; levelLabel?: string; showVolume?: boolean }) {
  const W = 220;
  const H = showVolume ? 150 : 120;
  const volH = showVolume ? 30 : 0;
  const plotBottom = H - 8 - volH;
  const step = (W - 20) / candles.length;
  const maxV = Math.max(...candles.map((k) => k.v ?? 0), 1);
  const ly = level !== undefined ? 8 + ((100 - level) / 100) * (plotBottom - 8) : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example candlestick sequence">
      {level !== undefined && (
        <>
          <line x1={10} x2={W - 10} y1={ly} y2={ly} stroke={BLUE} strokeDasharray="4 3" />
          {levelLabel && (
            <text x={W - 10} y={ly + 12} fontSize={10} textAnchor="end" fill={BLUE}>{levelLabel}</text>
          )}
        </>
      )}
      {candles.map((k, i) => {
        const x = 10 + step * i + step / 2;
        const color = k.c >= k.o ? GREEN : RED;
        const vh = showVolume && k.v !== undefined ? (k.v / maxV) * (volH - 6) : 0;
        return (
          <g key={i}>
            {drawCandle(k, x, 16, 8, plotBottom, i)}
            {showVolume && k.v !== undefined && (
              <rect x={x - 8} y={H - vh - 2} width={16} height={vh} fill={color} opacity={0.45} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SeriesCard({
  title, note, candles, level, levelLabel, showVolume, strong, th,
}: {
  title: string; note: string; candles: Candle[]; level?: number; levelLabel?: string;
  showVolume?: boolean; strong: boolean; th: Th;
}) {
  return (
    <div className={`border ${th.border} ${th.card} rounded-lg p-3 flex flex-col gap-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-bold ${th.textMuted}`}>{title}</p>
        <span className={`border rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${strong ? 'text-emerald-500 border-emerald-500/50' : 'text-amber-500 border-amber-500/50'}`}>
          {strong ? 'Stronger' : 'Weaker'}
        </span>
      </div>
      <SeriesChart candles={candles} level={level} levelLabel={levelLabel} showVolume={showVolume} />
      <p className={`text-[10px] ${th.textFaint} leading-snug`}>{note}</p>
    </div>
  );
}

// ── Anatomy diagram ─────────────────────────────────────────────────────────
function Anatomy({ th }: { th: Th }) {
  const label = (x: number, y: number, text: string, key: string) => (
    <g key={key}>
      <line x1={x - 20} x2={x - 6} y1={y} y2={y} stroke="#64748b" strokeWidth={0.8} />
      <text x={x} y={y + 4} fontSize={11} fill="#94a3b8">{text}</text>
    </g>
  );
  return (
    <div className={`border ${th.border} ${th.card} rounded-lg p-3 flex justify-center`}>
      <svg viewBox="0 0 600 260" width="100%" style={{ maxWidth: 600 }} role="img" aria-label="Candlestick anatomy: open, close, high, low, body and wicks for a bullish and a bearish candle">
        <text x={80} y={14} fontSize={12} fill={GREEN} textAnchor="middle" fontWeight={700}>Bullish (green)</text>
        <line x1={80} x2={80} y1={30} y2={240} stroke={GREEN} strokeWidth={3} />
        <rect x={62} y={70} width={36} height={110} rx={2} fill={GREEN} />
        {label(130, 30, 'High — top of upper wick', 'bh')}
        {label(130, 70, 'Close — top of body', 'bc')}
        {label(130, 125, 'Body — conviction', 'bb')}
        {label(130, 180, 'Open — bottom of body', 'bo')}
        {label(130, 240, 'Low — bottom of lower wick', 'bl')}

        <text x={400} y={14} fontSize={12} fill={RED} textAnchor="middle" fontWeight={700}>Bearish (red)</text>
        <line x1={400} x2={400} y1={30} y2={240} stroke={RED} strokeWidth={3} />
        <rect x={382} y={70} width={36} height={110} rx={2} fill={RED} />
        {label(450, 30, 'High', 'rh')}
        {label(450, 70, 'Open — top of body', 'ro')}
        {label(450, 125, 'Body', 'rb')}
        {label(450, 180, 'Close — bottom of body', 'rc')}
        {label(450, 240, 'Low', 'rl')}
      </svg>
    </div>
  );
}

// ── Example data ────────────────────────────────────────────────────────────
const BULLISH: { title: string; note: string; k: Candle }[] = [
  { title: 'Large green body', note: 'Buyers dominated the whole period. Larger body vs. wicks = stronger signal.', k: { o: 22, c: 80, h: 84, l: 18 } },
  { title: 'Long lower wick', note: 'Price dropped, buyers pushed it back up — rejection of lower prices.', k: { o: 62, c: 70, h: 73, l: 15 } },
  { title: 'No upper wick', note: 'Closed at the high. Buyers kept control through the close.', k: { o: 40, c: 78, h: 78, l: 34 } },
  { title: 'Hammer', note: 'Small body at the top, lower wick 2x+ the body. Strong buying at lower levels.', k: { o: 72, c: 78, h: 80, l: 20 } },
];

const BEARISH: { title: string; note: string; k: Candle }[] = [
  { title: 'Large red body', note: 'Sellers dominated. The bigger the body, the more aggressive the selling.', k: { o: 80, c: 22, h: 84, l: 18 } },
  { title: 'Long upper wick', note: 'Price rose, sellers pushed it back down — rejection of higher prices.', k: { o: 45, c: 38, h: 88, l: 35 } },
  { title: 'No lower wick', note: 'Closed at the low. Sellers kept pressure through the close.', k: { o: 78, c: 36, h: 84, l: 36 } },
  { title: 'Shooting star', note: 'Small body at the bottom, upper wick 2x+ the body. Strong selling at higher levels.', k: { o: 30, c: 24, h: 85, l: 22 } },
];

const PATTERNS: { title: string; note: string; k: Candle }[] = [
  { title: 'Hammer', note: 'Small body up top, long lower wick. Buyers rejected lower prices.', k: { o: 72, c: 78, h: 80, l: 20 } },
  { title: 'Inverted hammer', note: 'Small body low, long upper wick. Buyers probing higher after a decline.', k: { o: 28, c: 34, h: 82, l: 26 } },
  { title: 'Doji', note: 'Open ≈ close, wicks both ways. Pure indecision.', k: { o: 50, c: 51, h: 80, l: 20 } },
  { title: 'Dragonfly doji', note: 'Open, high and close together; long lower wick. Bullish rejection.', k: { o: 80, c: 80.5, h: 81, l: 20 } },
  { title: 'Gravestone doji', note: 'Open, low and close together; long upper wick. Bearish rejection.', k: { o: 20, c: 20.5, h: 80, l: 19 } },
  { title: 'Marubozu bull', note: 'Open at the low, close at the high. No wicks — total buyer control.', k: { o: 20, c: 80, h: 80, l: 20 } },
  { title: 'Marubozu bear', note: 'Open at the high, close at the low. No wicks — total seller control.', k: { o: 80, c: 20, h: 80, l: 20 } },
  { title: 'Shooting star', note: 'Small body low, long upper wick. Sellers rejected higher prices.', k: { o: 30, c: 24, h: 85, l: 22 } },
  { title: 'Hanging man', note: 'Hammer shape but red, after an uptrend. Warns of weakening buyers.', k: { o: 78, c: 72, h: 80, l: 20 } },
  { title: 'Spinning top', note: 'Small body, wicks on both sides. Neither side is in control.', k: { o: 46, c: 54, h: 86, l: 14 } },
];

const DOWNTREND: Candle[] = [
  { o: 82, c: 72, h: 84, l: 70 },
  { o: 72, c: 62, h: 74, l: 60 },
  { o: 62, c: 50, h: 64, l: 48 },
  { o: 48, c: 38, h: 50, l: 36 },
];
const CHOP: Candle[] = [
  { o: 55, c: 62, h: 64, l: 52 },
  { o: 62, c: 58, h: 65, l: 56 },
  { o: 58, c: 63, h: 66, l: 55 },
  { o: 63, c: 60, h: 65, l: 57 },
];
const HAMMER_AT_SUPPORT: Candle = { o: 36, c: 42, h: 44, l: 22 };
const HAMMER_MID: Candle = { o: 60, c: 66, h: 68, l: 44 };

function volumeSeries(lastVolume: number): Candle[] {
  return [
    { o: 50, c: 48, h: 54, l: 45, v: 30 },
    { o: 48, c: 51, h: 54, l: 46, v: 35 },
    { o: 51, c: 50, h: 54, l: 47, v: 28 },
    { o: 50, c: 80, h: 83, l: 48, v: lastVolume },
  ];
}

// ── Layout helpers ──────────────────────────────────────────────────────────
function Section({ title, children, th }: { title: string; children: React.ReactNode; th: Th }) {
  return (
    <div className={`border ${th.border} ${th.card} rounded-xl p-6 space-y-3`}>
      <h2 className={`text-xs font-bold tracking-widest ${th.textMuted} uppercase border-b ${th.border} pb-2`}>{title}</h2>
      {children}
    </div>
  );
}

function Term({ term, desc, th }: { term: string; desc: string; th: Th }) {
  return (
    <div className={`flex gap-4 py-2 border-b ${th.border} last:border-0`}>
      <p className={`w-28 shrink-0 text-[10px] font-bold ${th.textMuted} uppercase tracking-wider`}>{term}</p>
      <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>{desc}</p>
    </div>
  );
}

function Bullets({ items, th }: { items: { lead: string; text: string }[]; th: Th }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.lead} className={`text-[11px] ${th.textFaint} leading-relaxed`}>
          <span className={`${th.textMuted} font-bold`}>{i.lead}</span> {i.text}
        </li>
      ))}
    </ul>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function CandlestickLessonPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => { setTheme(getSavedTheme()); }, []);
  const th = THEMES[theme];
  const cardGrid = 'grid grid-cols-2 md:grid-cols-4 gap-3';

  return (
    <div className={`min-h-screen ${th.bg} font-sans transition-colors duration-200`}>
      <AppHeader active="help" />

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <a href="/help" className="text-[11px] font-bold tracking-widest text-blue-400 hover:underline">← BACK TO HELP</a>
          <h1 className={`mt-3 text-lg font-bold ${th.text}`}>Candlestick Analysis — Reading the Battle Between Buyers and Sellers</h1>
          <p className={`text-[11px] ${th.textFaint} mt-1`}>Lesson 1 of 6 · The Cloud system tells you everything · Educational only; not a recommendation.</p>
        </div>

        <Section title="Overview" th={th}>
          <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>
            Every candlestick tells a story about the battle between buyers and sellers during a specific time period. Learning to read them is the foundation of technical analysis.
          </p>
        </Section>

        <Section title="Understanding Candlestick Anatomy" th={th}>
          <Anatomy th={th} />
          <div>
            <Term th={th} term="The Open" desc="Where the price started trading for that period. In a bullish (green) candle, the open is the bottom of the body. In a bearish (red) candle, the open is the top." />
            <Term th={th} term="The Close" desc="Where the price ended when the period closed. A close above the open creates a bullish candle. A close below the open creates a bearish candle." />
            <Term th={th} term="The High" desc="The highest price reached during the period, shown by the top of the upper wick (shadow). It represents the maximum buying pressure before sellers pushed back." />
            <Term th={th} term="The Low" desc="The lowest price reached during the period, shown by the bottom of the lower wick. It represents the maximum selling pressure before buyers stepped in." />
            <Term th={th} term="The Body" desc="The thick part of the candle between open and close. A large body shows strong conviction — buyers (green) or sellers (red) dominated. A small body means indecision." />
            <Term th={th} term="The Wicks" desc="Thin lines above and below the body showing price rejection. A long lower wick means buyers rejected lower prices (bullish). A long upper wick means sellers rejected higher prices (bearish)." />
          </div>
        </Section>

        <Section title="🟢 Bullish Signals" th={th}>
          <Bullets th={th} items={[
            { lead: 'Large green body:', text: 'Buyers dominated the entire period. The larger the body relative to the wicks, the stronger the signal.' },
            { lead: 'Long lower wick:', text: 'Price dropped significantly but buyers pushed it back up — a rejection of lower prices. This is one of the most reliable bullish signals.' },
            { lead: 'Small or no upper wick:', text: "Sellers couldn't push the price down from the close — buyers maintained control through the end." },
            { lead: 'Hammer pattern:', text: 'Small body at the top with a long lower wick (2x+ the body). Shows strong buying at lower levels.' },
          ]} />
          <div className={cardGrid}>
            {BULLISH.map((x) => <CandleCard key={x.title} title={x.title} note={x.note} k={x.k} th={th} />)}
          </div>
        </Section>

        <Section title="🔴 Bearish Signals" th={th}>
          <Bullets th={th} items={[
            { lead: 'Large red body:', text: 'Sellers dominated. The bigger the body, the more aggressive the selling pressure.' },
            { lead: 'Long upper wick:', text: 'Price rose but sellers pushed it back down — a rejection of higher prices. This warns of potential reversal.' },
            { lead: 'Small or no lower wick:', text: "Buyers couldn't push the price up from the low — sellers maintained pressure." },
            { lead: 'Shooting star pattern:', text: 'Small body at the bottom with a long upper wick (2x+ the body). Shows strong selling at higher levels.' },
          ]} />
          <div className={cardGrid}>
            {BEARISH.map((x) => <CandleCard key={x.title} title={x.title} note={x.note} k={x.k} th={th} />)}
          </div>
        </Section>

        <Section title="Pattern Presets" th={th}>
          <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>
            Ten common single-candle shapes. Percentages show how the candle splits between upper wick, body and lower wick.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PATTERNS.map((x) => <CandleCard key={x.title} title={x.title} note={x.note} k={x.k} th={th} />)}
          </div>
        </Section>

        <Section title="💡 Key Takeaways" th={th}>
          <Bullets th={th} items={[
            { lead: 'Body size = conviction.', text: 'Large bodies mean one side dominated. Tiny bodies (dojis) mean indecision.' },
            { lead: 'Wicks = rejection.', text: 'Long wicks show where the market said "no" to a price level.' },
            { lead: 'Context matters.', text: 'A hammer at a support level is more meaningful than one in the middle of a range.' },
            { lead: 'Volume confirms.', text: 'A large bullish candle on high volume is more reliable than the same candle on thin volume.' },
            { lead: 'Never trade one candle alone.', text: 'Use candlestick patterns alongside support/resistance, trend, and volume for confirmation.' },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SeriesCard th={th} strong title="Body size = conviction" note="A big body means one side dominated. A tiny body (doji) means indecision."
              candles={[{ o: 30, c: 75, h: 78, l: 28 }, { o: 52, c: 50, h: 72, l: 30 }]} />
            <SeriesCard th={th} strong title="Wicks = rejection" note="Long wicks show where the market said no to a price."
              candles={[{ o: 55, c: 50, h: 90, l: 48 }, { o: 50, c: 56, h: 58, l: 12 }]} />
            <SeriesCard th={th} strong title="Context: hammer at support" note="After a decline, the hammer rejects a known support level. Meaningful."
              candles={[...DOWNTREND, HAMMER_AT_SUPPORT]} level={24} levelLabel="Support" />
            <SeriesCard th={th} strong={false} title="Context: hammer mid-range" note="Same candle in the middle of a range with no level nearby. Much weaker."
              candles={[...CHOP, HAMMER_MID]} />
            <SeriesCard th={th} strong showVolume title="Volume: high" note="Large bullish candle on heavy volume. More reliable."
              candles={volumeSeries(100)} />
            <SeriesCard th={th} strong={false} showVolume title="Volume: thin" note="Same candle on thin volume. Easier to fade."
              candles={volumeSeries(22)} />
            <SeriesCard th={th} strong title="One candle alone: confirmed" note="Hammer followed by a strong green candle. Buyers followed through."
              candles={[...DOWNTREND, HAMMER_AT_SUPPORT, { o: 42, c: 70, h: 73, l: 40 }]} level={24} levelLabel="Support" />
            <SeriesCard th={th} strong={false} title="One candle alone: failed" note="Hammer followed by a big red candle. The signal failed and support broke."
              candles={[...DOWNTREND, HAMMER_AT_SUPPORT, { o: 40, c: 12, h: 42, l: 10 }]} level={24} levelLabel="Support" />
          </div>
        </Section>

        <div className={`border ${th.border} ${th.card} rounded-xl p-5`}>
          <p className={`text-xs font-bold ${th.textMuted} uppercase tracking-widest mb-1`}>🎯 Key Takeaway</p>
          <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>
            Body size shows conviction, wicks show rejection. Check the context — support/resistance, trend and volume — before giving any single candle weight.
          </p>
        </div>
      </div>
    </div>
  );
}
