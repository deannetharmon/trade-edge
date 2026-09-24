# Technical Specification: PMCC Scoring Engine

## Overview & Objective
Replace the legacy, yield-focused PMCC ranking model with an institutional-grade, multi-dimensional risk-adjusted scoring engine. The primary goal is prioritizing capital preservation and structural safety. All logic must reside in a dedicated module: `lib/scans/pmccScore.ts`.

## The 4-Pillar Composite Scoring Framework (0–100 Scale)
1. **Structural Safety & WMD Cushion (35% Weight):**
   - **WMD Cushion:** Width minus total net debit paid.
   - **Hard Gate:** Automatically disqualify or penalize setups where the WMD cushion is below 3%.
   - **LEAPS Long Leg:** Enforce a strict delta range between **0.78 and 0.88** with a DTE of **270 to 400 days**.
2. **Yield Quality & ROI Capping (25% Weight):**
   - Cap Annualized ROI rewards at **60%** to prevent algorithmic skew distortion.
3. **Volatility & Event Risk (20% Weight):**
   - Evaluate IV rank for favorable LEAPS entry and filter for binary earnings events. Short call delta: **0.20 to 0.30** (21–45 DTE).
4. **Technical & Liquidity Health (20% Weight):**
   - Incorporate RSI momentum filters to avoid overbought equities. Enforce minimum open interest and tight bid-ask spreads.

## Developer Deliverables
- Implement `lib/scans/pmccScore.ts` encapsulating the composite weighting.
- Update the UI dashboard scan results to sort descending by `compositeScore`.
- Verify regression tests successfully suppress thin-buffer, high-yield anomalies.
