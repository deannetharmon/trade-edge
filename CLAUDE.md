# TradeEdge

Options screening and portfolio management platform for premium-selling trades. Owner and sole human developer: Dean Harmon.

## Stack

- Next.js 14 (App Router), TypeScript, Tailwind
- Deployed on Vercel; auto-deploys on push to `main` (main is production); preview URLs for branches
- Broker API: TastyTrade, browser-side only
- Persistence: Redis keyed by Google OAuth user ID; localStorage for UI state
- AI analysis: OpenAI GPT-4o via `/api/analyze`
- Tests: Vitest (`npm test` runs the full suite)

## Output rules

- Always deliver complete files, never snippets, unless Dean asks for snippets.
- First line of every .ts/.tsx file: a comment with the full file path, then a blank line.
- Be concise and technically direct. Recommend a course of action when a clear best answer exists. Acknowledge errors without defensiveness.
- Discuss and align on approach before writing code when multiple patches are involved.

## Session start

Run `git status; git branch -vv; git stash list` and flag issues in 1-2 lines.

Read docs/ROADMAP.md before starting any new ticket work.

## Session end

Push any branch with local commits. Never leave work only in stash or a temp worktree.

## Build and verification

- Dean has no local Node.js. Vercel preview deployment is the authoritative build check.
- `tsc --noEmit` alone is insufficient; `next build` (via Vercel preview) is required, especially for page.tsx changes.
- Use `tsconfig.check.json` (es2017 target override) for tsc checks.
- Next.js App Router: page.tsx may only use allowed named exports. Extract non-page logic to `lib/`.
- Before handing off any change, state (a) which sibling/adjacent code paths were checked for the same class of bug, and (b) that real tsc/test verification was actually run.
- Scale verification to risk. Small display/copy changes: tsc plus affected existing tests only. Risky changes (security, shared logic, order paths, refactors): full suite and new tests. CI runs the full suite on every push.
- Never patch blind: verify exact file content against the repo before writing patches.

## page.tsx working-file rule

When making multiple changes to a page.tsx in one session:

1. Keep one working copy and treat it as the source of truth.
2. When a new version of the file arrives, diff it against the working copy before copying anything.
3. Never regress a previous change. If the incoming file is missing features the working copy has, reconcile first.
4. Before delivering, verify every prior change from the session is still present, and list what was checked.

## Approval gates (virtual team, advisory lenses only)

- Ian (professional trader): signs off on all scoring, qualification, logic, and risk changes before build.
- Paul (product): approves scope before build.
- Diane (UX): produces mocks before any UI goes to code.
- Alan (quant): validates formulas and golden fixtures.
- Quinn (QA): testability, coverage, regressions, architecture risk.
- Frank (facilitator/Scrum Master): runs a ticket through the team; works with Paul.
- Dane (implementation): the build role. Do not build before approval; this has caused regressions.
- Personas are lenses, not agents. Apply them inline in the main session; full criteria live in `docs/PERSONA_LENSES.md` (read only the sections you need). For an independent second opinion (Dean asks, or a finished high-risk proposal: scoring, orders, risk logic), spawn a general-purpose agent with the relevant lens section pasted into its prompt.
- Scale gates to risk: small copy/display changes skip persona gates; full gates only for scoring, qualification, order paths, and risk logic.
- When a subagent is spawned, pass exact files and line ranges so it does not re-explore the codebase.
- Dean is the sponsor and final decision-maker.

## Token discipline

- Default to ONE persona per task. Add others only to review a finished proposal, not to redo the research.
- Do not read app/screener/page.tsx (~12.6k lines) in full. Grep for the symbol and read only the relevant range.
- Read only the files or ranges named in the prompt when given.
- Do not spawn Frank unless coordinating 3+ personas on one ticket.
- Discuss first, then build. Ask before running the full test suite.

## Session discipline

- Prefer `claude --continue` or `claude --resume` over a fresh `claude` start when picking up existing work. A fresh session re-reads CLAUDE.md and re-runs session-start checks, burning tokens on state you already have.
- Don't restart mid-decision. Finish a review/decision cycle before ending a session; re-summarizing "where we left off" costs tokens every time.
- Batch real-world lookups (TastyTrade, DevTools, Vercel preview) before asking for one — gather everything needed for the current gate in one pass rather than round-tripping per item.
- Use a lighter model for routine checks (git status, session-start flags, simple file reads); reserve the strongest model for logic, scoring, and build work.

## TastyTrade constraints

- Access tokens expire in about 15 minutes.
- All calls must be browser-side (Vercel server IPs are blocked).
- Multi-leg spreads require Limit orders (floor $0.01). Stop-market orders are not supported on multi-leg positions.
- Preserve space-padded OCC symbol format exactly.

## Fixed specs (do not revert)

Portfolio chart popup: `position: fixed`, `z-[9999]`, anchored via `cardRef.getBoundingClientRect()`. Popup bottom aligns to card bottom (`bottom: window.innerHeight - r.bottom`) and grows upward. `absolute top-full`, `mt-2`, and `top: r.bottom + 8` are known-bad (regressed ~10 times).

## Design principles

- Technical failures block before a modal; verified empty results open the modal with an in-modal banner.
- Three-tier visual weight: decision / risk-context / ambient. Visual weight must match decision weight.
- "Trust the qualified realm": traders adjust criteria via scan controls; do not override disqualified results with warnings.

## Trading methodology

Premium-selling strategies: BPS, BCS, IC, CSP, CC, PMCC, LEAPS. Capital preservation, defined-risk structures, 50% profit exits, 21-DTE management stops, 2x credit loss stops.

## Project state

Roadmap: see docs/ROADMAP.md (Paul maintains this — read it at session start).

## Reference docs

Keep copies of these in `docs/` if you want Claude Code to read them: `paper-trading-full-parity-plan.md`, `Prosper Trading Rule Set.pdf`, `Stock_Screening_Flowchart.pdf`, `Flowchart_Detail_Pages.pdf`, `TradeEdge Project Team Roles.pdf`.
