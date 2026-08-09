# WA-0006 — Dane Consolidated Implementation Prompt

**Status:** APPROVED AND FROZEN  
**Approval:** Dean approved on August 9, 2026  
**Product owner:** Paul  
**Facilitator:** Frank  
**Implementer:** Dane  
**Authoritative source:** `WA-0006-Canonical-Recommendation-Contract-Foundation-Approval-Specification.docx`

## Assignment

Dane, implement **WA-0006 — Canonical Recommendation Contract Foundation** in the active TradeEdge working tree, then apply that foundation to the already-frozen WA-0005 work and restore WA-0005 to an acceptance-ready state.

This prompt and the approved WA-0006 specification are one consolidated implementation assignment. The specification is authoritative. Do not reopen, reinterpret, or extend the product decisions below. If the repository reveals a product-level conflict not resolved here, stop and report it rather than inventing a rule.

## Required outcome

Establish one authoritative Decision Engine/domain owner for recommendation financial meaning across:

- BPS — Bull Put Spread
- BCS — Bear Call Spread
- IC — Iron Condor
- CSP — Cash-Secured Put
- PMCC — Poor Man's Covered Call

Every downstream layer may transport, persist, validate presence, filter, sort, and display canonical values. No API adapter, compact transport, persistence adapter, UI component, presentation helper, or other downstream consumer may reconstruct or reinterpret:

- strategy identity;
- `capitalRequired`;
- `theoreticalMaxLoss`;
- position quantity or multiplier application;
- candidate identity; or
- `sourceResultId`.

WA-0006 is not complete when its isolated tests pass. It is complete only after the foundation is integrated into WA-0005 and WA-0005 is restored to acceptance-ready status with updated evidence.

## Frozen product decisions

1. The Decision Engine/domain layer is the sole calculation owner. There are no downstream fallback formulas.
2. BPS, BCS, IC, CSP, and PMCC are first-class canonical recommendation strategies. Preserve existing identifiers; add PMCC explicitly.
3. `capitalRequired` and `theoreticalMaxLoss` are non-negative currency amounts for the complete position, not per-share values.
4. Apply contract multiplier and quantity exactly once in the authoritative calculation.
5. Fees, commissions, taxes, exchange fees, slippage, and margin interest are excluded from the canonical values. If supported, expose them separately and label them clearly.
6. Values are rounded only at the established currency boundary, never during intermediate leg arithmetic.
7. Invalid, incomplete, stale, contradictory, unsupported, or unmappable candidates are rejected with an observable stable reason. Never manufacture a recommendation or clamp an invalid result to zero.
8. Existing BPS, BCS, IC, and CSP behavior must remain compatible except for the explicitly approved Iron Condor correction. Any non-additive contract change requires an explicit versioned migration or compatibility adapter.

## Normative financial definitions

Use positive quoted price magnitudes. Let `M` be the contract multiplier, normally 100, and `Q` be the position quantity.

### Bull Put Spread (BPS)

- `capitalRequired = (putWidth - netCredit) * M * Q`
- `theoreticalMaxLoss = capitalRequired`
- Require long put strike below short put strike.
- Require net credit at least zero and less than put width.

### Bear Call Spread (BCS)

- `capitalRequired = (callWidth - netCredit) * M * Q`
- `theoreticalMaxLoss = capitalRequired`
- Require short call strike below long call strike.
- Require net credit at least zero and less than call width.

### Iron Condor (IC)

- `capitalRequired = (max(putWidth, callWidth) - totalNetCredit) * M * Q`
- `theoreticalMaxLoss = capitalRequired`
- Require the correctly ordered four-leg structure.
- Require both wing widths greater than zero.
- Require total net credit at least zero and less than the larger wing width.
- Asymmetric wings are valid. Risk is based on the larger wing, not an assumed equal width and not a sum of both wing risks.

### Cash-Secured Put (CSP)

- `capitalRequired = (shortPutStrike - netCreditPerShare) * M * Q`
- `theoreticalMaxLoss = capitalRequired`
- Require one short put, strike greater than zero, and credit at least zero but less than strike.
- This is the cash-secured obligation, not a broker-specific margin estimate.

### Poor Man's Covered Call (PMCC)

- `capitalRequired = netDebitPerShare * M * Q`
- `theoreticalMaxLoss = capitalRequired`
- Require a long-dated long call and a nearer-dated short call on the same underlying.
- Require the long-call expiration to be after the short-call expiration.
- Require positive net debit, valid leg ordering, and a valid quantity relationship.
- Do not credit salvage value, assignment outcomes, or discretionary adjustments.

### Invalid result behavior

- Reject negative calculated risk or capital.
- Accept zero only if an already-existing explicit domain rule permits it; otherwise reject it.
- Never clamp a negative or invalid value to zero.

## Canonical recommendation contract

Preserve existing type names where sensible, but ensure the authoritative domain contract carries equivalent meaning for every supported strategy:

- closed/versioned strategy identifier;
- required stable `sourceResultId`;
- required position-level `capitalRequired`;
- required position-level `theoreticalMaxLoss`;
- explicit or deterministic quantity and contract multiplier;
- normalized strategy-appropriate legs sufficient for structural validation and traceability;
- net-credit or net-debit pricing basis plus market-data timestamp/context required by the existing freshness policy;
- formula or contract-version provenance sufficient to identify the canonical rules used; and
- machine-readable rejection reason plus concise diagnostic detail, distinct from an eligible recommendation with a poor rank.

## Identity and mapping requirements

- Create `sourceResultId` at candidate/result origin and preserve it unchanged through adapters, ranking, persistence, API serialization, compact transport, and UI expansion.
- Map by stable identity only. Do not use collection order, array position, display ID, label, fuzzy matching, or guessed symbol/strike combinations.
- Do not mint a replacement `sourceResultId` downstream.
- If the originating result is unavailable, a persisted recommendation may be displayed only when its canonical financial fields and provenance remain complete and compatible. Mark it detached/stale under existing lifecycle behavior and do not freshly rerank it as though it had been remapped.
- Reject absent, duplicate, contradictory, or unresolvable identity whenever live provenance is required.

## Rejection behavior

Reuse existing error-enum names when they are semantically equivalent. Do not create a parallel vocabulary merely to match these labels.

- Unsupported strategy: `UNSUPPORTED_STRATEGY`
- Missing or invalid leg structure: `INVALID_LEG_STRUCTURE`
- Missing or non-finite price: `INVALID_PRICING`
- Source input beyond the existing freshness policy: `STALE_SOURCE_RESULT`
- Missing or unmappable identity: `SOURCE_RESULT_UNAVAILABLE`
- Duplicate or ambiguous identity: `SOURCE_RESULT_AMBIGUOUS`
- Invalid quantity or multiplier: `INVALID_POSITION_SIZE`
- Negative, non-permitted-zero, or impossible canonical result: `INVALID_FINANCIAL_RESULT`
- Unsupported persisted contract version: reject or migrate explicitly as `CONTRACT_VERSION_UNSUPPORTED`

## Backward compatibility

Before changing shared types, inventory all existing producers and consumers, including:

- Decision Engine/domain calculations;
- Screener candidate producers and adapters;
- recommendation API;
- compact transport;
- persistence and hydration;
- ranking/filtering paths;
- presentation consumers; and
- tests and fixtures.

Make PMCC additive wherever possible. Preserve serialized strategy identifiers and field meaning for BPS, BCS, IC, and CSP.

If the required change cannot be additive:

1. Implement a versioned migration or compatibility adapter.
2. Add deterministic compatibility tests.
3. Do not silently reinterpret stored values.

Historical records without sufficient canonical data may remain readable, but they may not become newly eligible or rankable without a successful migration or authoritative recalculation from valid source data.

## Included scope

- Add PMCC to the canonical strategy/type system and eligible recommendation pipeline.
- Centralize authoritative `capitalRequired` and `theoreticalMaxLoss` calculations for all five strategies.
- Correct asymmetric Iron Condor maximum-loss handling.
- Strengthen `sourceResultId` creation, propagation, mapping, and failure behavior.
- Add strategy-specific structural and financial validation.
- Preserve or explicitly migrate API, persistence, and compact-transport compatibility.
- Apply the foundation to WA-0005 and restore WA-0005 to acceptance-ready status.

## Explicit exclusions

Do not add or redesign:

- portfolio scores, concentration limits, exposure-equivalent ownership, or Portfolio Fit;
- LEAPS recommendation/ranking beyond PMCC structure required here;
- fundamental analysis or the Approved Ownership Universe;
- cross-strategy ranking;
- Covered Call Screener production or recommendation transport;
- unrelated UI work, cleanup, refactoring, dependencies, or infrastructure; or
- broker-specific margin models.

Canonical CSP remains cash-secured. Canonical PMCC remains debit-funded.

## Minimum deterministic test matrix

Add or update tests at the authoritative calculation boundary and at each affected integration boundary.

### BPS

- Representative credit spread
- Quantity greater than one
- Credit approaching spread width
- Invalid strike order
- Credit equal to or greater than spread width

### BCS

- Representative credit spread
- Nonstandard multiplier, if supported
- Invalid strike order
- Negative or missing credit

### IC

- Equal wings
- Put wing wider
- Call wing wider
- Quantity greater than one
- Credit approaching the larger wing width
- Malformed leg ordering

### CSP

- Representative contract
- Quantity greater than one
- Zero credit only if an existing rule permits it
- Credit equal to or greater than strike
- Invalid strike or quantity

### PMCC

- Representative debit diagonal
- Quantity greater than one
- Long expiration not after short expiration
- Missing leg
- Zero or negative debit
- Mismatched underlying
- Invalid quantity relationship

### Identity

- Stable propagation across every affected adapter and transport
- Unavailable source
- Duplicate ID
- No array-position or fuzzy fallback
- Persisted detached-result behavior

### Compatibility

- Existing BPS/BCS/IC/CSP fixtures
- Existing API and compact-transport shapes
- Persisted old-version records
- Explicit migration behavior where required

### WA-0005 integration

- Valid PMCC candidate flows through the canonical pipeline
- Invalid PMCC candidate is rejected with an observable reason
- Existing strategies remain functional
- Corrected IC risk is used
- WA-0005's existing frozen acceptance criteria remain intact

## WA-0005 reintegration

WA-0006 does not replace or rescope WA-0005.

After implementing the foundation:

1. Rebase, merge, or apply the foundation to the current WA-0005 work using the repository's appropriate existing workflow.
2. Resolve only conflicts caused by this canonical foundation.
3. Preserve WA-0005's frozen product scope:
   - SR-0001 sorting;
   - open-interest choices `Any`, `>100`, `>250`, `>500`, and `>1000`;
   - visible default `>500`;
   - removal of the Targeted DTE grouping; and
   - canonical PMCC expansion.
4. Keep Covered Call excluded from Screener recommendation transport until a separately approved canonical CC candidate path exists.
5. Rerun WA-0005 acceptance validation.
6. Produce an updated WA-0005 review package and evidence.

## Mandatory stop conditions

Stop and report without implementing an invented rule if any of the following occurs:

- Existing code uses a materially different definition of `capitalRequired` or `theoreticalMaxLoss` that changes visible financial meaning beyond the approved IC correction and PMCC addition.
- The PMCC candidate lacks authoritative inputs needed to validate both legs or compute net debit without downstream reconstruction.
- A compatibility change would invalidate or silently reinterpret persisted recommendations.
- Stable `sourceResultId` cannot be propagated without choosing a new product-level identity policy.
- WA-0005 reintegration requires work in an explicitly excluded product area.
- Any financial definition, strategy meaning, persisted-data migration policy, source-identity rule, or scope conflict remains unresolved by this assignment.

If stopped, provide:

1. The exact blocker and affected files/types.
2. Existing behavior with a concrete example.
3. Why the approved contract cannot be implemented without a new product decision.
4. The smallest set of decision options, with consequences.
5. Confirmation that no unauthorized interpretation was committed.

## Execution efficiency and repository discipline

- Work only in the active TradeEdge working tree and approved branch context.
- Begin with `git status`, current branch, and a concise inspection of the relevant types, calculators, adapters, transports, persistence, and tests.
- Preserve unrelated user changes in a dirty worktree.
- Make the smallest coherent implementation that creates one authoritative calculation owner.
- Do not perform `node_modules` health checks.
- Do not reinstall dependencies.
- Do not create disposable or secondary environments.
- Do not run redundant validation.
- Use targeted tests during development.
- At completion, run exactly one full test suite, one TypeScript check, and one production build.
- If any command runs longer than five minutes, stop that command and report its last output. Do not investigate or rebuild the environment.
- Do not weaken, delete, skip, or rewrite unrelated tests to obtain green status.
- Do not perform unrelated refactors or cleanup.

## Required final report

Return one concise, evidence-backed implementation report containing:

1. **Outcome:** completed or stopped on an approved stop condition.
2. **Change inventory:** authoritative owner, contracts/types, strategy calculations, validation, identity/mapping, compatibility/migration, and WA-0005 reintegration.
3. **Financial confirmation:** formulas actually implemented for all five strategies and confirmation that quantity/multiplier are applied exactly once.
4. **Identity confirmation:** where `sourceResultId` originates and every layer through which it remains stable.
5. **Validation evidence:** targeted tests, one full test result, one TypeScript result, and one production build result, including command names and pass/fail summaries.
6. **WA-0005 status:** evidence that it is acceptance-ready, or the exact remaining approved stop condition.
7. **Changed files:** concise list with purpose.
8. **Scope confirmation:** no excluded work was added and no unrelated user changes were modified.
9. **Commit and push:** commit hash, branch, and push result.

## Completion criteria

Do not declare completion unless all of the following are true:

- All five supported strategies use one authoritative, strategy-specific calculation owner with no generic financial fallback.
- PMCC is first-class and valid PMCC candidates flow through the canonical pipeline.
- Asymmetric Iron Condors calculate risk from the larger wing.
- Invalid, incomplete, stale, or unmappable candidates are rejected with stable observable reasons.
- `sourceResultId` remains stable through every relevant layer with no positional or fuzzy reconstruction.
- Existing consumers remain compatible or a reviewed explicit migration exists.
- Required unit, boundary, compatibility, identity, and WA-0005 integration tests pass.
- One full test suite, one TypeScript check, and one production build pass, subject to the five-minute stop rule.
- WA-0005 is acceptance-ready with updated review evidence.
- The change is committed and pushed.

## Git completion commands

Use the actual approved branch name and verify the staged scope before committing. Do not blindly add unrelated files.

```bash
git status --short
git diff --check
git diff --cached --stat
git commit -m "feat(recommendations): establish canonical strategy contracts"
git push -u origin "$(git branch --show-current)"
```

Before `git commit`, stage only the intentional WA-0006 and WA-0005 reintegration files with explicit `git add <path>` commands. Report the exact staged paths, resulting commit hash, and push result.

## Authorization

Dean has approved and frozen WA-0006. Implementation is authorized within this exact boundary. New discoveries are captured for later reprioritization and do not alter the active sprint.
