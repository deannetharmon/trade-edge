# LEAPS-QV-0001 Gate 4a — Provider audit findings (spec 11.1)

**Status: AUDIT CAPTURED AND REVIEWED 2026-10-06.** Three real captures from Dean's authenticated session, tool v1.1.0 (`leaps-provider-audit/v2`), same 8 underlyings (MRNA, UBER, NFLX, META, TQQQ, GGLL, SNDK, SOXL), window 365-900 DTE. Every file passes `validate()`; 0 redactions; 88 × 200 and 1 × 403 (the expected bulk probe) in each. Gate 4 implementation remains BLOCKED pending Ian, Quinn and Paul review of these findings; thresholds and weights remain PROPOSED.

| Capture | New York time | Option quote age (`updated-at` vs capture) | `close` on option rows | Underlying `updated-at` |
|---|---|---|---|---|
| WEEKEND_CLOSED | Sun 10/04 14:25 | ~42.5 h (Fri close) | present (some rows) | Sat ~06:09-06:31 |
| REGULAR_HOURS | Mon 10/05 12:48 | < 1 min | absent on all | live (seconds) |
| AFTER_HOURS | Tue 10/06 02:03 | ~6.1 h (Mon 20:00) | present (some rows) | Mon 20:00, one symbol overnight (UBER 00:31) |

## 11.1 items

1. **Nested chain fields — ANSWERED for standard roots.** One chain item per underlying (root = underlying, `Standard`, 100 shares, `deliverables` present, `tick-sizes` present: $0.01 below $3.00, $0.05 at or above). Expirations carry `expiration-type`, `settlement-type: PM`, `days-to-expiration`. No adjusted/non-standard root in the sample: **still unverified**.
2. **Instrument deliverable records — ANSWERED for standard roots.** The bulk endpoint `GET /instruments/equity-options?symbol[]=` returns **403 "Token has insufficient scopes for this request"** for TradeEdge's OAuth client (scopes `read trade openid`; only TastyTrade can change it). Individual `GET /instruments/equity-options/{url-encoded OCC}` succeeded 48/48 in every capture with `shares-per-contract`, `root-symbol`, `option-chain-type`, `exercise-style`, `settlement-type`, `expires-at`, `stops-trading-at`, `is-closing-only`, `active`, `streamer-symbol`. **Production must use the nested chain plus single lookups.**
3. **Option rows — ANSWERED.** Always present: bid, ask, sizes, mark, mid, delta, gamma, theta, vega, rho, `volatility` (IV), `open-interest`, `theo-price`, `updated-at`, `is-trading-halted`, `tick-size`. Often absent (contracts not traded that day, ~1-10% on NFLX/META/GGLL/SNDK/SOXL): `last`, `volume`, `open`, `prev-close`, day high/low. Numbers are mostly **strings**; `open-interest` is a number; `volume` is a decimal string. **There is no delayed/real-time flag**: freshness can only come from `updated-at`.
4. **Underlying quote and timestamp — ANSWERED.** Fields: last, bid, ask, mark, mid, close (+`close-price-type`), prev-close, `summary-date`, `updated-at`, beta, year high/low, volume, `volume-ext`.
5. **After hours vs regular hours — ANSWERED.**
   - During the session option quotes are live (age < 1 min); outside it they freeze at the last update (Mon 20:00 ET, Fri close on the weekend).
   - `close` appears on option rows only after a session ends; it can never be used as a live price.
   - **The underlying keeps moving after the close** (extended/overnight trading: MRNA last 198.85 at 12:48 → 203.56 at 20:00) **while option quotes are frozen**. Any after-hours evaluation that combines a live underlying with option quotes compares two different moments: moneyness, ladder "below spot" counts and extrinsic would be wrong. Recommendation (for Ian): outside the session, use the underlying's regular-session `close` with the option quotes, or mark the evaluation "closing values".
6. **Failed/partial chunk behaviour — ANSWERED for observed cases.** Every chunk (≤100 symbols) returned 200 with 0 missing, 0 duplicates, 0 unexpected items in all three captures. Failure paths remain covered by synthetic tests only (not provoked, by design).
7. **Ladder sizes — ANSWERED.** In-window calls per symbol 122-1,564; calls below spot per in-window expiration from 11 (UBER) to 183 (SNDK). Stable across captures. META (391) and SNDK (700) exceed a 300-quote budget: acquisition-completeness rules and request budgets must allow more than 3 quote requests per large name.

## Open items for Gate 4 review

- Adjusted / non-standard deliverables: capture one symbol with an adjusted root before implementation, or treat non-standard roots as unsupported (fail closed).
- Ian: after-hours spot policy (item 5).
- Paul/Quinn: request budget per symbol (item 7).

Raw captures: Dean's uploads of 2026-10-04 (WEEKEND_CLOSED), 2026-10-05 (REGULAR_HOURS), 2026-10-06 (AFTER_HOURS); not committed (account-scoped data).
