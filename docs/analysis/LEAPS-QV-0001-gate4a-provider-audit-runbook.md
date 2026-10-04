# LEAPS-QV-0001 Gate 4a — Provider audit capture runbook

Read-only capture for spec Section 11.1. **Audit tooling only**: nothing here authorizes production acquisition, evaluator, ranking or orchestration. Thresholds and weights remain PROPOSED. The provider audit is **NOT complete** until the captured files are reviewed.

Script: `scripts/leaps-provider-audit/leaps-provider-audit.js` (browser-console script, no install, no Node needed).

## What it does and does not do
- Runs in your logged-in TradeEdge tab and calls only the app's own same-origin read proxy (`/api/tastytrade/proxy`). The broker credential stays server-side; you paste no token and the script never reads cookies, storage or headers.
- GET only, to five allow-listed read paths (equity instrument, option instrument, nested chain, market data by type). Account, order, customer and transaction paths are rejected in code.
- Sanitizes output (credential-like keys and values redacted), re-scans it, and **downloads nothing if anything secret-like survives**.
- Preserves raw values, missing fields and provider errors. It does not infer units or timestamp meaning.

## Option instrument lookups (revision 1.1.0, export format `leaps-provider-audit/v2`)
The bulk instrument endpoint `GET /instruments/equity-options?symbol[]=<OCC>` returns **HTTP 403 "Token has insufficient scopes for this request."** for the TradeEdge OAuth client (scopes requested: `read trade openid`). Individual instrument, option chain and market-data reads succeed.

- **Evidence preserved:** the bulk endpoint is called **once per run** (first symbol with an in-window sample). Its status and sanitized error body are kept in `results[].optionInstrumentsBulkProbe`; later symbols record `PROBED_ONCE_PER_RUN`. A 403 there does not stop the capture. Its records, if it ever succeeds, are not used. `bulkProbe: false` skips the call.
- **Capture:** the same sample (up to 6 in-window calls spread across expirations, plus up to 2 non-primary-root calls) is fetched one symbol at a time with `GET /instruments/equity-options/{url-encoded OCC symbol}`. The space-padded OCC symbol is preserved exactly. Results are in `results[].optionInstruments` (`lookups[]` per symbol with HTTP status, `records`, `fieldPresence`, `attempted/succeeded/failed`). A failed lookup is recorded and the rest continue.
- **Cap unchanged:** `maxRequests` (default 150) still bounds the whole run; if it runs out mid-sample, the remaining lookups are recorded as skipped with `REQUEST_BUDGET_EXHAUSTED`.

## Run it
1. Open TradeEdge (production or a preview URL) in Chrome, signed in with TastyTrade connected.
2. Open DevTools Console (Windows/Linux `Ctrl+Shift+J`, Mac `Cmd+Option+J`). If Chrome blocks pasting, type `allow pasting` and press Enter.
3. Copy the full contents of `scripts/leaps-provider-audit/leaps-provider-audit.js` (branch `feature/leaps-qv-0001-gate2-metrics-data-audit`), paste into the console, press Enter.
4. Sanity check: `TE_LEAPS_AUDIT.selfTest()` should print `{ok: true, ...}`.
5. **Regular-hours capture** (Mon-Fri, 9:30-16:00 ET):
   ```js
   await TE_LEAPS_AUDIT.run({
     sessionLabel: 'REGULAR_HOURS',
     symbols: ['SPY', 'AAPL', 'MSFT', '<illiquid1>', '<illiquid2>'],
     notes: 'free text, optional'
   });
   ```
   Use about five underlyings: three liquid, two thinly traded LEAPS names from your list. For a cash-settled index add `indexSymbols: ['SPX']` and include `'SPX'` in `symbols`.
6. **After-hours capture**: the same command with `sessionLabel: 'AFTER_HOURS'`, on a trading day after 16:00 ET (for example 18:00-20:00 ET), same symbols. Reload the page and repeat steps 3-4 first if the tab was closed.
7. Optional but useful for the Saturday/holiday cases of spec 4.3: a third run with `sessionLabel: 'WEEKEND_CLOSED'` on a weekend.
8. Attach the downloaded files to the chat. They contain no credentials by construction; the console line `[leaps-audit] saved ...` confirms the redaction count.

Expected volume: about 14 requests per symbol plus one bulk probe per run (cap 150, 200 ms apart), roughly 70 requests and under 1 minute for five symbols.

## Expected output files (one per run, never merged)
- `leaps-provider-audit_REGULAR_HOURS_<UTC compact time>.json`
- `leaps-provider-audit_AFTER_HOURS_<UTC compact time>.json`
- optional `leaps-provider-audit_WEEKEND_CLOSED_<UTC compact time>.json`

Each file records the declared session label, capture start/finish (UTC), the New York wall-clock date/time/weekday, every request (path, HTTP status, duration), and per symbol the sections below. The tool makes no market-state, holiday or early-close inference.

## If something goes wrong
- `Sanitizer self-check FAILED`: nothing was downloaded. Tell me the message (it lists JSON paths, not values). Do not paste raw output.
- `HTTP_401_SESSION_EXPIRED`: reload TradeEdge, reconnect TastyTrade if prompted, rerun. A partial file is still downloaded with `complete: false`.
- `HTTP_429_RATE_LIMITED` or budget exhausted: the capture stops and records why; wait a few minutes and rerun with fewer symbols.

## Where each Section 11.1 item lands in the file
| 11.1 item | Location in `results[]` |
|---|---|
| 1 nested chain fields (shares-per-contract, root, expiration/settlement type) | `nestedChain.items[].itemFields`, `expirationFieldPresence`, `inWindowStrikeFieldPresence` |
| 2 instrument deliverable records | `optionInstruments` (individual lookups), `optionInstrumentsBulkProbe` (403 evidence), `equityInstrument` |
| 3 option rows (bid/ask/size, greeks, IV, volume, OI, quote-time, delayed flag) | `optionQuotes.fieldPresence` (per-field present/absent/null/types/raw samples; `timestampLike` flagged) and `optionQuotes.items` |
| 4 underlying quote and timestamp | `underlyingQuote` |
| 5 after-hours vs regular hours | compare the separate files (`capture.declaredSessionLabel`, `capture.newYorkWallClock`) |
| 6 failed or partial chunk behavior | `optionQuotes.chunks[]` (items returned, requested symbols missing, unexpected/duplicate items, HTTP errors) |
| 7 ladder sizes | `nestedChain.ladder` (expirations total/in window, calls below spot per expiration, min/median/max) |

Chunk failures that cannot be observed safely are **not** provoked; they are covered later with injected failures in tests.

## Validation of the tool (synthetic only)
`lib/scans/__tests__/leapsProviderAuditScript.test.ts` (23 tests) runs the script against synthetic provider responses: allow-list, sanitizer with planted secrets, missing/null/mixed-type fields, chunk failure and partial response, 401 and budget stops, bulk 403 probe once per run, individual URL-encoded lookups including a failed lookup and a cap stop mid-sample, deterministic output, and static guards (no storage/cookie access, one GET-only network call). This validates the tooling, not the provider.
