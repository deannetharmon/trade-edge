"use client";
import { useState } from "react";
import { getAccessToken, getQuote, getChain } from "@/lib/scans/tastytrade-client";
import { daysUntil } from "@/lib/scans/scan-utils";

type Row = {
  ticker: string;
  dte: number;
  targetDelta: number; // e.g. 0.30, used for both CC and CSP unless overridden
  price: string;
  shares: number;

  ccCredit: string;
  ccExpUsed?: string;
  ccStrikeUsed?: number;

  cspCredit: string;
  cspExpUsed?: string;
  cspStrikeUsed?: number;

  fetching?: boolean;
  fetchError?: string;
};

const DEFAULT_ROWS: Row[] = [
  "NVDA", "MSFT", "META", "GOOGL", "AAPL", "AMZN", "TSLA",
].map((t) => ({
  ticker: t,
  dte: 7,
  targetDelta: 0.3,
  price: "",
  shares: 100,
  ccCredit: "",
  cspCredit: "",
}));

function num(v: any) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export default function CCTracker() {
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);

  const update = (i: number, field: keyof Row, val: any) => {
    const next = [...rows];
    next[i] = { ...next[i], [field]: val };
    setRows(next);
  };

  const addRow = () =>
    setRows([...rows, { ticker: "", dte: 7, targetDelta: 0.3, price: "", shares: 100, ccCredit: "", cspCredit: "" }]);

  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  // Pull live price + nearest-to-target-delta call AND put for one row
  const fetchRow = async (i: number) => {
    const row = rows[i];
    const symbol = row.ticker.trim().toUpperCase();
    if (!symbol) return;

    update(i, "fetching", true);
    update(i, "fetchError", "");

    try {
      const token = await getAccessToken();

      const [price, chainData] = await Promise.all([
        getQuote(symbol, token),
        getChain(symbol, token, {} as any, {
          min: Math.max(row.dte - 3, 0),
          max: row.dte + 3,
        }),
      ]);

      if (!chainData.expirations.length) {
        throw new Error(`No expirations found near ${row.dte} DTE`);
      }

      // Pick the expiration whose DTE is closest to the target
      let bestExp = chainData.expirations[0];
      let bestDteDiff = Infinity;
      for (const exp of chainData.expirations) {
        const diff = Math.abs(daysUntil(exp) - row.dte);
        if (diff < bestDteDiff) {
          bestDteDiff = diff;
          bestExp = exp;
        }
      }

      const contracts = chainData.chains[bestExp] || [];

      const pickClosest = (optionType: "C" | "P") => {
        const candidates = contracts.filter((c: any) => c.optionType === optionType && c.delta != null);
        if (!candidates.length) return null;
        let best = candidates[0];
        let bestDiff = Infinity;
        for (const c of candidates) {
          const diff = Math.abs(Math.abs(c.delta) - row.targetDelta);
          if (diff < bestDiff) { bestDiff = diff; best = c; }
        }
        return best;
      };

      const bestCall = pickClosest("C");
      const bestPut = pickClosest("P");

      if (!bestCall && !bestPut) throw new Error(`No options with delta found for ${bestExp}`);

      const next = [...rows];
      next[i] = {
        ...next[i],
        price: price != null ? price.toFixed(2) : next[i].price,
        ccCredit: bestCall?.bid != null ? bestCall.bid.toFixed(2) : next[i].ccCredit,
        ccExpUsed: bestCall ? bestExp : next[i].ccExpUsed,
        ccStrikeUsed: bestCall ? bestCall.strikePrice : next[i].ccStrikeUsed,
        cspCredit: bestPut?.bid != null ? bestPut.bid.toFixed(2) : next[i].cspCredit,
        cspExpUsed: bestPut ? bestExp : next[i].cspExpUsed,
        cspStrikeUsed: bestPut ? bestPut.strikePrice : next[i].cspStrikeUsed,
        fetching: false,
        fetchError: "",
      };
      setRows(next);
    } catch (err: any) {
      update(i, "fetching", false);
      update(i, "fetchError", err.message || "Fetch failed");
    }
  };

  const fetchAll = async () => {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ticker.trim()) await fetchRow(i);
    }
  };

  const computed = rows.map((r) => {
    const price = num(r.price);
    const shares = num(r.shares) || 100;
    const contracts = Math.floor(shares / 100);
    const dte = num(r.dte) || 1;
    const cyclesIn3mo = 91 / dte;

    // CC side — capital = shares already owned (price x shares)
    const ccCredit = num(r.ccCredit);
    const ccCap = price * shares;
    const ccRevenuePerCycle = ccCredit * 100 * contracts;
    const ccRoc = ccCap > 0 ? (ccRevenuePerCycle / ccCap) * 100 : 0;
    const ccRevenue3mo = ccRevenuePerCycle * cyclesIn3mo;
    const ccRoc3mo = ccCap > 0 ? (ccRevenue3mo / ccCap) * 100 : 0;

    // CSP side — capital = strike x 100 x contracts (cash-secured)
    const cspCredit = num(r.cspCredit);
    const cspStrike = r.cspStrikeUsed ?? price;
    const cspCap = cspStrike * shares;
    const cspRevenuePerCycle = cspCredit * 100 * contracts;
    const cspRoc = cspCap > 0 ? (cspRevenuePerCycle / cspCap) * 100 : 0;
    const cspRevenue3mo = cspRevenuePerCycle * cyclesIn3mo;
    const cspRoc3mo = cspCap > 0 ? (cspRevenue3mo / cspCap) * 100 : 0;

    return {
      ...r, cyclesIn3mo,
      ccCap, ccRevenuePerCycle, ccRoc, ccRevenue3mo, ccRoc3mo,
      cspCap, cspRevenuePerCycle, cspRoc, cspRevenue3mo, cspRoc3mo,
    };
  });

  const totals = computed.reduce(
    (acc, c) => ({
      ccCap: acc.ccCap + c.ccCap,
      ccRevenue3mo: acc.ccRevenue3mo + c.ccRevenue3mo,
      cspCap: acc.cspCap + c.cspCap,
      cspRevenue3mo: acc.cspRevenue3mo + c.cspRevenue3mo,
    }),
    { ccCap: 0, ccRevenue3mo: 0, cspCap: 0, cspRevenue3mo: 0 }
  );
  const totalCcRoc3mo = totals.ccCap > 0 ? (totals.ccRevenue3mo / totals.ccCap) * 100 : 0;
  const totalCspRoc3mo = totals.cspCap > 0 ? (totals.cspRevenue3mo / totals.cspCap) * 100 : 0;

  const fmtUsd = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20, background: "#0f1115", color: "#e6e8eb", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Wheel Capital Model — CC + CSP</h2>
        <button onClick={fetchAll} style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
          Fetch all live data
        </button>
      </div>
      <p style={{ color: "#9aa0a6", marginTop: 0, fontSize: 13 }}>
        Fetches live price, the call, and the put nearest your target delta/DTE. CC assumes shares already owned; CSP assumes cash-secured at strike. Shown side-by-side, not combined (you're doing one or the other at a time).
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 1400 }}>
          <thead>
            <tr style={{ background: "#1b1e24", textAlign: "left" }}>
              <th rowSpan={2} style={thStyle}>Ticker</th>
              <th rowSpan={2} style={thStyle}>DTE</th>
              <th rowSpan={2} style={thStyle}>Target Δ</th>
              <th rowSpan={2} style={thStyle}>Shares</th>
              <th rowSpan={2} style={thStyle}>Price</th>
              <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#1e2a3a" }}>Covered Call</th>
              <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#2a1e1e" }}>CSP</th>
              <th rowSpan={2} style={thStyle}></th>
              <th rowSpan={2} style={thStyle}></th>
            </tr>
            <tr style={{ background: "#1b1e24", textAlign: "left" }}>
              <th style={thStyle}>Credit</th>
              <th style={thStyle}>Strike/Exp</th>
              <th style={thStyle}>Cap Req'd</th>
              <th style={thStyle}>3mo ROC</th>
              <th style={thStyle}>Credit</th>
              <th style={thStyle}>Strike/Exp</th>
              <th style={thStyle}>Cap Req'd</th>
              <th style={thStyle}>3mo ROC</th>
            </tr>
          </thead>
          <tbody>
            {computed.map((c, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #22252c" }}>
                <td style={tdStyle}>
                  <input value={c.ticker} onChange={(e) => update(i, "ticker", e.target.value.toUpperCase())} style={inputStyle(60)} />
                </td>
                <td style={tdStyle}>
                  <input type="number" value={c.dte} onChange={(e) => update(i, "dte", parseInt(e.target.value) || 0)} style={inputStyle(45)} />
                </td>
                <td style={tdStyle}>
                  <input type="number" step="0.01" value={c.targetDelta} onChange={(e) => update(i, "targetDelta", parseFloat(e.target.value) || 0)} style={inputStyle(50)} />
                </td>
                <td style={tdStyle}>
                  <input type="number" value={c.shares} onChange={(e) => update(i, "shares", parseInt(e.target.value) || 0)} style={inputStyle(55)} />
                </td>
                <td style={tdStyle}>
                  <input type="number" value={c.price} onChange={(e) => update(i, "price", e.target.value)} placeholder="0.00" style={inputStyle(65)} />
                </td>

                {/* CC side */}
                <td style={tdStyle}>
                  <input type="number" value={c.ccCredit} onChange={(e) => update(i, "ccCredit", e.target.value)} placeholder="0.00" style={inputStyle(60)} />
                </td>
                <td style={{ ...tdStyle, color: "#9aa0a6", fontSize: 11 }}>{c.ccStrikeUsed ? `${c.ccStrikeUsed}C ${c.ccExpUsed}` : "—"}</td>
                <td style={tdStyle}>{fmtUsd(c.ccCap)}</td>
                <td style={{ ...tdStyle, color: "#7ee2a8" }}>{fmtPct(c.ccRoc3mo)}</td>

                {/* CSP side */}
                <td style={tdStyle}>
                  <input type="number" value={c.cspCredit} onChange={(e) => update(i, "cspCredit", e.target.value)} placeholder="0.00" style={inputStyle(60)} />
                </td>
                <td style={{ ...tdStyle, color: "#9aa0a6", fontSize: 11 }}>{c.cspStrikeUsed ? `${c.cspStrikeUsed}P ${c.cspExpUsed}` : "—"}</td>
                <td style={tdStyle}>{fmtUsd(c.cspCap)}</td>
                <td style={{ ...tdStyle, color: "#7ee2a8" }}>{fmtPct(c.cspRoc3mo)}</td>

                <td style={tdStyle}>
                  <button onClick={() => fetchRow(i)} disabled={c.fetching} style={{ padding: "4px 8px", background: "#2a2e37", color: "#e6e8eb", border: "1px solid #3a3f4a", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
                    {c.fetching ? "…" : "Fetch"}
                  </button>
                  {c.fetchError && <div style={{ color: "#e05252", fontSize: 10, marginTop: 2 }}>{c.fetchError}</div>}
                </td>
                <td style={tdStyle}>
                  <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer" }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#1b1e24", fontWeight: 600 }}>
              <td colSpan={7} style={tdStyle}>Total</td>
              <td style={tdStyle}>{fmtUsd(totals.ccCap)}</td>
              <td style={{ ...tdStyle, color: "#7ee2a8" }}>{fmtPct(totalCcRoc3mo)}</td>
              <td></td>
              <td></td>
              <td style={tdStyle}>{fmtUsd(totals.cspCap)}</td>
              <td style={{ ...tdStyle, color: "#7ee2a8" }}>{fmtPct(totalCspRoc3mo)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <button onClick={addRow} style={{ marginTop: 12, padding: "6px 14px", background: "#2a2e37", color: "#e6e8eb", border: "1px solid #3a3f4a", borderRadius: 6, cursor: "pointer" }}>
        + Add ticker
      </button>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #2a2e37" };
const tdStyle: React.CSSProperties = { padding: "6px 10px" };

function inputStyle(width: number) {
  return {
    width,
    background: "#14161b",
    color: "#e6e8eb",
    border: "1px solid #2a2e37",
    borderRadius: 4,
    padding: "4px 6px",
    fontSize: 13,
  };
}
