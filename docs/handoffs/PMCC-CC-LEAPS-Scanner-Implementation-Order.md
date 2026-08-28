# Implementation Order — LEAPS, Covered-Call, and Held-PMCC Scanners

**Issued by:** Ian (trader workflow) and Paul (product scope)  
**Implementer:** Dane  
**Status:** Authorized implementation order  
**Supersedes:** The prior interpretation that a single PMCC Screener flow should discover a new long call and manage an already-held LEAPS position interchangeably.

## Product decision

TradeEdge has three distinct finder actions. They are not substitutes for one another and must remain visible as separate first-class actions.

| Finder | Starting data | Required verification | Output |
|---|---|---|---|
| Find LEAPS | Trader-supplied ticker universe | Long-call candidate qualification | New LEAPS candidates for supplied tickers |
| Find CCs | Current broker portfolio, optionally narrowed by supplied tickers | Long-stock ownership and remaining covered-call capacity | Short-call candidates only for stock the account can cover |
| Find PMCCs | Current broker portfolio, optionally narrowed by supplied tickers | Eligible exact held long-call identity | Short-call candidates only against existing held LEAPS |

The product must never make a trader type a ticker merely to discover a stock or LEAPS that is already in the account. Ticker selection is an optional filter for Find CCs and Find PMCCs; when omitted, each scans all eligible relevant holdings in the active account.

## Dane’s implementation requirements

### 1. Find LEAPS

1. Rename the disabled **Find LEAPS — Coming Soon** control to **Find LEAPS**.
2. Require at least one ticker in the Opportunity Universe.
3. Search new long-call candidates for those tickers using the approved LEAPS qualification configuration.
4. Do not require existing portfolio ownership.
5. Present candidates and exclusions with their underlying, expiration, strike, delta, DTE, liquidity evidence, and freshness.

### 2. Find CCs

1. On invocation, acquire the current canonical active-account portfolio snapshot. Do not duplicate broker acquisition in the browser.
2. Treat selected tickers as an optional filter only. With no selected tickers, evaluate every current long-stock holding.
3. For each stock, calculate capacity exactly as:

   `floor(long shares / 100) - existing short calls - working sell-to-open short calls`

4. Exclude and visibly explain:
   - no long shares;
   - zero remaining contracts / fully covered;
   - unavailable or stale account, position, or working-order evidence;
   - unresolvable short-option attribution.
5. Scan short-call candidates only for holdings with at least one verified available contract.
6. A selected ticker the account does not own must return an explicit **No available shares for a covered call** result, not an empty screen.
7. A qualified candidate may open the existing broker review flow for a `Sell to Open` short call only after rechecking current capacity. It must never create an uncovered order.

### 3. Find PMCCs

1. On invocation, acquire the current canonical active-account portfolio snapshot. Do not use the Opportunity Universe as a prerequisite.
2. Treat selected tickers as an optional filter only. With no selected tickers, inspect every active-account option position.
3. Identify held PMCC bases only when all conditions hold:
   - one unambiguous, single-leg, long call;
   - current attributable broker data;
   - exact active-account identity;
   - exact OCC symbol, underlying, expiration, strike, and quantity.
4. Long puts, short calls, spreads, multi-leg structures, stale data, and unresolved account identity are excluded with explicit reasons.
5. For each eligible held LEAPS, search only short-call candidates. Do not search for or propose another long call.
6. The PMCC modal must remove held-long-call discovery from its long-DTE input behavior. The scanner discovers eligible held long calls first; long-DTE may remain an advanced eligibility filter only if it clearly reports which held contracts it excludes and why.
7. A qualified PMCC candidate must bind the short call to the exact held long contract. Same ticker, strike, or expiration alone is insufficient.
8. The Trade/Review action must create a short-call-only review plan. It must never create the old two-leg `Buy to Open` + `Sell to Open` new-PMCC ticket for an existing LEAPS.

### 4. Shared user experience

1. Keep all three finder buttons visible in Screener.
2. Make the button labels and modal titles precise:
   - **Find LEAPS** — new long-call scan for supplied tickers.
   - **Find CCs** — scan calls against verified stock holdings.
   - **Find PMCCs** — scan calls against verified held long calls.
3. Results must always show one of:
   - qualified review candidate;
   - no eligible holding;
   - no remaining capacity;
   - excluded, with reason;
   - broker data unavailable/stale, with reason.
4. Do not present `0 selected tickers` as a PMCC or CC blocker when the portfolio itself contains eligible holdings.
5. Preserve Position Analysis as a detailed management view. It should deep-link into or show the same held-position candidate and evidence; it does not replace the three finder controls.

## Canonical safety requirements

- Use one account-scoped canonical snapshot for stock ownership, held options, active short calls, and working orders.
- Fail closed when account identity, holdings, or coverage evidence is unavailable.
- Revalidate portfolio evidence immediately before constructing any broker review/trade plan.
- Existing PMCC and covered-call paths create short-call-only plans; no hidden stock or long-option leg may be added.
- Keep broker submission behind the existing review/confirmation boundary.
- Preserve unrelated worktree changes; do not modify or stage:
  - `features/portfolio/positions-workspace/model/columns.ts`
  - `deploy-fix-silent-reauth-wiring.sh`

## Acceptance tests

1. Find LEAPS is enabled when tickers are supplied and finds only new long-call candidates for those tickers.
2. Find LEAPS is disabled or explains its required input when no tickers are supplied.
3. Find CCs can run with zero selected tickers and discovers eligible long-stock holdings from the portfolio.
4. Find CCs filters to selected tickers when they are provided.
5. Find CCs reports no available shares for an unowned selected ticker.
6. Existing and working short calls reduce capacity; zero capacity produces no CC candidate or trade plan.
7. Find PMCCs can run with zero selected tickers and discovers held long calls in the portfolio.
8. Find PMCCs filters to selected tickers when provided.
9. A long put, multi-leg option, stale snapshot, or wrong-account long call is visibly excluded from PMCC discovery.
10. PMCC candidate identity requires exact OCC, underlying, expiry, strike, and quantity.
11. Existing-PMCC review creates only a short-call plan and cannot create a two-leg new-PMCC entry.
12. All empty, unavailable, and excluded states include a human-readable reason.

## Verification and delivery

Run focused tests, TypeScript type-check, and `git diff --check`.

Report changed files, validation output, unresolved blockers, and exact `git add`, `git commit`, and `git push` commands that exclude unrelated worktree files.
