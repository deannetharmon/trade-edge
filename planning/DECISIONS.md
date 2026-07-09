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

---

## 2026-07-02 — Framework Before Execution

**Decision:**  
Autopilot must have configuration, persistence, audit logging, scoring utilities, run locking, telemetry, and dry-run routes before any paper execution code is introduced.

**Reason:**  
Autonomous trading systems fail when execution is built before observability and controls. The framework must prove it can log, lock, and explain before it acts.

**Alternatives considered:**

- Build paper entries immediately after config — rejected.
- Build UI first and wire logic later — rejected.

**Impact:**  
Sprints 1A and 1B are intentionally non-trading. This creates a stable foundation for the Decision Engine.

---

## 2026-07-02 — Decision Engine Before Paper Execution

**Decision:**  
Sprint 2 is now the Decision Engine, not paper execution. Autopilot must produce ranked recommendations with full acceptance/rejection reasoning before it can create paper trades.

**Reason:**  
Thinking and acting need separate validation points. Debugging scoring, risk gates, and execution at the same time would make the system harder to verify.

**Alternatives considered:**

- Combine candidate ranking and paper execution in one sprint — rejected.

**Impact:**  
No paper trade creation until after the Decision Engine is validated.

---

## 2026-07-02 — Vercel Is the Build Pipeline

**Decision:**  
Vercel build success is the primary build gate because the local development environment lacks npm access.

**Reason:**  
The developer environment is constrained by corporate tooling. Vercel provides the reliable source of truth for Next.js compilation and TypeScript validation.

**Alternatives considered:**

- Require local `npm run build` — rejected as impractical in current environment.
- Delay development until local Node/npm is available — rejected.

**Impact:**  
Each sprint is pushed to GitHub and validated by Vercel. Runtime endpoint smoke tests are deferred when preview access is blocked.

---

## 2026-07-02 — Dry-Run-First Manual and Cron Routes

**Decision:**  
Manual and cron endpoints initially run only a framework dry run: acquire a Redis lock, write telemetry, write a no-action decision log, update `lastRunAt`, and exit.

**Reason:**  
This validates scheduling, locking, telemetry, and auditability without enabling candidate scanning or trade execution.

**Alternatives considered:**

- Manual button creates paper trades immediately — rejected.
- Cron remains absent until late build — rejected.

**Impact:**  
The automation shell exists early, but cannot trade.

---

## 2026-07-02 — Scoring Frameworks Are Approved but Not Yet Final Calibration

**Decision:**  
Decision Confidence, Opportunity Score, and Net Edge are implemented as framework utilities in Sprint 1B. Full calibration and risk-gate integration occurs in Sprint 2.

**Reason:**  
The formulas need to exist before the Decision Engine can orchestrate them, but they should not be treated as production-calibrated until candidate/rejection behavior is validated.

**Impact:**  
Sprint 2 will integrate these utilities into explainable ranked recommendations.
