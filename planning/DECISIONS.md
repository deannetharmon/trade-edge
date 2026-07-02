# TradeEdge Autopilot — Architecture Decisions

This document records material architectural decisions for the Autopilot paper-mode build.

## 2026-07-02 — Paper Mode Uses Real Buying-Power Constraints

**Decision:**  
Paper mode uses real buying-power constraints from the connected TastyTrade account, while simulated positions and P&L remain isolated in the paper ledger.

**Reason:**  
The paper engine should learn under the same capital constraints it would face in production without placing live orders.

**Alternatives considered:**

- Hypothetical account only — rejected because it is less realistic.
- Live execution — rejected because v1 is paper-mode only.

**Impact:**  
Improves realism while preserving safety.

---

## 2026-07-02 — Covered Call Shares Are Not Auto-Sold

**Decision:**  
Autopilot never sells covered-call underlying shares outside assignment. Thesis-break logic closes or stops writing the short call and escalates for manual review.

**Reason:**  
A hard price-based stop would be simpler but could force liquidation during normal volatility. The chosen design stops new option risk without selling shares on a potentially noisy signal.

**Alternatives considered:**

- Hard trailing stop on shares — rejected.
- Do nothing on thesis break — rejected.

**Impact:**  
CC management remains investment-oriented and avoids accidental momentum-stop behavior.

---

## 2026-07-02 — Vercel Cron for Paper Mode, Streaming Required Before Live

**Decision:**  
v1 paper mode uses Vercel Cron / scheduled evaluation. A persistent streaming worker is required before live trading is considered.

**Reason:**  
Paper mode primarily validates rules, logs, and state transitions. Live autonomous risk management requires streaming market data and cannot rely on 5–15 minute polling.

**Alternatives considered:**

- Page-load-triggered execution — rejected as not autonomous.
- Always-on worker for paper v1 — deferred as unnecessary infrastructure for paper-only validation.

**Impact:**  
Keeps v1 simpler while preserving the correct architecture requirement for future live mode.

---

## 2026-07-02 — Autopilot Business Logic Lives Outside UI

**Decision:**  
Autopilot trading, scoring, risk, persistence, and management logic belongs under `lib/autopilot/`, not inside React pages/components.

**Reason:**  
This keeps the system testable, reusable, and easier to reason about.

**Alternatives considered:**

- Build logic directly inside `/app/autopilot/page.tsx` — rejected.

**Impact:**  
UI becomes a thin consumer of Autopilot state and actions.

---

## 2026-07-02 — Sprint 1 Split Into 1A and 1B

**Decision:**  
The original Sprint 1 was split into Sprint 1A Core Infrastructure and Sprint 1B Framework.

**Reason:**  
The original sprint was too large to verify cleanly. Splitting it creates a safer checkpoint after persistence, config, and models are established.

**Impact:**  
Improves deployability and reduces the chance of building trading logic on unstable foundations.
