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
  timeline: { cycle: number; capital: number; addedTicker?: string }[];
  allocation: Record<string, number>;
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
    while (deployedSomething) {
      deployedSomething = false;
      const tc = totalCapital();
      const eligible = tickers
        .filter((t) => {
          if (idle < t.capPerContract) return false;
          const newTickerAlloc = allocated[t.ticker] + t.capPerContract;
          if (newTickerAlloc > tc * perTickerCapPct) return false;
          if (t.group === "mag7") {
            const newGroupAlloc = groupTotal("mag7") + t.capPerContract;
            if (newGroupAlloc > tc * groupCapPct) return false;
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
      }
    }

    timeline.push({ cycle, capital: totalCapital(), addedTicker });
  }

  const finalCapital = totalCapital();
  return {
    finalCapital,
    totalReturn: (finalCapital / startingCapital - 1) * 100,
    cycles: numCycles,
    timeline,
    allocation: allocated,
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
    const t = tickers[idx];
    const next = [...tickers];
    next[idx] = { ...t, fetching: true, error: "" };
    setTickers(next);

    try {
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

      const updated = [...tickers];
      updated[idx] = {
        ...t,
        price: p,
        capPerContract: p * 100,
        blendedRocPerCycle: blended,
        fetching: false,
        error: "",
      };
      setTickers(updated);
    } catch (err: any) {
      const updated = [...tickers];
      updated[idx] = { ...t, fetching: false, error: err.message || "Fetch failed" };
      setTickers(updated);
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

          <MiniChart timeline={result.timeline} />

          <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 8 }}>
            Ticker additions: {result.timeline.filter((t) => t.addedTicker).map((t) => `${t.addedTicker} (cycle ${t.cycle})`).join(", ") || "none — starting tickers only"}
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

function MiniChart({ timeline }: { timeline: SimResult["timeline"] }) {
  if (!timeline.length) return null;
  const w = 640, h = 160, pad = 20;
  const max = Math.max(...timeline.map((t) => t.capital));
  const min = Math.min(...timeline.map((t) => t.capital));
  const range = max - min || 1;
  const pts = timeline.map((t, i) => {
    const x = pad + (i / (timeline.length - 1 || 1)) * (w - pad * 2);
    const y = h - pad - ((t.capital - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#14161b", borderRadius: 6 }}>
      <polyline points={pts.join(" ")} fill="none" stroke="#7ee2a8" strokeWidth={2} />
      {timeline.map((t, i) =>
        t.addedTicker ? (
          <circle key={i} cx={pad + (i / (timeline.length - 1 || 1)) * (w - pad * 2)}
            cy={h - pad - ((t.capital - min) / range) * (h - pad * 2)} r={3} fill="#f2a623" />
        ) : null
      )}
    </svg>
  );
}

function inputStyle(width: number) {
  return { width, background: "#14161b", color: "#e6e8eb", border: "1px solid #2a2e37", borderRadius: 4, padding: "4px 6px", fontSize: 13 };
}
const btnStyle: React.CSSProperties = { padding: "5px 10px", background: "#2a2e37", color: "#e6e8eb", border: "1px solid #3a3f4a", borderRadius: 4, cursor: "pointer", fontSize: 12 };
