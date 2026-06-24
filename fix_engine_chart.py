#!/usr/bin/env python3
import sys

FILE_PATH = "app/engine/page.tsx"

with open(FILE_PATH, "r") as f:
    content = f.read()

original_content = content
applied = []
skipped = []

old_1 = """export default function EnginePage() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  const th = THEMES[theme];
  useEffect(() => { applyAccent(accent); injectAccentStyle(); }, [accent]);
  useEffect(() => { applyAccent(getSavedAccent()); }, []);"""

new_1 = """export default function EnginePage() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  const th = THEMES[theme];
  useEffect(() => { applyAccent(accent); injectAccentStyle(); }, [accent]);
  useEffect(() => { applyAccent(getSavedAccent()); }, []);

  const [openChartSymbol, setOpenChartSymbol] = useState<string | null>(null);
  const [chartPopupPos, setChartPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [chartSparkData, setChartSparkData] = useState(null as number[] | null);
  const [chartSparkLoading, setChartSparkLoading] = useState(false);

  const closeChart = () => setOpenChartSymbol(null);

  const openChart = (symbol: string, rect: DOMRect) => {
    setChartPopupPos({
      top: Math.min(rect.bottom + 6, window.innerHeight - 320),
      left: Math.min(rect.left, window.innerWidth - 290),
    });
    setOpenChartSymbol(symbol);
    setChartSparkData(null);
    setChartSparkLoading(true);
    const YAHOO_INDEX_MAP: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };
    const chartSym = YAHOO_INDEX_MAP[symbol.toUpperCase()] ?? symbol;
    fetch(`/api/chart?symbol=${encodeURIComponent(chartSym)}`)
      .then(r => r.json())
      .then(d => {
        const closes = (d?.bars ?? []).map((b: any) => b?.c).filter((v: any) => v != null).slice(-90);
        setChartSparkData(closes);
      })
      .catch(() => setChartSparkData([]))
      .finally(() => setChartSparkLoading(false));
  };"""

old_2 = """function ChartButton({ symbol, th }: { symbol: string; th: typeof THEMES[Theme] }) {
  const [showChart, setShowChart] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [sparkData, setSparkData] = useState(null as number[] | null);
  const [sparkLoading, setSparkLoading] = useState(false);

  const TV_SYMBOL = ({ SPX: 'CBOE:SPX', SPXW: 'CBOE:SPX', NDX: 'NASDAQ:NDX', RUT: 'TVC:RUT', VIX: 'CBOE:VIX', DJX: 'TVC:DJI' })[symbol.toUpperCase()] ?? symbol;

  return (
    <div className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          if (!showChart) {
            if (buttonRef.current) {
              const r = buttonRef.current.getBoundingClientRect();
              setPopupPos({
                top: Math.min(r.bottom + 6, window.innerHeight - 320),
                left: Math.min(r.left, window.innerWidth - 290),
              });
            }
            setShowChart(true);
            if (!sparkData) {
              setSparkLoading(true);
              const YAHOO_INDEX_MAP: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };
              const chartSym = YAHOO_INDEX_MAP[symbol.toUpperCase()] ?? symbol;
              fetch(`/api/chart?symbol=${encodeURIComponent(chartSym)}`)
                .then(r => r.json())
                .then(d => {
                  const closes = (d?.bars ?? []).map((b: any) => b?.c).filter((v: any) => v != null).slice(-90);
                  setSparkData(closes);
                })
                .catch(() => setSparkData([]))
                .finally(() => setSparkLoading(false));
            }
          } else { setShowChart(false); }
        }}
        ref={buttonRef}
        className={`inline-flex items-center gap-0.5 text-[9px] transition-colors ${showChart ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'}`}
        title="Quick chart"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span className="tracking-wide">chart</span>
      </button>

      {showChart && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowChart(false)} />
          <div
            className={`fixed z-[9999] ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-3`}
            style={{ width: '280px', top: popupPos?.top ?? 0, left: popupPos?.left ?? 0 }}
            onClick={e => e.stopPropagation()}
          >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] font-bold ${th.textFaint} tracking-widest`}>{symbol}</span>
            <button onClick={() => setShowChart(false)} className="text-slate-500 hover:text-white transition-colors text-sm leading-none">✕</button>
          </div>
            {sparkLoading && (
              <div className="flex items-center justify-center h-16">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
              const min = Math.min(...sparkData);
              const max = Math.max(...sparkData);
              const range = max - min || 1;
              const w = 256, h = 56;
              const pts = sparkData.map((v, i) => {
                const x = (i / (sparkData.length - 1)) * w;
                const y = h - ((v - min) / range) * h;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              const isUp = sparkData[sparkData.length - 1] >= sparkData[0];
              const color = isUp ? '#10b981' : '#ef4444';
              const lastPrice = sparkData[sparkData.length - 1];
              const changePct = ((lastPrice - sparkData[0]) / sparkData[0] * 100).toFixed(1);
              return (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{symbol}</span>
                    <span className="text-[10px] font-bold" style={{ color }}>
                      ${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span>
                    </span>
                  </div>
                  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '56px' }}>
                    <defs>
                      <linearGradient id={`grad-engine-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                    <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-engine-${symbol})`} />
                  </svg>
                </div>
              );
            })()}
            {!sparkLoading && sparkData && sparkData.length === 0 && (
              <p className={`text-[9px] ${th.textFaint} text-center py-3`}>Chart data unavailable</p>
            )}
            <a href={`https://www.tradingview.com/chart/?symbol=${TV_SYMBOL}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[10px] text-blue-400 font-bold tracking-wider transition-colors border border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/10"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open in TradingView
            </a>
        </div>
        </>
      )}
    </div>
  );
}"""

new_2 = """function ChartButton({ symbol, th, isOpen, onOpen, onClose }: {
  symbol: string;
  th: typeof THEMES[Theme];
  isOpen: boolean;
  onOpen: (symbol: string, rect: DOMRect) => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          if (!isOpen) {
            if (buttonRef.current) onOpen(symbol, buttonRef.current.getBoundingClientRect());
          } else {
            onClose();
          }
        }}
        ref={buttonRef}
        className={`inline-flex items-center gap-0.5 text-[9px] transition-colors ${isOpen ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'}`}
        title="Quick chart"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span className="tracking-wide">chart</span>
      </button>
    </div>
  );
}

function ChartPopup({ symbol, pos, sparkData, sparkLoading, th, onClose }: {
  symbol: string;
  pos: { top: number; left: number };
  sparkData: number[] | null;
  sparkLoading: boolean;
  th: typeof THEMES[Theme];
  onClose: () => void;
}) {
  const TV_SYMBOL = ({ SPX: 'CBOE:SPX', SPXW: 'CBOE:SPX', NDX: 'NASDAQ:NDX', RUT: 'TVC:RUT', VIX: 'CBOE:VIX', DJX: 'TVC:DJI' })[symbol.toUpperCase()] ?? symbol;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className={`fixed z-[9999] ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-3`}
        style={{ width: '280px', top: pos.top, left: pos.left }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-bold ${th.textFaint} tracking-widest`}>{symbol}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-sm leading-none">✕</button>
        </div>
        {sparkLoading && (
          <div className="flex items-center justify-center h-16">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
          const min = Math.min(...sparkData);
          const max = Math.max(...sparkData);
          const range = max - min || 1;
          const w = 256, h = 56;
          const pts = sparkData.map((v, i) => {
            const x = (i / (sparkData.length - 1)) * w;
            const y = h - ((v - min) / range) * h;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');
          const isUp = sparkData[sparkData.length - 1] >= sparkData[0];
          const color = isUp ? '#10b981' : '#ef4444';
          const lastPrice = sparkData[sparkData.length - 1];
          const changePct = ((lastPrice - sparkData[0]) / sparkData[0] * 100).toFixed(1);
          return (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{symbol}</span>
                <span className="text-[10px] font-bold" style={{ color }}>
                  ${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span>
                </span>
              </div>
              <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '56px' }}>
                <defs>
                  <linearGradient id={`grad-engine-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-engine-${symbol})`} />
              </svg>
            </div>
          );
        })()}
        {!sparkLoading && sparkData && sparkData.length === 0 && (
          <p className={`text-[9px] ${th.textFaint} text-center py-3`}>Chart data unavailable</p>
        )}
        <a href={`https://www.tradingview.com/chart/?symbol=${TV_SYMBOL}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[10px] text-blue-400 font-bold tracking-wider transition-colors border border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/10"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open in TradingView
        </a>
      </div>
    </>
  );
}"""

old_3 = '<ChartButton symbol={pos.symbol} th={th} />'
new_3 = '<ChartButton symbol={pos.symbol} th={th} isOpen={openChartSymbol === pos.symbol} onOpen={openChart} onClose={closeChart} />'

old_4 = '<ChartButton symbol="SPX" th={th} />'
new_4 = '<ChartButton symbol="SPX" th={th} isOpen={openChartSymbol === \'SPX\'} onOpen={openChart} onClose={closeChart} />'

old_5 = '<ChartButton symbol="SPY" th={th} />'
new_5 = '<ChartButton symbol="SPY" th={th} isOpen={openChartSymbol === \'SPY\'} onOpen={openChart} onClose={closeChart} />'

old_6 = '<ChartButton symbol={sug.symbol} th={th} />'
new_6 = '<ChartButton symbol={sug.symbol} th={th} isOpen={openChartSymbol === sug.symbol} onOpen={openChart} onClose={closeChart} />'

old_7 = """        {/* ── ADVISOR TAB ── */}
        {status === 'ready' && d && subTab === 'advisor' && (
          <EngineAdvisor data={d} watchlist={watchlist} th={th} />
        )}
      </div>
    </div>
  );
}"""

new_7 = """        {/* ── ADVISOR TAB ── */}
        {status === 'ready' && d && subTab === 'advisor' && (
          <EngineAdvisor data={d} watchlist={watchlist} th={th} />
        )}
      </div>

      {openChartSymbol && chartPopupPos && (
        <ChartPopup
          symbol={openChartSymbol}
          pos={chartPopupPos}
          sparkData={chartSparkData}
          sparkLoading={chartSparkLoading}
          th={th}
          onClose={closeChart}
        />
      )}
    </div>
  );
}"""

fixes = [
    ("Add lifted chart state + handlers", old_1, new_1),
    ("Replace ChartButton, add ChartPopup", old_2, new_2),
    ("Call site: pos.symbol", old_3, new_3),
    ("Call site: SPX", old_4, new_4),
    ("Call site: SPY", old_5, new_5),
    ("Call site: sug.symbol", old_6, new_6),
    ("Add shared ChartPopup render", old_7, new_7),
]

for name, old, new in fixes:
    count = content.count(old)
    if count == 0:
        skipped.append((name, "exact text not found"))
    elif count > 1:
        skipped.append((name, f"found {count} matches, expected 1"))
    else:
        content = content.replace(old, new, 1)
        applied.append(name)

print(f"\nApplied {len(applied)}/{len(fixes)} fixes:")
for name in applied:
    print(f"  [OK] {name}")

if skipped:
    print(f"\nSkipped {len(skipped)}:")
    for name, reason in skipped:
        print(f"  [SKIP] {name} -- {reason}")

if content == original_content:
    print("\nNo changes made.")
    sys.exit(1)

with open(FILE_PATH, "w") as f:
    f.write(content)

print(f"\nWrote changes to {FILE_PATH}")
