# Portfolio Position Card — Metrics Calculation Audit

**Scope:** every metric rendered on a position card in `/portfolio` (the same file reviewed for TE-0002) — including the collapsed-card metrics (items 1–18) and the two expanded-card sections, Legs and What Moved (items 19–20). Reference screenshots: two open positions, `NKE` (short-dated CSP, 9d/8 DTE-left entry) and `MU` (BPS, 800P/790P, 29 DTE), plus MU's expanded view.

**Files:**
- `lib/portfolio-data/acquisition.ts` — `loadPositions()` (~lines 806–1550), the data layer that fetches broker data and computes every `Position` field.
- `lib/portfolio-data/types.ts` — the `Position` interface.
- `app/portfolio/page.tsx` — the `PositionCard` component (~lines 7800–8240) that renders the fields, plus formatter/label helper functions (`page.tsx` ~lines 2360–2430, ~6800–7400).
- `lib/portfolio/stopLossPolicy.ts` — canonical stop-loss classification (from TE-0002).

For each metric below: the formula, its exact source location, whether it's a **broker-reported** value, a **live-computed** value, or a **modeled estimate**, and any assumptions/hardcoded constants baked into it. Where the screenshot's numbers let me verify the arithmetic directly, I've done so — those are marked "✓ verified against screenshot."

---

## 1. Stock

**What it is:** the underlying's current price.

**Calculation** — `acquisition.ts:969–987`:
```
mid = (bid + ask) / 2
stockPrice = mid > 0 ? mid : (mark > 0 ? mark : 0)
```
Sourced from TastyTrade's `/market-data/by-type` endpoint. **Broker-reported**, not modeled. Indices (SPX/NDX/RUT/VIX/DJX) are queried with `index=`; everything else with `equity=`.

**Assumption:** if both mid and mark are unavailable, the field is set to `0`, not `null` — a position with no live quote would display "$0.00" rather than a dash. (OTM %, Cash Req, etc. that key off stock price would then read as extreme values instead of "unavailable.")

---

## 2. OTM % ("buffer")

**What it is:** percentage distance from the current stock price to the short strike.

**Calculation** — `acquisition.ts:1480–1488`:
```
buffer = optionType === 'P'
  ? (stock - shortStrike) / stock * 100
  : (shortStrike - stock) / stock * 100
```

**✓ verified against screenshot:**
- NKE: stock $42.26, short strike 40.5P → (42.26 − 40.5) / 42.26 × 100 = **4.16% ≈ 4.2%** (displayed: 4.2%)
- MU: stock $876.40, short strike 800P → (876.40 − 800) / 876.40 × 100 = **8.72% ≈ 8.7%** (displayed: 8.7%)

**Assumption:** uses `shorts[0]` — the *first* short leg found in the position's leg array, not explicitly the "worst" (closest-to-money) short leg. For a single-short-leg strategy (CSP, BPS, BCS) this is unambiguous, but for an iron condor with two short legs, this metric only reflects one side unless the code elsewhere special-cases it — worth confirming with a live IC position if you have one open.

**Color coding** — `bufferColor()`, `page.tsx:7358–7390` — thresholds get stricter as DTE shrinks (e.g., <1% is only "orange" with >30 DTE left, but is "red" inside 30 DTE). Fully deterministic, no estimation.

---

## 3. Eff Buy / Strike (CSP) or Strikes (spread)

**CSP formula** — `page.tsx:7564–7568`:
```
effectiveBuyPrice = strike - avgOpenPrice(per-share premium)
```
**✓ verified:** NKE strike 40.5, premium $0.45/contract (credit $225 ÷ 5 contracts ÷ 100 = $0.45) → 40.5 − 0.45 = **$40.05** (displayed: $40.05 ← 40.5P).

**Assumption/fallback:** if the broker's per-leg `average-open-price` is missing, the code falls back to `pos.creditReceived` directly — but `creditReceived` is a **whole-position dollar total**, while the formula expects a **per-share** premium. This fallback would produce a badly wrong effective-buy price if it ever triggers (e.g., for a 5-contract position, off by a factor of ~500). Worth flagging as a real bug risk if `average-open-price` is ever null.

**Spread formula** — `strikesSummary()`, `page.tsx:7574–7579`: pulls strikes straight from the parsed OCC option symbols (e.g., MU's "800P / 790P"). No estimation — this one's pure display of broker-reported strikes.

---

## 4. Cash Req (CSP) or Max Risk (spread)

**Cash Req** — `page.tsx:7568`:
```
cashRequired = strike × 100 × contracts
```
**✓ verified:** NKE 40.5 × 100 × 5 = **$20,250** (displayed: $20,250).

**Assumption:** treats every CSP as fully cash-secured at 100 shares/contract. It does **not** check the account's actual margin type — a portfolio-margin or reduced-buying-power account would have a materially lower real requirement than this number implies.

**Max Risk (spreads)** — `calculateMaxRisk()` + `sideGrossRisk()`, `acquisition.ts:391–453`:
```
grossRisk = |shortStrike - longStrike| × 100 × matchedQty   (per matched short/long pair)
maxRisk   = max(0, grossRisk - |creditReceived|)
```
**✓ verified:** MU width = |800 − 790| = 10 → 10 × 100 × 5 = $5,000 gross, minus credit $1,260 → **$3,740** (displayed: $3,740).

**Assumption:** pairs each short leg with the *nearest* long leg by strike; any short quantity that can't be matched to a protective long is priced as fully **naked** (`shortStrike × 100 × unmatchedQty`) — a deliberately conservative fallback, not a real margin calculation. For an iron condor, only the worse of the two sides (put or call) counts, since both can't be breached simultaneously.

---

## 5. Buyback (mid) / Close now (marketable)

**Mid ("currentValue")** — `acquisition.ts:1321–1328`: sums each leg's `(bid+ask)/2` (or mark if one-sided), signed by direction, ×100. Requires *every* leg to have a price or the whole value is `null`.

**Marketable ("closeValue")** — `acquisition.ts:1330–1348`: prices short legs at the **ask** (what you'd actually pay to buy them back) and long legs at the **bid** (what you'd actually receive selling them) — i.e. the real, executable price, not the optimistic midpoint. Explicitly returns `null` (not a mark-based fallback) if any leg's market is one-sided — the code comment states this is deliberate, since falling back to mark would make "marketable" look artificially as good as mid.

**✓ verified:** MU Buyback (mid) $1,750 vs. Close now (marketable) $5,575 — a large mid/marketable gap, consistent with the wide/degraded quote quality already flagged on this exact position by the TE-0002 stop-loss work (MU's stop-quality regression fixture is a real $3–5-wide leg market).

**Assumption:** "marketable" assumes a full-quantity fill at the current bid/ask — no slippage beyond the quoted spread, no partial fills.

---

## 6. Credit

**Calculation** — `calculateSpreadCredit()`, `acquisition.ts:379–388`:
```
credit = Σ (leg.avgOpenPrice × qty × [+1 short / -1 long]) × 100, floored at 0
```
**✓ verified:** NKE $225.00 (5 contracts × $0.45), MU $1,260.00 (5 contracts × $2.52 net).

**Assumption:** floored at `0` via `Math.max(0, …)` — a position that was actually opened for a net *debit* would display Credit = $0.00 rather than a negative number, silently masking that it isn't a credit trade at all.

---

## 7. Emergency Close P/L

**Calculation** — `acquisition.ts:1429`:
```
closeNowPnl = |creditReceived| - |closeValue (marketable)|
```
Same "what would I actually get filled at right now" basis as item 5's marketable value — this is the realistic, not optimistic, exit P/L. Returns `null` (hidden) whenever any leg lacks a two-sided market, same gating as `closeValue`.

---

## 8. P/L Open ("Close P/L")

**Displayed value** — `page.tsx:7949–7969` — prefers the live, mid-based `pos.pnl`; falls back to `pos.plOpen` (flagged with a `~` for "stale") only if the live figure is unavailable.

**pnl (live/mid)** — `acquisition.ts:1391–1392`:
```
pnl = |creditReceived| - |currentValue (mid)|
pnlPct = pnl / |creditReceived| × 100
```
**✓ verified:** MU: 1,260 − 1,750 = **−$490**; −490/1,260 × 100 = **−38.9%** (displayed: −$490 (−38.9%)).

**plOpen (broker mark/EOD fallback)** — `acquisition.ts:1130–1155`: uses the broker's own `mark-price` (falling back to `close-price` if mark is 0) times qty × 100, per leg, netted by direction. This is a different, broker-authoritative number that can diverge from the app's own mid-based `pnl` — the UI's `~` flag exists specifically because these two bases aren't always the same figure.

---

## 9. 50% Target

**Target price** — `acquisition.ts:1393–1395`:
```
profitTarget = user-configured (localStorage), default 0.5 (50%)
targetPrice  = |creditReceived| × profitTarget
```
**✓ verified:** MU: 1,260 × 0.5 = **$630.00** (displayed: $630.00).

**Projection ("50% unlikely before 21-DTE")** — `page.tsx:7522–7555` — this is a **modeled estimate**, not a broker figure:
```
targetRatio         = targetPrice / currentValue
daysRemainingAtTarget = dte × targetRatio²         (√time value-decay heuristic)
daysToTarget         = dte - daysRemainingAtTarget
```
projects a date, compares it against 21 calendar days before expiration (the "should be closing by now" management line), and labels the outcome "on track" or "unlikely."

**Assumptions:** the √time model assumes option value decays proportionally to the square root of days remaining — a rough approximation, not a real theta/vol-adjusted projection. It's explicitly **not attempted** at all when `buffer < 3%` (the code comment notes that near the strike, value is mostly intrinsic and the decay model doesn't apply). The 21-DTE management line and 50% default target are both hardcoded.

---

## 10. Trade Evolution block

Every row compares a value **captured once, the first time TradeEdge observed this position** (`*AtEntry` fields, `acquisition.ts:325–360`) against the live current value. **Important assumption:** if the position was opened before you started using TradeEdge, this "entry" baseline is really "first-seen-by-the-app," not the true trade open — the UI is aware of this and shows a "(new baseline)" badge with a caveat message in that case (`page.tsx:7349–7355`, `page.tsx:8003–8018`).

Per-row formulas (all in `page.tsx:2366–2411`, rendered `page.tsx:8022–8084`):

| Row | Formula | Notes |
|---|---|---|
| POP | `entry% → current%` | see item 18's POP model below |
| Δ (delta) | `(entry×100).toFixed(0) → (current×100).toFixed(0)` % | |
| θ (theta) | `(entry×100).toFixed(0) → (current×100).toFixed(0)` /d | same ×100 dollar-scaling as the main Theta box |
| Γ (gamma) | `abs(entry).toFixed(3) → abs(current).toFixed(3)` | sign stripped for display |
| V (vega) | signed, 2 decimals | |
| Edge | `netEdgeFrom(entry inputs) → netEdgeFrom(current inputs)` | same model as item 11; returns "—" if any of the 4 entry inputs is missing |
| OTM | entry% → current% | reuses `buffer`/`otmAtEntry` |
| IV | entry% → current% | |
| IVR | entry → current (no % sign, whole numbers) | |
| DTE | entry → current, in days | |

Row colors (`entryChangeColor()`, `page.tsx:2420–2426`): green/red depending on whether the direction of change is favorable for that specific metric (a metric-specific `goodWhenDown` flag), gray if the change is negligible (<0.01).

---

## 11. Net Edge

**This is a modeled estimate, explicitly labeled `~est` in the UI** (`page.tsx:8093`).

**Formula** — `netEdgeFrom()`, `acquisition.ts:1695–1712`:
```
dailyMove       = stockPrice × (IV/100) × √(1/252)         // implied 1σ daily $ move
thetaDollars    = theta × 100
gammaCostDollars = 0.5 × |gamma| × dailyMove² × 100
netEdge         = thetaDollars - gammaCostDollars
```
This is the standard options "theta minus gamma-implied daily cost" approximation: it derives an expected 1-standard-deviation daily price move from the position's own IV, prices the quadratic gamma P&L cost of that move, and nets it against theta income.

**Assumptions/hardcoded constants:** 252 trading days/year; 100-share option multiplier; uses the position's own IV as the sole volatility input (no separate realized-vol cross-check); a symmetric daily move (doesn't distinguish up-day vs. down-day gamma cost).

**Peak/series** — `netEdgePeak()`/`netEdgeSeries()`, `acquisition.ts:1721–1738`, built by re-running the same formula against each historical daily snapshot. **Rollover flag** ("▼ off peak") fires when live edge is below the tracked peak with ≥2 days of history (`page.tsx:7249–7256`). Color: red if ≤0, green within 15% of peak, amber otherwise (`page.tsx:6983–6992`).

---

## 12. Theta

**Raw per-share value** — `acquisition.ts:1489–1499`: nets each leg's **broker-reported** per-share theta (from `/market-data/by-type`), short legs positive, long legs negative, weighted by quantity. **Broker-reported Greek, not modeled.**

**Display** — `fmtThetaDisplay()`, `page.tsx:6813–6818`: `theta × 100` (dollar-scaled), e.g. MU's raw theta ≈0.12/share → displayed **+$12/d**.

**Label thresholds** (on the raw per-share value): ≥0.10 "★ Strong Decay", ≥0.05 "✓ Good Decay", ≥0.01 "~ Light Decay", else "✗ Paying Theta". MU's theta clears the top threshold, matching the displayed "Strong Decay."

---

## 13. Gamma

**Raw value** — `acquisition.ts:1500–1510`: same leg-netting approach as theta, but sign is **inverted** vs. theta — short legs are *negative* gamma (you're short gamma when short options), long legs positive. **Broker-reported.**

**Display** — `fmtGammaDisplay()`, `page.tsx:6827–6830`: absolute value only, 3 decimals — sign is stripped in the UI even though it's tracked internally.

**Label thresholds (on |gamma|):** <0.030 "✓ Low Gamma", <0.080 "~ Moderate", <0.150 "⚠ Elevated", else "✗ High Gamma".

---

## 14. Vega

**Raw value** — `acquisition.ts:1522–1531`: same short=negative/long=positive convention as gamma. **Broker-reported.**

**Display** — `fmtVegaDisplay()`, `page.tsx:6832–6836`: signed, 2 decimals, no dollar scaling.

**Label thresholds (on |vega|):** ≤0.30 "✓ Low Vol Risk", ≤0.75 "~ Moderate Vol", ≤1.50 "⚠ Elevated Vol", else "✗ High Vol Risk". NKE's −0.10 and MU's −0.11 both clear the "Low Vol Risk" bucket.

---

## 15. IV & IVR

**Source** — `acquisition.ts:930–951`, from TastyTrade's `/market-metrics` endpoint. **Broker-reported.**

**Normalization assumption:** the raw broker value is treated as a *fraction* (multiply by 100) if it's less than 1, otherwise treated as an already-whole-number percent. This is a heuristic to handle TastyTrade returning IV either way depending on endpoint/field — it could misfire for a genuinely tiny IV (e.g., <1%) by inflating it 100×, though that's an edge case unlikely to occur on liquid single names.

**Label thresholds (IVR):** <20 "✗ Poor Premium", <40 "~ Fair Premium", ≤70 "✓ Good Premium", else "★ Excellent Premium". Matches MU's IVR 65 → "Good Premium" and NKE's IVR 40 → boundary case landing in "Good Premium" (≤70).

**IV color** compares IV to `hv30` (30-day historical vol, also broker-reported) — spread ≥10 green, ≥0 yellow, else red — no fallback/synthetic HV if `hv30` is missing.

---

## 16. GTC

**Calculation** — `acquisition.ts:1451–1462`: checks whether a broker GTC limit order exists that is Buy-to-Close on this position's short leg, via `findProfitGtcOrder()` (`acquisition.ts:534–547`) — **not** a stop order, specifically a profit-target limit order. Includes a hardcoded index/weekly-symbol variant map (SPX↔SPXW, NDX↔NDXP, RUT↔RUTW, VIX↔VIXW) since TastyTrade's weekly-option root symbols differ from the underlying's own symbol.

MU shows "✓ Live" (a working GTC exists); NKE shows "✕ None."

---

## 17. Stop Loss

This is the canonical model from TE-0002 (already reviewed/merged). Classification — `classifyStopLossPolicy()`, `lib/portfolio/stopLossPolicy.ts:201–255`:

```
reference = creditPerContract × 2          // default entry rule: 2× credit
if no recorded/matched TradeEdge policy:
    materially tight (< 90% of reference)?  → TOO_TIGHT
    else                                     → UNKNOWN_PROVENANCE
if a matched, recorded policy exists (ORIGINAL_CREDIT basis):
    < 90% of reference → TOO_TIGHT
    > 110% of reference → TOO_LOOSE
    else → ALIGNED
```

**MU's card:** "⚠ Too tight $3.15" with "Basis unknown — broker order not created by TradeEdge" — this means MU's working stop was **not placed by TradeEdge** (no matching recorded policy, or the recorded policy's broker-order-id didn't match — see TE-0002's identity-matching fix), so the app applies only the materiality sanity check against the 2×-credit default and flags it tight. **NKE's card:** "✕ None" — no working stop order at the broker at all.

**Assumption baked into the "Too tight $3.15" label:** the $3.15 trigger price shown is the raw broker order price — not derived — but the *classification* ("Too tight") is only a heuristic sanity check when provenance is unknown; it does not know MU's stop was actually intentionally set, so it can't rule out the trader deliberately chose a tighter stop for a legitimate reason.

---

## 18. Suggested (recommendation badge)

**Rule engine** — `getRecommendation()`, `lib/portfolio-data/acquisition.ts:1578–1661`. This is a fully deterministic if/else rule tree, **not** AI/ML — the separate "Analyze with AI" button on each card is a distinct, optional LLM-based override, not what populates this badge by default.

Evaluation order (abbreviated):
1. Needs-close (DTE-based) checks first.
2. Acquisition-intent CSPs (buy-the-stock intent) get their own branch — this is why NKE's badge is "● Hold 38% paper" instead of a profit/loss-driven action: `${pnlPct}% paper — acquisition intent, hold for assignment or expiry`.
3. Short strike breach or a **confirmed** stop-loss breach (via `evaluateStopBreach()`, the TE-0002 breach state machine) → Cut Losses.
4. A stop breach that's detected but not yet confirmed (`VERIFY_STOP`/`PENDING_CONFIRMATION`) → Manage, with the exact detail text `Verify stop — ${explanation}` — this is MU's "⚡ Manage Verify sto…" badge, driven directly by the unconfirmed/unverified stop state (consistent with its "Too tight $3.15 / Basis unknown" stop card above).
5. Large loss (≥200%/150% pnl-based thresholds) combined with an adverse technical trend → Cut Losses/Manage.
6. Short-dated-entry branch (≤21 DTE at entry — NKE qualifies) has its own profit-take thresholds (30% if ≤7 DTE, 40% otherwise) and its own "place GTC immediately if none exists" rule.
7. Standard-entry branch: target-based take-profit, loss-based cut/manage thresholds, trend-aligned hold.

**Hardcoded thresholds throughout:** 21-DTE management line, ±200%/150%/100%/50% loss bands, 30%/40% short-dated profit-take bands, 2% "critical buffer," 3/7-day DTE cutoffs for short-dated positions.

**External dependency:** the trend signal (`trendAgainst`/`trendAligns`) comes from an async `getTrend()` call per card and can be `null` on first render — trend-gated branches simply don't fire until it resolves, so the badge can visibly change shortly after page load without any underlying position data changing.

---

## 19. Legs (expanded card)

**What it is:** the raw per-leg breakdown shown when a card is expanded — direction, quantity, strike, option type, average open price, current price.

**Render** — `app/portfolio/page.tsx:8328–8338`:
```tsx
{pos.legs.map(leg => (
  <>
    {leg.direction}
    {leg.quantity}x {leg.strikePrice} {leg.optionType === 'P' ? 'Put' : 'Call'}
    Avg open: ${leg.avgOpenPrice.toFixed(2)}
    {leg.currentPrice != null && <>Current: ${leg.currentPrice.toFixed(2)}</>}
  </>
))}
```

**Source** — `lib/portfolio-data/acquisition.ts:1285–1286`:
```ts
avgOpenPrice: parseFloat(l['average-open-price'] ?? '0'),   // broker-reported, per-share
currentPrice: currentPrices[symbol] ?? null,                 // same mid (bid+ask)/2-or-mark map Buyback(mid) uses
```
Both are **broker-reported/live-computed**, not modeled — `avgOpenPrice` is exactly the same field Credit (item 6) is built from, and `currentPrice` is exactly the same `currentPrices` map Buyback (mid) (item 5) is built from.

**✓ verified against screenshot** — MU's legs tie out exactly to two other metrics on the card:
- Credit: short 5×$40.01 − long 5×$37.49 = $200.05 − $187.45 = $12.60/share × 100 = **$1,260.00** (matches Credit $1,260.00).
- Buyback (mid): short 5×$45.60 − long 5×$42.10 = $228.00 − $210.50 = $17.50/share × 100 = **$1,750.00** (matches Buyback (mid) $1,750.00).

**Note:** the Legs panel shows `currentPrice` (mid), not the marketable ask/bid price used for "Close now (marketable)" ($5,575.00) — there is no per-leg marketable price shown anywhere on the expanded card, only the aggregate.

---

## 20. What Moved (expanded card)

**What it is:** a day-over-day narrative — up to 9 possible bullet lines (Stock, P/L, Net Edge, IV, IVR, Delta, Theta, Gamma, Vega, POP, Buffer), each only appearing if it moved past a hardcoded noise threshold since the prior tracked day.

**This uses a different baseline than the Trade Evolution block (item 10).** Trade Evolution compares live values against the **entry snapshot** (captured once, first time TradeEdge saw the position — potentially weeks/months ago). What Moved compares live values against **yesterday's snapshot only** (`priorSnapshotValue()`, `page.tsx:7060–7068`, and the dedicated `netEdgePrior()`/`ivPrior()`/`ivrPrior()` helpers, `page.tsx:6964–7035`) — all filtered to `snapshot.date < todayLocalDateString()`, i.e. the most recent snapshot strictly before today. These are two genuinely different comparison windows on the same card and can tell different stories (e.g. IV flat day-over-day but way up since entry).

**Assumption:** "today" is the browser's **local** calendar date (`todayLocalDateString()`, `page.tsx:258–264`), not exchange time or UTC. Depending on when the daily snapshot job actually ran relative to local midnight, "since yesterday" could span anywhere from a few hours to nearly 48 hours of real elapsed time.

Per-line formula and hardcoded noise threshold (all in `buildMovementSummary()`, `page.tsx:7085–7244`):

| Line | Formula | Suppressed if | Tone |
|---|---|---|---|
| Stock | `current − priorSnapshot(stockPrice)` | \|diff\| < $0.01 | neutral |
| P/L | `(pos.pnl ?? pos.plOpen) − priorSnapshot(pnl)` | \|diff\| < $1 | good if ↑, bad if ↓ |
| Net Edge | `netEdgeLive − netEdgePrior` (same model as item 11) | \|diff\| < $1 | good if ↑, bad if ↓ |
| IV | `iv − ivPrior` | \|diff\| < 0.5pt | **bad if ↑** (expansion raises buyback cost on short premium), good if ↓ |
| IVR | `ivr − ivrPrior` | \|diff\| < 1pt | neutral (informational only) |
| Delta | `netDelta − priorSnapshot(netDelta)` | \|diff\| < 0.02 | neutral (directional drift, not inherently good/bad) |
| Theta | `theta − priorSnapshot(theta)` | \|diff\| < 0.01 | good if ↑, bad if ↓ |
| Gamma | `\|gamma\| − \|priorSnapshot(gamma)\|` | \|diff\| < 0.005 | **bad if ↑** (bigger P/L swings per $1 move), good if ↓ |
| Vega | `\|netVega\| − \|priorSnapshot(netVega)\|` | \|diff\| < 0.01 | **bad if ↑** (more IV sensitivity), good if ↓ |
| POP | `getCurrentPop(pos) − priorSnapshot(pop)` | \|diff\| < 1pt | good if ↑, bad if ↓ |
| Buffer (OTM cushion) | `buffer − priorSnapshot(buffer)` | \|diff\| < 0.3pt | good if ↑ (wider), bad if ↓ (tighter) |

If literally nothing clears its threshold, a single "Stable — No material moves since yesterday's snapshot" line shows instead. If the position has **no snapshot history at all** yet, the panel shows "Tracking — First day tracked" instead of attempting any comparison.

**✓ verified against screenshot** — MU's 8 bullets all check out against the thresholds/formulas above:
- Stock ▼$42.99 (−4.7%) — clears the $0.01 threshold, neutral tone (price direction alone isn't judged good/bad for a short-premium position).
- P/L fell $113 — bad tone (declining P/L).
- Net Edge down $4/d, "gamma eating more of theta" — bad tone, and note the detail text is itself hardcoded copy tied to the sign of the diff, not a separate calculation.
- IVR down 2pt (67→65) — **neutral** tone even though it's a decline, consistent with the code treating IVR purely as an informational richness signal, not a verdict on this specific trade.
- Theta "decreased to $12/d" — bad tone (less decay collected day-over-day), separate from the main Theta box's own "Strong Decay" label (item 12), which judges the *absolute* level, not the day-over-day trend — worth noting these two adjacent-looking signals can point in different directions simultaneously (decay is still historically "strong" in absolute terms even on a day it decreased).
- Vega "shrank" — good tone (less IV sensitivity).
- POP down 9pt (77→69%) — bad tone.
- Buffer "tightened to 8.7%" — bad tone (matches the OTM % metric, item 2, at its live value).
- **IV, Delta, and Gamma bullets are absent** — not because they didn't change, but because their day-over-day deltas didn't clear the 0.5pt/0.02/0.005 thresholds respectively (Trade Evolution's IV row shows 66→66% unchanged day-over-day, consistent with no IV bullet appearing here).

---

## Summary: what's broker-reported vs. modeled

**Straight from the broker, no modeling:** Stock price, all four raw per-share Greeks (theta/gamma/delta/vega), IV, IVR, HV30, credit received (from average-open-price), the stop-loss trigger price, GTC/stop order presence.

**Live-computed from broker inputs, not itself an estimate:** OTM %, Cash Req, Max Risk, Buyback (mid & marketable), Emergency Close P/L, P/L Open, strikes/effective-buy display.

**Genuine models/estimates (flagged or not in the UI):**
- **POP** (`calcPositionPop`, `acquisition.ts:1167–1244`) — a lognormal/Black-Scholes-style breakeven probability using a polynomial (Abramowitz-Stegun) approximation of the normal CDF; assumes IV is constant to expiration and price is lognormally distributed.
- **Net Edge** — explicitly marked `~est`; assumes 252 trading days/year and uses the position's own IV as its only volatility input.
- **50% Target projection** — a √time value-decay heuristic, explicitly gated off when buffer < 3%.
- **Max Risk's naked-short fallback** — deliberately conservative, not a real margin/buying-power number.
- **Cash Req** — assumes a fully cash-secured put; does not read actual account margin type.

**Worth double-checking if these numbers ever look surprising:** the Eff Buy/Strike fallback that would substitute whole-position `creditReceived` for a per-share premium if `average-open-price` is missing (item 3); the OTM % / buffer metric's use of only the *first* short leg on multi-short-leg strategies like iron condors (item 2); the IV/IVR "<1 means fraction" normalization heuristic (item 15); and the fact that Trade Evolution (item 10) and What Moved (item 20) use two genuinely different comparison baselines — entry-snapshot vs. yesterday's-snapshot — so they can legitimately disagree about direction on the same metric on the same card.

**Legs and What Moved (items 19–20) confirm the collapsed-card numbers are internally consistent** — MU's raw leg prices reproduce both its Credit and Buyback (mid) exactly, and every "What Moved" bullet that appeared (and every one that didn't) is explained by a specific hardcoded noise threshold, not a bug.
