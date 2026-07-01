git pull --rebase origin main
cat > patch_pop_and_otm_color.py << 'SCRIPT_EOF'
#!/usr/bin/env python3
"""
Patch: app/portfolio/page.tsx

1. Add `pop` field to Position interface (was referenced by getCurrentPop but
   never actually assigned anywhere — POP was always null for every position).
2. Add normalCdf + calcPositionPop (breakeven-based POP for CSP/BPS/BCS/IC,
   same approach as app/screener/page.tsx's calcSpreadPop) and set pos.pop
   at position-build time.
3. Backfill existing entry snapshots: if a stored snapshot has null
   ivrAtEntry/popAtEntry but current live data is available, fill them in
   once instead of leaving them permanently null.
4. Trade Evolution OTM line: use bufferColor(pos.buffer, pos.dte) instead of
   entryChangeColor, so the color reflects current safety level (consistent
   with the main OTM % column) rather than raw entry->now direction.
"""

import sys

FILE = "app/portfolio/page.tsx"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        print(f"ABORT: expected exactly 1 occurrence of anchor '{label}', found {count}")
        sys.exit(1)
    return text.replace(old, new, 1)


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # ── 1. Add `pop` field to Position interface ────────────────────────
    old_iface = """  // Greeks
  ivr: number | null;
  iv: number | null;          // current implied volatility %
  hv30: number | null;        // 30-day historical volatility %
  beta: number | null;        // beta to SPY
  netDelta: number | null;    // net position delta
  netVega: number | null;     // net position vega"""

    new_iface = """  // Greeks
  ivr: number | null;
  iv: number | null;          // current implied volatility %
  hv30: number | null;        // 30-day historical volatility %
  beta: number | null;        // beta to SPY
  netDelta: number | null;    // net position delta
  netVega: number | null;     // net position vega
  pop: number | null;         // current probability of profit (breakeven-based), % 0-100"""

    content = replace_once(content, old_iface, new_iface, "Position interface Greeks block")

    # ── 2. Add normalCdf + calcPositionPop above the position-build block ──
    old_anchor = """  let profitTargets: Record<string, number> = {};
  try { profitTargets = JSON.parse(localStorage.getItem(LS_PROFIT_TARGETS) ?? '{}'); } catch {}"""

    new_anchor = """  let profitTargets: Record<string, number> = {};
  try { profitTargets = JSON.parse(localStorage.getItem(LS_PROFIT_TARGETS) ?? '{}'); } catch {}

  // ── POP (probability of profit) ──────────────────────────────────────
  // Breakeven-based estimate under lognormal price assumption, same approach
  // as app/screener/page.tsx's calcSpreadPop. Extended here to cover every
  // strategy type that can appear in an open portfolio (CSP included, plus
  // the two-sided IC case), since screener only ever quotes new BPS/BCS.
  const positionNormalCdf = (x: number): number => {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * absX);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const erfApprox =
      sign *
      (1 -
        (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
          t *
          Math.exp(-absX * absX)));
    return 0.5 * (1 + erfApprox);
  };

  // POP that price stays above a lower breakeven (short put / put-side breach level).
  const positionPopAbove = (price: number, breakeven: number, dte: number, ivPct: number): number => {
    const sigma = ivPct / 100;
    const t = dte / 365;
    const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
    return positionNormalCdf(d2) * 100;
  };

  // POP that price stays below an upper breakeven (short call / call-side breach level).
  const positionPopBelow = (price: number, breakeven: number, dte: number, ivPct: number): number => {
    const sigma = ivPct / 100;
    const t = dte / 365;
    const d2 = (Math.log(price / breakeven) - 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
    return (1 - positionNormalCdf(d2)) * 100;
  };

  const calcPositionPop = (
    strategy: string,
    legs: PositionLeg[],
    price: number | null,
    creditReceived: number,
    dte: number,
    ivPct: number | null
  ): number | null => {
    if (price == null || price <= 0 || ivPct == null || ivPct <= 0 || dte <= 0) return null;

    const creditPerShare = Math.abs(creditReceived) / 100;
    const shortPut = legs.find(l => l.optionType === 'P' && l.direction === 'Short');
    const shortCall = legs.find(l => l.optionType === 'C' && l.direction === 'Short');

    if (strategy === 'PUT' || strategy === 'BPS') {
      if (!shortPut) return null;
      const breakeven = shortPut.strikePrice - creditPerShare;
      if (breakeven <= 0) return null;
      return positionPopAbove(price, breakeven, dte, ivPct);
    }

    if (strategy === 'CALL' || strategy === 'BCS') {
      if (!shortCall) return null;
      const breakeven = shortCall.strikePrice + creditPerShare;
      return positionPopBelow(price, breakeven, dte, ivPct);
    }

    if (strategy === 'IC') {
      if (!shortPut || !shortCall) return null;
      // IC profits only while price stays between both breakevens. Total
      // credit is split across both sides for a conservative breakeven
      // estimate (matches how max profit is realized at expiration).
      const putBreakeven = shortPut.strikePrice - creditPerShare / 2;
      const callBreakeven = shortCall.strikePrice + creditPerShare / 2;
      if (putBreakeven <= 0) return null;
      const popAbovePut = positionPopAbove(price, putBreakeven, dte, ivPct);
      const popBelowCall = positionPopBelow(price, callBreakeven, dte, ivPct);
      // Probability of staying inside the range: sum of both one-sided
      // breach probabilities subtracted from 100, floored at 0.
      return Math.max(0, popAbovePut + popBelowCall - 100);
    }

    return null;
  };"""

    content = replace_once(content, old_anchor, new_anchor, "profitTargets anchor (POP function insertion point)")

    # ── 3. Set pos.pop at build time ─────────────────────────────────────
    old_pop_field = """      accountNumber,
      ivr: ivrMap[symbol] ?? null,
      iv: ivMap[symbol] ?? null,
      hv30: hv30Map[symbol] ?? null,
      beta: betaMap[symbol] ?? null,"""

    new_pop_field = """      accountNumber,
      ivr: ivrMap[symbol] ?? null,
      iv: ivMap[symbol] ?? null,
      hv30: hv30Map[symbol] ?? null,
      beta: betaMap[symbol] ?? null,
      pop: calcPositionPop(strategy, positionLegs, stockPrices[symbol] ?? null, creditReceived, dte, ivMap[symbol] ?? null),"""

    content = replace_once(content, old_pop_field, new_pop_field, "position object ivr/iv/hv30/beta block")

    # ── 4. Backfill existing snapshots with null ivrAtEntry/popAtEntry ────
    old_snapshot_reuse = """    if (!snap) {
      snap = {
        key,
        createdAt: new Date().toISOString(),
        symbol: pos.symbol,
        strategy: pos.strategy,
        expDate: pos.expDate,
        entryDate: pos.entryDate,
        ivAtEntry: pos.iv ?? null,
        ivrAtEntry: pos.ivr ?? null,
        popAtEntry: getCurrentPop(pos),
        deltaAtEntry: pos.netDelta ?? null,
        thetaAtEntry: pos.theta ?? null,
        otmAtEntry: pos.buffer ?? null,
        dteAtEntry: pos.entryDte ?? pos.dte ?? null,
      };
      snapshots[key] = snap;
      changed = true;
    }"""

    new_snapshot_reuse = """    if (!snap) {
      snap = {
        key,
        createdAt: new Date().toISOString(),
        symbol: pos.symbol,
        strategy: pos.strategy,
        expDate: pos.expDate,
        entryDate: pos.entryDate,
        ivAtEntry: pos.iv ?? null,
        ivrAtEntry: pos.ivr ?? null,
        popAtEntry: getCurrentPop(pos),
        deltaAtEntry: pos.netDelta ?? null,
        thetaAtEntry: pos.theta ?? null,
        otmAtEntry: pos.buffer ?? null,
        dteAtEntry: pos.entryDte ?? pos.dte ?? null,
      };
      snapshots[key] = snap;
      changed = true;
    } else {
      // One-time backfill: earlier sessions could capture a snapshot before
      // ivr/pop data had loaded, permanently locking in a null baseline.
      // If live data is available now and the stored baseline is still
      // null, fill it in once so Trade Evolution stops showing '—' forever.
      if (snap.ivrAtEntry == null && pos.ivr != null) {
        snap.ivrAtEntry = pos.ivr;
        changed = true;
      }
      if (snap.popAtEntry == null && getCurrentPop(pos) != null) {
        snap.popAtEntry = getCurrentPop(pos);
        changed = true;
      }
    }"""

    content = replace_once(content, old_snapshot_reuse, new_snapshot_reuse, "snapshot creation block (backfill insertion)")

    # ── 5. Trade Evolution OTM line: use bufferColor instead of entryChangeColor ──
    old_otm_color = """                <span className={entryChangeColor(pos.otmAtEntry, pos.buffer, false, th.textFaint)}>
                  OTM {fmtEntryNowPct(pos.otmAtEntry, pos.buffer, 1)}
                </span>"""

    new_otm_color = """                <span className={bufferColor(pos.buffer, pos.dte)}>
                  OTM {fmtEntryNowPct(pos.otmAtEntry, pos.buffer, 1)}
                </span>"""

    content = replace_once(content, old_otm_color, new_otm_color, "Trade Evolution OTM color")

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print("OK: patched POP calculation, snapshot backfill, and Trade Evolution OTM color.")


if __name__ == "__main__":
    main()
SCRIPT_EOF
python3 patch_pop_and_otm_color.py && git add . && git commit -m "Portfolio: add real POP calculation (CSP/BPS/BCS/IC), backfill stale entry-snapshot IVR/POP baselines, fix Trade Evolution OTM color to use bufferColor for consistency with main OTM% column" && git push
