# PMCC-0001 — LEAP Call-Income Readiness and History

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Design review:** Diane  
**Data/identity review:** Quinn  
**Status:** Draft — design mockup and team review required before implementation

## Problem

A trader who owns a long LEAPS call cannot easily tell whether it is structurally usable for reviewing a short call, whether an existing short call already occupies that capacity, or how prior short-call cycles performed against that exact LEAP. Existing PMCC scanning can identify an eligible pair, but the Portfolio experience does not provide a simple starting point from the held LEAP through candidate review and durable history.

## User value

From a LEAP the trader already owns, TradeEdge provides one understandable path: confirm whether the LEAP can be reviewed for call income, review short-call candidates tied to that exact contract, then manage and audit every resulting short-call cycle without merging its economics into the LEAP’s P/L.

## Product decisions

1. The first card is named **Earn Income on This LEAP**. “PMCC” may appear as technical detail, but it is not the primary user-facing entry point.
2. The card states readiness for **review**, never an automatic instruction to sell a call.
3. Existing PMCC candidate discovery/review is reused after the trader selects a specific held LEAP; it must receive the exact long-call identity rather than matching on ticker or strike approximation.
4. A traditional share-backed covered call and a long-LEAP call-income position remain distinct. A LEAP flow must be labeled **Sell Call Against LEAP (PMCC)**.
5. Short-call cycle economics and LEAP economics remain separate. History may show their relationship and running net short-call income, but it must not fabricate a combined realized P/L.
6. Broker-confirmed order/fill identity is required for historical records. Submitted, working, canceled, and failed records remain lifecycle records and do not become realized performance.

## Scope

### 1. Existing LEAP readiness card

In Portfolio → Existing Positions Income, show one card only for a held, plausible long-call candidate. The card contains:

- underlying, exact long-call contract, quantity, expiration, and current DTE;
- status: `Ready to review calls`, `Review needed`, `Cannot review calls`, or `Data needs refresh`;
- whether a short call is open or working against that LEAP;
- one primary action:
  - `Review short-call candidates` when no short call occupies the LEAP;
  - `Manage short call` when an attributable short call is open or working;
  - no order action when broker evidence is unavailable or structural coverage fails;
- an accessible **Why?** disclosure containing factual evidence and unavailable reasons.

The compact card must not lead with break-even, delta, policy thresholds, or a wall of metrics.

### 2. Readiness evidence

Readiness must use and disclose the following evidence when available:

| Category | Required behavior |
|---|---|
| Exact held LEAP | One unambiguous, broker-identified long call in the active account; never inferred by ticker alone |
| Structural coverage | Long expiration is later than any proposed short-call expiration; long strike is below the proposed short-call strike; quantity coverage is valid |
| Capacity | Existing and working attributable short calls prevent a second opening review |
| Freshness | Current attributable broker position and quote evidence are required; otherwise show `Data needs refresh` |
| LEAP context | expiration/DTE, long strike, current underlying price, current ITM/OTM state, current quote/value, and break-even only when honestly available |
| Candidate context | proposed short strike/expiration, credit, quote quality, upside cap, and supported earnings/ex-dividend evidence |

No universal DTE, delta, moneyness, IVR, or credit threshold is authorized by this ticket. Ian must approve any policy threshold separately. Missing evidence remains `Unavailable` and cannot become a pass.

### 3. Handoff to PMCC candidate review

`Review short-call candidates` opens the existing PMCC review with the selected held LEAP prefilled and locked to its exact broker contract identity. The review may scan/select a short call but must:

- clearly display the held LEAP and proposed short call together;
- show that upside above the proposed short strike is capped while that short call remains open;
- preserve existing execution validation and broker order-review controls;
- not submit an order automatically;
- block or explain unavailable review when exact identity, coverage, capacity, or fresh broker data is absent.

### 4. Post-entry management

After a short call is opened against a LEAP, the original card changes to `Manage short call`. It shows the active short call’s strike, expiration, DTE, opening credit, and broker-observed status, plus event/assignment watch when supported. It must not offer another short call against the same allocated LEAP quantity.

### 5. PMCC History

Create or extend PMCC History with records linked to the exact LEAP and the exact short-call cycle:

- short call opened: broker order/fill ID, quantity, strike, expiration, opening credit, timestamp;
- status/outcome: working, canceled, expired, bought back, assigned, rolled, failed, or filled;
- actual short-call realized P/L only when broker execution evidence supports it;
- roll linkage between the replaced and replacement short calls;
- running net short-call income for the LEAP;
- LEAP P/L displayed separately from short-call income.

History must reuse TRADELOG-0002 lifecycle records where applicable. A canceled or working short call appears as lifecycle history only and is excluded from realized P/L and Performance.

## Non-goals

- Automatically recommending, placing, or rolling a short call.
- Reclassifying every long call as a PMCC candidate.
- Changing PMCC scan policy or inventing thresholds.
- Combining LEAP and short-call P/L into a synthetic realized figure.
- Treating assignment, exercise, or a position disappearance as a completed economic outcome without broker transaction evidence.

## Acceptance criteria

### Clear entry point

**Given** a held LEAP with current attributable broker evidence and no occupied short-call capacity,  
**when** the trader views Existing Positions Income,  
**then** they see one `Earn Income on This LEAP` card and can open a prefilled short-call candidate review for that exact contract.

### No duplicate short call

**Given** an open or working attributable short call,  
**when** the trader views its LEAP card,  
**then** the primary action is `Manage short call`, not a second call-opening action.

### Honest readiness

**Given** missing, stale, structurally invalid, or account-mismatched evidence,  
**when** the card is displayed,  
**then** it states the applicable non-ready status and reason without a pass or order action.

### Candidate tradeoff

**Given** a proposed short call,  
**when** the trader reviews it against a LEAP,  
**then** the view states the proposed credit, short strike/expiration, quote evidence, and upside cap in plain language before any submission step.

### Lifecycle and history

**Given** a short call opened, canceled, filled, expired, closed, assigned, or rolled against a LEAP,  
**when** broker evidence is available,  
**then** PMCC History records the status/outcome linked to the exact LEAP and short-call cycle, while only actual execution evidence affects realized short-call P/L.

## Validation

- Unit tests for long/short expiration ordering, strike ordering, quantity capacity, active/working short-call exclusion, and missing-data behavior.
- Integration tests proving a selected held LEAP remains exact through candidate review and order preparation.
- Lifecycle/history tests for opened, canceled, filled, expired, bought-back, assigned, and rolled short-call cycles.
- Tests proving short-call history does not alter standalone LEAP P/L or overall Performance without actual closed-trade evidence.
- Desktop and narrow-width design review of compact card, Why disclosure, candidate review, and history linkage.

## Approval gates

1. Diane approves the mockup and compact-to-detail interaction.
2. Ian approves readiness language and any later policy ledger; this draft authorizes no numeric thresholds.
3. Quinn approves exact broker identity, capacity, lifecycle, and history linkage.
4. Dane receives an implementation-ready ticket only after these gates close.
