"use client";
import { useState } from "react";

const DEFAULT_ROWS = [
  { ticker: "NVDA", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "MSFT", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "META", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "GOOGL", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "AAPL", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "AMZN", dte: 7, price: "", credit: "", shares: 100 },
  { ticker: "TSLA", dte: 7, price: "", credit: "", shares: 100 },
];

function num(v: any) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export default function CCTracker() {
  const [rows, setRows] = useState(DEFAULT_ROWS);

  const update = (i: number, field: string, val: any) => {
    const next: any = [...rows];
    next[i] = { ...next[i], [field]: val };
    setRows(next);
  };

  const addRow = () =>
    setRows([...rows, { ticker: "", dte: 7, price: "", credit: "", shares: 100 }]);

  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const computed = rows.map((r) => {
    const price = num(r.price);
    const credit = num(r.credit);
    const shares = num(r.shares) || 100;
    const contracts = Math.floor(shares / 100);
    const cap = price * shares;
    const revenuePerCycle = credit * 100 * contracts;
    const roc = cap > 0 ? (revenuePerCycle / cap) * 100 : 0;
    const dte = num(r.dte) || 1;
    const annualizedRoc = roc * (365 / dte);
    const cyclesIn3mo = 91 / dte;
    const revenue3mo = revenuePerCycle * cyclesIn3mo;
    const roc3mo = cap > 0 ? (revenue3mo / cap) * 100 : 0;
    return { ...r, cap, revenuePerCycle, roc, annualizedRoc, cyclesIn3mo, revenue3mo, roc3mo };
  });

  const totals = computed.reduce(
    (acc, c) => ({
      cap: acc.cap + c.cap,
      revenuePerCycle: acc.revenuePerCycle + c.revenuePerCycle,
      revenue3mo: acc.revenue3mo + c.revenue3mo,
    }),
    { cap: 0, revenuePerCycle: 0, revenue3mo: 0 }
  );
  const totalRoc3mo = totals.cap > 0 ? (totals.revenue3mo / totals.cap) * 100 : 0;

  const fmtUsd = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20, background: "#0f1115", color: "#e6e8eb", minHeight: "100vh" }}>
      <h2 style={{ marginBottom: 4 }}>Covered Call Capital Model</h2>
      <p style={{ color: "#9aa0a6", marginTop: 0, fontSize: 13 }}>
        Enter price, credit ($/share), DTE, and shares owned per ticker. ROC and 3-month projections calculate automatically.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#1b1e24", textAlign: "left" }}>
              {["Ticker", "DTE", "Shares", "Price", "Credit", "Cap Req'd", "Rev/Cycle", "ROC/Cycle", "Ann. ROC", "3mo Cycles", "3mo Revenue", "3mo ROC", ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #2a2e37" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computed.map((c, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #22252c" }}>
                <td style={{ padding: 6 }}>
                  <input value={c.ticker} onChange={(e) => update(i, "ticker", e.target.value.toUpperCase())}
                    style={inputStyle(50)} />
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={c.dte} onChange={(e) => update(i, "dte", e.target.value)}
                    style={inputStyle(45)} />
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={c.shares} onChange={(e) => update(i, "shares", e.target.value)}
                    style={inputStyle(55)} />
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={c.price} onChange={(e) => update(i, "price", e.target.value)}
                    placeholder="0.00" style={inputStyle(65)} />
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={c.credit} onChange={(e) => update(i, "credit", e.target.value)}
                    placeholder="0.00" style={inputStyle(60)} />
                </td>
                <td style={{ padding: "6px 10px" }}>{fmtUsd(c.cap)}</td>
                <td style={{ padding: "6px 10px" }}>{fmtUsd(c.revenuePerCycle)}</td>
                <td style={{ padding: "6px 10px" }}>{fmtPct(c.roc)}</td>
                <td style={{ padding: "6px 10px" }}>{fmtPct(c.annualizedRoc)}</td>
                <td style={{ padding: "6px 10px" }}>{c.cyclesIn3mo.toFixed(1)}</td>
                <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{fmtUsd(c.revenue3mo)}</td>
                <td style={{ padding: "6px 10px", color: "#7ee2a8" }}>{fmtPct(c.roc3mo)}</td>
                <td style={{ padding: 6 }}>
                  <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer" }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#1b1e24", fontWeight: 600 }}>
              <td colSpan={5} style={{ padding: "8px 10px" }}>Total</td>
              <td style={{ padding: "8px 10px" }}>{fmtUsd(totals.cap)}</td>
              <td style={{ padding: "8px 10px" }}>{fmtUsd(totals.revenuePerCycle)}</td>
              <td colSpan={3}></td>
              <td style={{ padding: "8px 10px", color: "#7ee2a8" }}>{fmtUsd(totals.revenue3mo)}</td>
              <td style={{ padding: "8px 10px", color: "#7ee2a8" }}>{fmtPct(totalRoc3mo)}</td>
              <td></td>
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
