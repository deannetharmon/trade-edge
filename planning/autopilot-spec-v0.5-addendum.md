# Autopilot --- Spec v0.5

> **Status:** Approved for implementation (Paper Mode v1.0)

This version is identical to the approved v0.4 specification, with one
addition:

## 9. Implementation Architecture

### 9.1 Guiding Principles

-   Single Responsibility Principle
-   Strategy isolation
-   Deterministic execution
-   Config-driven behavior
-   Auditability
-   Extensibility

### 9.2 Recommended Project Structure

``` text
lib/
└── autopilot/
    ├── config/
    ├── models/
    ├── scoring/
    ├── risk/
    ├── strategies/
    ├── management/
    ├── engine/
    ├── persistence/
    └── scheduler/
```

### 9.3 Strategy Isolation

Each strategy (BPS, BCS, IC, CSP, CC) owns only its entry validation,
management logic, and calculations. Portfolio decisions are centralized.

### 9.4 Portfolio Decision Engine

Central engine responsibilities:

-   Opportunity Score
-   Decision Confidence
-   Buying-power gates
-   Correlation
-   Concentration
-   Candidate ranking
-   Final execution decisions

### 9.5 Configuration

All thresholds come from `AutopilotConfig`. No hard-coded trading
thresholds are permitted.

### 9.6 Deterministic Execution Order

1.  Load config
2.  Load portfolio state
3.  Load market data
4.  Scan candidates
5.  Calculate Opportunity Score
6.  Calculate Decision Confidence
7.  Apply risk gates
8.  Rank candidates
9.  Execute paper trades
10. Manage existing positions
11. Persist state
12. Write audit log
13. Update telemetry

### 9.7 Audit Trail

Every decision stores:

-   Timestamp
-   Symbol
-   Strategy
-   Opportunity Score
-   Decision Confidence
-   Triggered rules
-   Blocking rules
-   Config version
-   Final action
-   Human-readable explanation

### 9.8 Phased Build Plan

Phase 1 -- Foundation

Phase 2 -- Entry Engine

Phase 3 -- Management Engine

Phase 4 -- Scheduler

Phase 5 -- UI

Phase 6 -- Analytics

------------------------------------------------------------------------

Append this section to the approved v0.4 specification before
implementation begins.
