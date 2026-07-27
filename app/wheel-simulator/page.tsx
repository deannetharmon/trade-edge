// app/wheel-simulator/page.tsx
"use client";
import { useState, useEffect } from "react";
import { getAccessToken, getQuote, getChain } from "@/lib/scans/tastytrade-client";
import { daysUntil } from "@/lib/scans/scan-utils";

const MAG7 = ["NVDA", "MSFT", "META", "GOOGL", "AAPL", "AMZN", "TSLA"];
const LS_KEY = "wheel-sim-scenarios";

type TickerData = {
  ticker: string;
  group: "mag7" | "other";
  price: number;
  blendedRocPerCycle: number; // fraction, e.g. 0.02 = 2% per cycle
  capPerContract: number; // dollars required per contract
  fetching?: boolean;
  error?: string;
};

type Scenario = {
  id: string;
  name: string;
  startingCapital: number;
  dte: number;
  horizonMonths: number;
  perTickerCapPct: number; // 0-1
  groupCapPct: number; // 0-1, applies to mag7 bucket
  tickers: TickerData[];
  savedAt: string;
  result?: SimResult;
};

type SimResult = {
  finalCapital: number;
  totalReturn: number;
  cycles: number;
  timeline: { cycle: number; capital: number; idle: number; addedTicker?: string }[];
  allocation: Record<string, number>;
  maxIdleStreak: number;
};

function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveScenarios(list: Scenario[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {}
}

// Greedy allocator with per-ticker + correlated-group caps
function runSimulation(
  tickers: TickerData[],
  startingCapital: number,
  dte: number,
  horizonMonths: number,
  perTickerCapPct: number,
  groupCapPct: number
): SimResult {
  const numCycles = Math.max(1, Math.floor((horizonMonths * 30) / dte));
  const allocated: Record<string, number> = {};
  tickers.forEach((t) => (allocated[t.ticker] = 0));
  let idle = startingCapital;
  const timeline: SimResult["timeline"] = [];
  let currentIdleStreak = 0;
  let maxIdleStreak = 0;

  const totalCapital = () => idle + Object.values(allocated).reduce((a, b) => a + b, 0);
  const groupTotal = (group: string) =>
    tickers.filter((t) => t.group === group).reduce((sum, t) => sum + allocated[t.ticker], 0);

  for (let cycle = 1; cycle <= numCycles; cycle++) {
    // 1. Collect premium from existing allocated capital (compounds in place)
    let premiumThisCycle = 0;
    for (const t of tickers) {
      const contracts = Math.floor(allocated[t.ticker] / t.capPerContract);
      premiumThisCycle += contracts * t.capPerContract * t.blendedRocPerCycle;
    }
    idle += premiumThisCycle;

    // 2. Try to deploy idle cash into the best eligible ticker(s), respecting caps
    let addedTicker: string | undefined;
    let deployedSomething = true;
    let deployedThisCycle = false;
    while (deployedSomething) {
      deployedSomething = false;
      const tc = totalCapital();
      const eligible = tickers
        .filter((t) => {
          if (idle < t.capPerContract) return false;
          const currentAlloc = allocated[t.ticker];
          // Always allow the first contract in a ticker — caps only block additional contracts
          if (currentAlloc > 0) {
            const newTickerAlloc = currentAlloc + t.capPerContract;
            if (newTickerAlloc > tc * perTickerCapPct) return false;
          }
          if (t.group === "mag7") {
            const currentGroupAlloc = groupTotal("mag7");
            if (currentGroupAlloc > 0) {
              const newGroupAlloc = currentGroupAlloc + t.capPerContract;
              if (newGroupAlloc > tc * groupCapPct) return false;
            }
          }
          return true;
        })
        .sort((a, b) => b.blendedRocPerCycle - a.blendedRocPerCycle);

      if (eligible.length > 0) {
        const pick = eligible[0];
        if (allocated[pick.ticker] === 0) addedTicker = pick.ticker;
        allocated[pick.ticker] += pick.capPerContract;
        idle -= pick.capPerContract;
        deployedSomething = true;
        deployedThisCycle = true;
      }
    }

    currentIdleStreak = deployedThisCycle ? 0 : currentIdleStreak + 1;
    maxIdleStreak = Math.max(maxIdleStreak, currentIdleStreak);

    timeline.push({ cycle, capital: totalCapital(), idle, addedTicker });
  }

  const finalCapital = totalCapital();
  return {
    finalCapital,
    totalReturn: (finalCapital / startingCapital - 1) * 100,
    cycles: numCycles,
    timeline,
    allocation: allocated,
    maxIdleStreak,
  };
}

export default function WheelSimulator() {
  const [universe, setUniverse] = useState<string[]>(MAG7);
  const [extraTickers, setExtraTickers] = useState("");
  const [tickers, setTickers] = useState<TickerData[]>(
    MAG7.map((t) => ({ ticker: t, group: "mag7", price: 0, blendedRocPerCycle: 0, capPerContract: 0 }))
  );
  const [startingCapital, setStartingCapital] = useState(49000);
  const [dte, setDte] = useState(7);
  const [horizonMonths, setHorizonMonths] = useState(24);
  const [perTickerCapPct, setPerTickerCapPct] = useState(25);
  const [groupCapPct, setGroupCapPct] = useState(75);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);

  useEffect(() => setScenarios(loadScenarios()), []);

  const addExtraTickers = () => {
    const added = extraTickers
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s && !tickers.some((t) => t.ticker === s));
    if (!added.length) return;
    setTickers([
      ...tickers,
      ...added.map((t) => ({ ticker: t, group: "other" as const, price: 0, blendedRocPerCycle: 0, capPerContract: 0 })),
    ]);
    setExtraTickers("");
  };

  const removeTicker = (ticker: string) => setTickers(tickers.filter((t) => t.ticker !== ticker));

  const fetchOne = async (idx: number) => {
    setTickers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], fetching: true, error: "" };
      return next;
    });

    try {
      const t = tickers[idx];
      const token = await getAccessToken();
      const [price, chainData] = await Promise.all([
        getQuote(t.ticker, token),
        getChain(t.ticker, token, {} as any, { min: Math.max(dte - 3, 0), max: dte + 3 }),
      ]);
      if (!chainData.expirations.length) throw new Error("No expirations found");

      let bestExp = chainData.expirations[0];
      let bestDteDiff = Infinity;
      for (const exp of chainData.expirations) {
        const diff = Math.abs(daysUntil(exp) - dte);
        if (diff < bestDteDiff) { bestDteDiff = diff; bestExp = exp; }
      }
      const contracts = chainData.chains[bestExp] || [];
      const pickClosest = (optionType: "C" | "P") => {
        const cands = contracts.filter((c: any) => c.optionType === optionType && c.delta != null);
        if (!cands.length) return null;
        let best = cands[0], bestDiff = Infinity;
        for (const c of cands) {
          const diff = Math.abs(Math.abs(c.delta) - 0.3);
          if (diff < bestDiff) { bestDiff = diff; best = c; }
        }
        return best;
      };
      const call = pickClosest("C");
      const put = pickClosest("P");
      if (!call && !put) throw new Error("No qualifying options");

      const p = price ?? 0;
      const ccCredit = call?.bid ?? 0;
      const cspStrike = put?.strikePrice ?? p;
      const cspCredit = put?.bid ?? 0;

      const ccCap = p * 100;
      const cspCap = cspStrike * 100;
      const ccRoc = ccCap > 0 ? (ccCredit * 100) / ccCap : 0;
      const cspRoc = cspCap > 0 ? (cspCredit * 100) / cspCap : 0;
      const blended = (ccRoc + cspRoc) / 2;

      setTickers((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          price: p,
          capPerContract: p * 100,
          blendedRocPerCycle: blended,
          fetching: false,
          error: "",
        };
        return next;
      });
    } catch (err: any) {
      setTickers((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], fetching: false, error: err.message || "Fetch failed" };
        return next;
      });
    }
  };

  const fetchAll = async () => {
    setFetchingAll(true);
    for (let i = 0; i < tickers.length; i++) await fetchOne(i);
    setFetchingAll(false);
  };

  const runSim = () => {
    const ready = tickers.filter((t) => t.capPerContract > 0);
    if (!ready.length) return;
    const r = runSimulation(ready, startingCapital, dte, horizonMonths, perTickerCapPct / 100, groupCapPct / 100);
    setResult(r);
  };

  const saveScenario = () => {
    if (!result || !scenarioName.trim()) return;
    const s: Scenario = {
      id: Date.now().toString(),
      name: scenarioName.trim(),
      startingCapital, dte, horizonMonths, perTickerCapPct, groupCapPct,
      tickers, savedAt: new Date().toISOString(), result,
    };
    const updated = [...scenarios, s];
    setScenarios(updated);
    saveScenarios(updated);
    setScenarioName("");
  };

  const deleteScenario = (id: string) => {
    const updated = scenarios.filter((s) => s.id !== id);
    setScenarios(updated);
    saveScenarios(updated);
  };

  const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20, background: "#0f1115", color: "#e6e8eb", minHeight: "100vh" }}>
      <h2 style={{ marginBottom: 4 }}>Wheel capital growth simulator</h2>
      <p style={{ color: "#9aa0a6", marginTop: 0, fontSize: 13 }}>
        Assumes 100% premium reinvestment, blended CC/CSP credit held constant from live fetch, greedy allocation by ROC subject to a per-ticker cap and a correlated Mag 7 group cap.
      </p>

      {/* Config row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 13 }}>
        <label>Starting capital <input type="number" value={startingCapital} onChange={(e) => setStartingCapital(parseFloat(e.target.value) || 0)} style={inputStyle(90)} /></label>
        <label>DTE <input type="number" value={dte} onChange={(e) => setDte(parseInt(e.target.value) || 7)} style={inputStyle(50)} /></label>
        <label>Horizon (months) <input type="number" value={horizonMonths} onChange={(e) => setHorizonMonths(parseInt(e.target.value) || 1)} style={inputStyle(50)} /></label>
        <label>Per-ticker cap % <input type="number" value={perTickerCapPct} onChange={(e) => setPerTickerCapPct(parseFloat(e.target.value) || 0)} style={inputStyle(50)} /></label>
        <label>Mag 7 group cap % <input type="number" value={groupCapPct} onChange={(e) => setGroupCapPct(parseFloat(e.target.value) || 0)} style={inputStyle(50)} /></label>
      </div>

      {/* Extra tickers */}
      <div style={{ marginBottom: 12, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
        <input placeholder="Add comparison tickers (comma-separated)" value={extraTickers} onChange={(e) => setExtraTickers(e.target.value)} style={inputStyle(280)} />
        <button onClick={addExtraTickers} style={btnStyle}>+ Add</button>
        <button onClick={fetchAll} disabled={fetchingAll} style={{ ...btnStyle, background: "#2563eb", color: "#fff", border: "none" }}>
          {fetchingAll ? "Fetching…" : "Fetch all live data"}
        </button>
      </div>

      {/* Ticker table */}
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr style={{ background: "#1b1e24", textAlign: "left" }}>
            {["Ticker", "Group", "Price", "Cap/Contract", "Blended ROC/cycle", "", ""].map((h) => (
              <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #2a2e37" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((t, i) => (
            <tr key={t.ticker} style={{ borderBottom: "1px solid #22252c" }}>
              <td style={{ padding: "6px 10px" }}>{t.ticker}</td>
              <td style={{ padding: "6px 10px", color: t.group === "mag7" ? "#7ee2a8" : "#9aa0a6" }}>{t.group}</td>
              <td style={{ padding: "6px 10px" }}>{t.price ? fmtUsd(t.price) : "—"}</td>
              <td style={{ padding: "6px 10px" }}>{t.capPerContract ? fmtUsd(t.capPerContract) : "—"}</td>
              <td style={{ padding: "6px 10px" }}>{t.blendedRocPerCycle ? fmtPct(t.blendedRocPerCycle * 100) : "—"}</td>
              <td style={{ padding: "6px 10px" }}>
                <button onClick={() => fetchOne(i)} disabled={t.fetching} style={btnStyle}>{t.fetching ? "…" : "Fetch"}</button>
                {t.error && <div style={{ color: "#e05252", fontSize: 10 }}>{t.error}</div>}
              </td>
              <td style={{ padding: "6px 10px" }}>
                <button onClick={() => removeTicker(t.ticker)} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer" }}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={runSim} style={{ ...btnStyle, background: "#16a34a", color: "#fff", border: "none", marginBottom: 20 }}>
        Run simulation
      </button>

      {/* Results */}
      {result && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 24, marginBottom: 12, fontSize: 14 }}>
            <div>Final capital: <b style={{ color: "#7ee2a8" }}>{fmtUsd(result.finalCapital)}</b></div>
            <div>Total return: <b style={{ color: "#7ee2a8" }}>{fmtPct(result.totalReturn)}</b></div>
            <div>Cycles run: <b>{result.cycles}</b></div>
          </div>

          {result.maxIdleStreak >= 8 && (
            <div style={{ background: "#3a2a14", border: "1px solid #6b4a1e", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#f2a623" }}>
              Idle cash sat unused for {result.maxIdleStreak} consecutive cycles at some point — your caps may be too tight relative to contract sizes to deploy capital efficiently. Consider raising the per-ticker or group cap, or adding lower-cost tickers.
            </div>
          )}

          <MiniChart timeline={result.timeline} dte={dte} />

          <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 8 }}>
            Ticker additions: {result.timeline.filter((t) => t.addedTicker).map((t) => `${t.addedTicker} (cycle ${t.cycle})`).join(", ") || "none — starting tickers only"}
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: "#9aa0a6" }}>
            <div style={{ marginBottom: 4, color: "#e6e8eb" }}>Final allocation</div>
            {Object.entries(result.allocation)
              .filter(([, amt]) => amt > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([ticker, amt]) => (
                <span key={ticker} style={{ marginRight: 16 }}>
                  {ticker}: {fmtUsd(amt)}
                </span>
              ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <input placeholder="Scenario name" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} style={inputStyle(180)} />
            <button onClick={saveScenario} style={btnStyle}>Save scenario</button>
          </div>
        </div>
      )}

      {/* Saved scenarios comparison */}
      {scenarios.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Saved scenarios</h3>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#1b1e24", textAlign: "left" }}>
                {["Name", "Start capital", "Horizon", "Tickers", "Final capital", "Total return", ""].map((h) => (
                  <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #2a2e37" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #22252c" }}>
                  <td style={{ padding: "6px 10px" }}>{s.name}</td>
                  <td style={{ padding: "6px 10px" }}>{fmtUsd(s.startingCapital)}</td>
                  <td style={{ padding: "6px 10px" }}>{s.horizonMonths}mo</td>
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "#9aa0a6" }}>{s.tickers.map((t) => t.ticker).join(", ")}</td>
                  <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{s.result ? fmtUsd(s.result.finalCapital) : "—"}</td>
                  <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{s.result ? fmtPct(s.result.totalReturn) : "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <button onClick={() => deleteScenario(s.id)} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer" }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniChart({ timeline, dte }: { timeline: SimResult["timeline"]; dte: number }) {
  if (!timeline.length) return null;
  const w = 640, h = 200, padL = 60, padR = 20, padT = 20, padB = 30;
  const max = Math.max(...timeline.map((t) => t.capital));
  const min = Math.min(...timeline.map((t) => t.capital));
  const range = max - min || 1;

  const startDate = new Date();
  const dateAt = (cycleIdx: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + cycleIdx * dte);
    return d;
  };
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const x = (i: number) => padL + (i / (timeline.length - 1 || 1)) * (w - padL - padR);
  const y = (cap: number) => h - padB - ((cap - min) / range) * (h - padT - padB);

  const pts = timeline.map((t, i) => `${x(i)},${y(t.capital)}`);
  const yTicks = [min, (min + max) / 2, max];
  const xTickIdxs = [0, Math.floor((timeline.length - 1) / 2), timeline.length - 1];

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#14161b", borderRadius: 6 }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={w - padR} y2={y(v)} stroke="#2a2e37" strokeWidth={1} />
          <text x={padL - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#9aa0a6">
            {fmtUsd(v)}
          </text>
        </g>
      ))}

      <polyline points={pts.join(" ")} fill="none" stroke="#7ee2a8" strokeWidth={2} />

      {timeline.map((t, i) =>
        t.addedTicker ? (
          <g key={i}>
            <circle cx={x(i)} cy={y(t.capital)} r={3.5} fill="#f2a623" />
            <title>{`${t.addedTicker} added — cycle ${t.cycle} (${fmtDate(dateAt(i))}), capital ${fmtUsd(t.capital)}`}</title>
          </g>
        ) : null
      )}

      {xTickIdxs.map((i) => (
        <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="#9aa0a6">
          {fmtDate(dateAt(i))}
        </text>
      ))}
    </svg>
  );
}

function inputStyle(width: number) {
  return { width, background: "#14161b", color: "#e6e8eb", border: "1px solid #2a2e37", borderRadius: 4, padding: "4px 6px", fontSize: 13 };
}
const btnStyle: React.CSSProperties = { padding: "5px 10px", background: "#2a2e37", color: "#e6e8eb", border: "1px solid #3a3f4a", borderRadius: 4, cursor: "pointer", fontSize: 12 };
