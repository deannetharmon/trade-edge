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
  iv: number; // implied volatility as a fraction, e.g. 0.35 = 35%
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

type RealisticResult = {
  medianFinal: number;
  p10Final: number;
  p90Final: number;
  medianReturn: number;
  medianTimeline: number[]; // capital at each cycle, median across paths
  p10Timeline: number[];
  p90Timeline: number[];
  avgAssignments: Record<string, number>; // avg # of CSP->CC switches per ticker
  avgCallAways: Record<string, number>; // avg # of CC->CSP switches per ticker
  cycles: number;
  numPaths: number;
};

// ── Option pricing / GBM helpers ─────────────────────────────────────────
// Approximate normal CDF (Abramowitz & Stegun 7.1.26)
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}
// Approximate inverse normal CDF (Acklam's algorithm)
function invNormCdf(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}
// Black-Scholes price, r assumed 0 for simplicity
function bsPrice(type: "C" | "P", S: number, K: number, T: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return Math.max(type === "C" ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return type === "C" ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}
// Approximate strike for a target delta (OTM options), inverting the d1 formula
function strikeForDelta(type: "C" | "P", S: number, sigma: number, T: number, targetDelta: number): number {
  const z = type === "C" ? invNormCdf(targetDelta) : invNormCdf(1 - targetDelta);
  const sqrtT = Math.sqrt(T);
  const lnRatio = (z - 0.5 * sigma * sqrtT) * sigma * sqrtT;
  return S / Math.exp(lnRatio);
}
// One GBM step over `days` days, annualized vol sigma, drift mu (annualized)
function gbmStep(S: number, sigma: number, days: number, mu: number, rand: () => number): number {
  const T = days / 365;
  // Box-Muller for a standard normal draw
  const u1 = Math.max(rand(), 1e-9), u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return S * Math.exp((mu - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * z);
}

type WheelState = { state: "csp" | "cc"; strike: number; spot: number; costBasis: number };

function runRealisticSimulation(
  tickers: TickerData[],
  startingCapital: number,
  dte: number,
  horizonMonths: number,
  perTickerCapPct: number,
  groupCapPct: number,
  targetDelta: number,
  annualDrift: number,
  numPaths: number
): RealisticResult {
  const numCycles = Math.max(1, Math.floor((horizonMonths * 30) / dte));
  const T = dte / 365;
  const finals: number[] = [];
  const pathTimelines: number[][] = [];
  const assignCounts: Record<string, number[]> = {};
  const callAwayCounts: Record<string, number[]> = {};
  tickers.forEach((t) => { assignCounts[t.ticker] = []; callAwayCounts[t.ticker] = []; });

  for (let path = 0; path < numPaths; path++) {
    const wheel: Record<string, WheelState> = {};
    const contracts: Record<string, number> = {}; // # contracts open per ticker
    tickers.forEach((t) => {
      wheel[t.ticker] = { state: "csp", strike: 0, spot: t.price, costBasis: 0 };
      contracts[t.ticker] = 0;
    });
    let idle = startingCapital;
    let assignedCount: Record<string, number> = {};
    let calledAwayCount: Record<string, number> = {};
    tickers.forEach((t) => { assignedCount[t.ticker] = 0; calledAwayCount[t.ticker] = 0; });

    const tickerValue = (t: TickerData) => {
      const w = wheel[t.ticker];
      const n = contracts[t.ticker];
      if (n === 0) return 0;
      return w.state === "csp" ? n * w.strike * 100 : n * w.spot * 100;
    };
    const totalCapital = () => idle + tickers.reduce((sum, t) => sum + tickerValue(t), 0);
    const groupTotal = (group: string) =>
      tickers.filter((t) => t.group === group).reduce((sum, t) => sum + tickerValue(t), 0);

    const pathTimeline: number[] = [];

    for (let cycle = 0; cycle < numCycles; cycle++) {
      // 1. For every open position, collect premium for a new leg at current spot, then advance price and resolve assignment/call-away
      for (const t of tickers) {
        const w = wheel[t.ticker];
        const n = contracts[t.ticker];
        if (n === 0) continue;
        const type: "C" | "P" = w.state === "csp" ? "P" : "C";
        const strike = strikeForDelta(type, w.spot, t.iv, T, targetDelta);
        const credit = bsPrice(type, w.spot, strike, T, t.iv);
        idle += credit * 100 * n; // premium always goes to cash
        const newSpot = gbmStep(w.spot, t.iv, dte, annualDrift, Math.random);

        if (w.state === "csp") {
          if (newSpot < strike) {
            // assigned — take shares at strike
            w.state = "cc";
            w.costBasis = strike;
            assignedCount[t.ticker]++;
          }
        } else {
          if (newSpot > strike) {
            // called away — sell shares at strike, back to cash
            w.state = "csp";
            calledAwayCount[t.ticker]++;
          }
        }
        w.strike = strike;
        w.spot = newSpot;
      }

      // 2. Deploy idle cash into the best eligible ticker (greedy by rough current-cycle ROC), respecting caps
      let deployedSomething = true;
      while (deployedSomething) {
        deployedSomething = false;
        const tc = totalCapital();
        const eligible = tickers
          .filter((t) => {
            const w = wheel[t.ticker];
            const capPerContract = w.state === "csp" ? w.spot * 100 : w.spot * 100; // approx entry cost either way
            if (idle < capPerContract) return false;
            const currentVal = tickerValue(t);
            if (currentVal > 0 && currentVal + capPerContract > tc * perTickerCapPct) return false;
            if (t.group === "mag7") {
              const currentGroupVal = groupTotal("mag7");
              if (currentGroupVal > 0 && currentGroupVal + capPerContract > tc * groupCapPct) return false;
            }
            return true;
          })
          .map((t) => ({ t, roc: t.blendedRocPerCycle })) // use live-fetched ROC as ranking proxy
          .sort((a, b) => b.roc - a.roc);

        if (eligible.length > 0) {
          const { t } = eligible[0];
          const w = wheel[t.ticker];
          const capPerContract = w.spot * 100;
          if (idle >= capPerContract) {
            contracts[t.ticker] += 1;
            idle -= capPerContract;
            if (contracts[t.ticker] === 1) w.strike = strikeForDelta("P", w.spot, t.iv, T, targetDelta);
            deployedSomething = true;
          }
        }
      }

      pathTimeline.push(totalCapital());
    }

    finals.push(totalCapital());
    pathTimelines.push(pathTimeline);
    tickers.forEach((t) => {
      assignCounts[t.ticker].push(assignedCount[t.ticker]);
      callAwayCounts[t.ticker].push(calledAwayCount[t.ticker]);
    });
  }

  finals.sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
  const medianFinal = pct(finals, 0.5);
  const p10Final = pct(finals, 0.1);
  const p90Final = pct(finals, 0.9);

  const medianTimeline: number[] = [], p10Timeline: number[] = [], p90Timeline: number[] = [];
  for (let c = 0; c < numCycles; c++) {
    const vals = pathTimelines.map((pt) => pt[c]).sort((a, b) => a - b);
    medianTimeline.push(pct(vals, 0.5));
    p10Timeline.push(pct(vals, 0.1));
    p90Timeline.push(pct(vals, 0.9));
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  const avgAssignments: Record<string, number> = {};
  const avgCallAways: Record<string, number> = {};
  tickers.forEach((t) => {
    avgAssignments[t.ticker] = avg(assignCounts[t.ticker]);
    avgCallAways[t.ticker] = avg(callAwayCounts[t.ticker]);
  });

  return {
    medianFinal, p10Final, p90Final,
    medianReturn: (medianFinal / startingCapital - 1) * 100,
    medianTimeline, p10Timeline, p90Timeline,
    avgAssignments, avgCallAways,
    cycles: numCycles, numPaths,
  };
}

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
    MAG7.map((t) => ({ ticker: t, group: "mag7", price: 0, blendedRocPerCycle: 0, capPerContract: 0, iv: 0 }))
  );
  const [startingCapital, setStartingCapital] = useState(49000);
  const [dte, setDte] = useState(7);
  const [horizonMonths, setHorizonMonths] = useState(24);
  const [perTickerCapPct, setPerTickerCapPct] = useState(25);
  const [groupCapPct, setGroupCapPct] = useState(75);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingScenarioName, setEditingScenarioName] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [targetDelta, setTargetDelta] = useState(30); // shown as whole percent, used as 0.30
  const [annualDrift, setAnnualDrift] = useState(0); // annualized drift %, 0 = no directional bias
  const [numPaths, setNumPaths] = useState(200);
  const [realisticResult, setRealisticResult] = useState<RealisticResult | null>(null);
  const [runningRealistic, setRunningRealistic] = useState(false);

  useEffect(() => setScenarios(loadScenarios()), []);

  const addExtraTickers = () => {
    const added = extraTickers
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s && !tickers.some((t) => t.ticker === s));
    if (!added.length) return;
    setTickers([
      ...tickers,
      ...added.map((t) => ({ ticker: t, group: "other" as const, price: 0, blendedRocPerCycle: 0, capPerContract: 0, iv: 0 })),
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

      const ivSamples = [call?.iv, put?.iv].filter((v): v is number => v != null);
      const ivPct = ivSamples.length ? ivSamples.reduce((a, b) => a + b, 0) / ivSamples.length : 30;
      const iv = ivPct / 100; // stored as percentage upstream; convert to fraction

      setTickers((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          price: p,
          capPerContract: p * 100,
          blendedRocPerCycle: blended,
          iv,
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

  const runRealistic = () => {
    const ready = tickers.filter((t) => t.capPerContract > 0 && t.iv > 0);
    if (!ready.length) return;
    setRunningRealistic(true);
    // Defer to let the button state paint before the (synchronous, potentially slow) Monte Carlo run
    setTimeout(() => {
      const r = runRealisticSimulation(
        ready, startingCapital, dte, horizonMonths,
        perTickerCapPct / 100, groupCapPct / 100,
        targetDelta / 100, annualDrift / 100, numPaths
      );
      setRealisticResult(r);
      setRunningRealistic(false);
    }, 30);
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

  const renameScenario = (id: string, newName: string) => {
    const updated = scenarios.map((s) => (s.id === id ? { ...s, name: newName } : s));
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

      {/* Realistic (Monte Carlo) mode */}
      <div style={{ borderTop: "1px solid #2a2e37", paddingTop: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>Realistic mode (Monte Carlo)</h3>
        <p style={{ color: "#9aa0a6", fontSize: 13, marginTop: 0 }}>
          Models actual price movement (GBM, using each ticker's live IV) and the real wheel mechanic — a CSP that finishes in-the-money switches to holding shares and selling calls; a call that finishes in-the-money sells the shares and switches back to CSP. Strikes are re-selected each cycle at your target delta relative to the simulated spot, so premium changes as price and time move, not held constant. Requires live-fetched IV per ticker (fetch above first).
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
          <label>Target delta % <input type="number" value={targetDelta} onChange={(e) => setTargetDelta(parseFloat(e.target.value) || 0)} style={inputStyle(50)} /></label>
          <label>Annual drift % <input type="number" value={annualDrift} onChange={(e) => setAnnualDrift(parseFloat(e.target.value) || 0)} style={inputStyle(50)} /></label>
          <label>Simulation paths <input type="number" value={numPaths} onChange={(e) => setNumPaths(Math.max(20, parseInt(e.target.value) || 20))} style={inputStyle(60)} /></label>
        </div>
        <button onClick={runRealistic} disabled={runningRealistic} style={{ ...btnStyle, background: "#7c3aed", color: "#fff", border: "none" }}>
          {runningRealistic ? "Running Monte Carlo…" : "Run realistic simulation"}
        </button>

        {realisticResult && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 24, marginBottom: 12, fontSize: 14 }}>
              <div>Median final capital: <b style={{ color: "#7ee2a8" }}>{fmtUsd(realisticResult.medianFinal)}</b></div>
              <div>Median return: <b style={{ color: "#7ee2a8" }}>{fmtPct(realisticResult.medianReturn)}</b></div>
              <div>10th–90th pctile: <b>{fmtUsd(realisticResult.p10Final)} – {fmtUsd(realisticResult.p90Final)}</b></div>
              <div>Paths: <b>{realisticResult.numPaths}</b></div>
            </div>

            <BandChart median={realisticResult.medianTimeline} p10={realisticResult.p10Timeline} p90={realisticResult.p90Timeline} dte={dte} />

            <div style={{ marginTop: 12, fontSize: 12, color: "#9aa0a6" }}>
              <div style={{ marginBottom: 4, color: "#e6e8eb" }}>Average leg switches over the horizon (per path)</div>
              {tickers.filter((t) => t.capPerContract > 0 && t.iv > 0).map((t) => (
                <span key={t.ticker} style={{ marginRight: 16 }}>
                  {t.ticker}: {realisticResult.avgAssignments[t.ticker]?.toFixed(1) ?? "0"} assigned, {realisticResult.avgCallAways[t.ticker]?.toFixed(1) ?? "0"} called away
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

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
                  <td style={{ padding: "6px 10px" }}>
                    {editingScenarioId === s.id ? (
                      <input
                        autoFocus
                        value={editingScenarioName}
                        onChange={(e) => setEditingScenarioName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            renameScenario(s.id, editingScenarioName.trim() || s.name);
                            setEditingScenarioId(null);
                          }
                          if (e.key === "Escape") setEditingScenarioId(null);
                        }}
                        onBlur={() => {
                          renameScenario(s.id, editingScenarioName.trim() || s.name);
                          setEditingScenarioId(null);
                        }}
                        style={inputStyle(160)}
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingScenarioId(s.id); setEditingScenarioName(s.name); }}
                        style={{ cursor: "pointer", borderBottom: "1px dashed #3a3f4a" }}
                        title="Click to rename"
                      >
                        {s.name}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "6px 10px" }}>{fmtUsd(s.startingCapital)}</td>
                  <td style={{ padding: "6px 10px" }}>{s.horizonMonths}mo</td>
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "#9aa0a6" }}>{s.tickers.map((t) => t.ticker).join(", ")}</td>
                  <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{s.result ? fmtUsd(s.result.finalCapital) : "—"}</td>
                  <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{s.result ? fmtPct(s.result.totalReturn) : "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <button
                      onClick={() => { setEditingScenarioId(s.id); setEditingScenarioName(s.name); }}
                      style={{ background: "none", border: "none", color: "#9aa0a6", cursor: "pointer", marginRight: 8 }}
                      title="Rename"
                    >
                      ✎
                    </button>
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

function BandChart({ median, p10, p90, dte }: { median: number[]; p10: number[]; p90: number[]; dte: number }) {
  if (!median.length) return null;
  const w = 640, h = 200, padL = 60, padR = 20, padT = 20, padB = 30;
  const max = Math.max(...p90);
  const min = Math.min(...p10);
  const range = max - min || 1;

  const startDate = new Date();
  const dateAt = (i: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i * dte);
    return d;
  };
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const x = (i: number) => padL + (i / (median.length - 1 || 1)) * (w - padL - padR);
  const y = (v: number) => h - padB - ((v - min) / range) * (h - padT - padB);

  const bandPath =
    p90.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ") +
    " " +
    p10.map((v, i) => `L ${x(p10.length - 1 - i)} ${y(p10[p10.length - 1 - i])}`).join(" ") +
    " Z";

  const medianPts = median.map((v, i) => `${x(i)},${y(v)}`);
  const yTicks = [min, (min + max) / 2, max];
  const xTickIdxs = [0, Math.floor((median.length - 1) / 2), median.length - 1];

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

      <path d={bandPath} fill="#7c3aed" opacity={0.15} stroke="none" />
      <polyline points={medianPts.join(" ")} fill="none" stroke="#a78bfa" strokeWidth={2} />

      {xTickIdxs.map((i) => (
        <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="#9aa0a6">
          {fmtDate(dateAt(i))}
        </text>
      ))}
      <text x={w - padR} y={padT} textAnchor="end" fontSize={10} fill="#9aa0a6">
        shaded band = 10th–90th percentile
      </text>
    </svg>
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
