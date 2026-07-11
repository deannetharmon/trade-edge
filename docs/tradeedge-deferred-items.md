# TradeEdge — Deferred Items Tracker

Items surfaced during mobile strategy review (v3 → v4 → v5) that were consciously deferred, not forgotten.

| # | Item | Source | Deferred to | Reason |
|---|------|--------|-------------|--------|
| 1 | Full recommendation-history audit logging (log every recommendation generated/viewed, not just executed) | ChatGPT | v2 | Volume/noise not justified until "why did it recommend X" feature is actually requested |
| 2 | Header/settings layout when side rail is active in landscape (icon-only title, overflow settings icon) | Gemini follow-up | Next spec pass | Scoped but not yet detailed |
| 3 | Confirm audit trail DB — is it Vercel Postgres or something else? | This session | Before v5 build starts | Needs confirmation to finalize `audit_events` table placement |
| 4 | Long-press-to-submit as user preference (Settings → Execution Protection) | ChatGPT | v1 optional, build if time allows | Default OFF; not blocking core rollout |

## Status
Last updated: 2026-07-11 — open items: 4
