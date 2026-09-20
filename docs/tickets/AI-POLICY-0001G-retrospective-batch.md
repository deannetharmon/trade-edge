# AI-POLICY-0001G — `retrospective_batch`

**Status:** **DEFERRED — do not start.** Blocked on Paul (D10): the reports are not defined.
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec AC:** 7

## Problem

The spec calls for offline, retrospective, dated research and completed-session reports that can never influence a live scan, quote, qualification, ranking, recommendation, or order. It does not define which reports exist or who reads them.

## What Paul must define before this is ready

1. Which report(s) (e.g., "week's completed scan sessions, reason-code trends"), their audience, cadence, and where they are read (UI page, downloadable file).
2. Whether the value justifies the cost versus interactive routes.
3. Retention for batch inputs/outputs (default: same as D4).

## Proposed shape (for when it is unblocked)

- Provider Batch API (24-hour completion window) for the economical tier; scheduled by Vercel Cron and/or a manual trigger; reads only **completed** artifacts/inputs already stored by the gateway.
- **Isolation by construction:** batch code lives in `lib/ai-policy/batch/`, uses its own Redis namespace `ai-policy:batch:*`, has **read-only** access to stored inputs, and never imports scan, ranking, qualification, order, or route-handler modules (extend the 0001A import-boundary test). Batch outputs are never read by any live decision path (reverse boundary test).
- Same validator, provenance, budget (own line item), kill switches (`AI_POLICY_RETRO_BATCH_ENABLED`, Redis kill key), and launch gate as other routes.

## Acceptance criteria (draft)

1. Boundary tests prove batch cannot import or write to live decision modules or keys, and no live module imports batch.
2. Flag off / kill switch / missing gate ⇒ scheduled job exits without provider calls.
3. Reports are dated, cite deterministic fields like other routes, and carry the same read-only disclosure.

## Notes

Non-goal: no scheduling or autonomous monitoring beyond report generation. Full ticket sections (Implementation notes, Validation, Rollout) are written after Paul's definition.
