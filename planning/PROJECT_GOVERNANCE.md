# TradeEdge Project Governance

**Version:** 1.2
**Status:** Active  
**Last Updated:** 2026-08-14 (Reconciled Roles and Responsibilities with the canonical TradeEdge team personas.)

## Purpose

This document defines how TradeEdge is planned, implemented, reviewed, tested, released, and maintained.

It is the authoritative source for project workflow. If a prior conversation, implementation prompt, handoff document, or informal decision conflicts with this document, this document takes precedence until it is intentionally amended.

## Product Vision

TradeEdge is a decision engine for options traders, not merely a trade tracker or analytics dashboard.

Every material feature should help answer:

> What should I do next, and why?

## Product Principles

TradeEdge shall:

- favor conservative, explainable recommendations;
- expose material risk rather than conceal it;
- reuse canonical engines and data sources instead of duplicating business logic;
- keep calculations deterministic wherever practical;
- distinguish recommendation, simulation, paper execution, and live execution;
- require explicit safety gates before any execution capability is introduced;
- preserve a clear audit trail for important recommendations and decisions;
- remain modular enough that scoring, policy, presentation, and execution can evolve independently.

## Roles and Responsibilities

### Project Sponsor — Dean

The Project Sponsor provides executive sponsorship and project direction. Dean retains final authority over product direction, sprint approval, production deployment, and any live-trading capability.

### Professional Options Trader — Ian

The Professional Options Trader provides expert guidance grounded in years of Wall Street experience and practical use of leading systems for trading stocks, options, and related instruments. Ian helps ensure TradeEdge reflects real professional workflows and sound trading practice.

### Product Owner — Paul

The Product Owner is responsible for:

- maintaining the product vision and roadmap;
- evaluating priorities before recommending a sprint;
- defining complete sprint scope and acceptance criteria;
- reviewing implementation results and defects;
- issuing final product sign-off and merge decisions;
- preventing scope drift and redundant implementation.

Repository disorder, unclear sprint state, conflicting instructions, or untracked scope changes are treated as Product Owner process failures.

### Scrum Master and Chief Facilitator — Frank

The Scrum Master is responsible for:

- facilitating effective team collaboration and delivery ceremonies;
- helping remove impediments;
- promoting transparency, focus, and continuous improvement;
- ensuring the agreed delivery process is followed.

### User Experience Expert — Diane

The User Experience Expert is responsible for:

- designing and reviewing application flows;
- ensuring the product is usable, coherent, and accessible;
- guiding the application's look and feel;
- identifying UX risks and inconsistencies before acceptance.

### Chief Architect — Alan

The Chief Architect is responsible for:

- maintaining architectural consistency across sprints;
- conducting technical review of each implementation before product sign-off;
- approving or rejecting architecture, layering, separation of concerns, determinism, and test strategy;
- identifying when a discovered issue requires an "ARCHITECTURE REVIEW REQUIRED" escalation rather than a unilateral implementation decision.

### Principal Developer — Dane

The Principal Developer is responsible for:

- implementing the approved sprint specification;
- working only within the approved scope;
- using the active working tree and approved branch;
- verifying repository/branch/sprint state before every implementation session;
- writing or updating targeted tests;
- running the required validation sequence;
- documenting implementation results, limitations, and deviations;
- ensuring every implementation has an associated implementation report for team review and acceptance;
- committing and pushing completed work when instructed;
- managing day-to-day repository and branch mechanics (creation, verification, cleanup) under Product Owner/Chief Architect direction.

The Principal Developer must not independently expand sprint scope, redesign unrelated architecture, introduce future-sprint features, modify acceptance criteria, or rewrite design documents unilaterally. When an architecture, safety, scope, governance, or repository-state assumption proves wrong mid-session, the Principal Developer must stop and return an "ARCHITECTURE REVIEW REQUIRED" report rather than self-resolving.

### Software Test Engineer — Quinn

The Software Test Engineer is responsible for:

- verifying implemented behavior and acceptance criteria;
- reviewing test architecture, coverage, and quality;
- evaluating requirements for correctness, clarity, and testability;
- identifying defects, gaps, and risks before product acceptance;
- providing feedback that improves both implementation quality and the team's testing approach.

## Source-of-Truth Hierarchy

When project documents disagree, use this precedence order:

1. `planning/PROJECT_GOVERNANCE.md`
2. the approved active sprint specification
3. `planning/SPRINT_STATUS.md`
4. current architecture and decision records
5. implementation reports and handoff documents
6. prior conversation history

A conflict should be resolved by updating the appropriate source-of-truth document, not by silently choosing one interpretation.

## Sprint Governance

### One Active Sprint

Only one implementation sprint may be active at a time.

Before a sprint begins, the Product Owner shall:

1. review the current repository and product state;
2. review completed work and unresolved follow-ups;
3. evaluate the backlog and highest-value next capability;
4. recommend one sprint with rationale;
5. obtain repository-owner approval;
6. freeze the sprint scope.

### Frozen Scope

After approval, the active sprint is frozen.

New ideas discovered during implementation must be recorded for later prioritization. They must not be inserted into the active sprint unless the repository owner explicitly reopens and changes the scope.

### Complete Specifications

Implementation instructions should be delivered as a complete, consolidated specification rather than incremental addenda.

A sprint specification should include, as applicable:

- objective and user value;
- scope and non-goals;
- architecture and reuse constraints;
- required behavior;
- acceptance scenarios;
- testing requirements;
- documentation requirements;
- execution-efficiency requirements;
- commit and push commands.

## Branch Strategy

### Permanent Branches

- `main` — production-ready and always intended to be releasable.
- `epic/autopilot` — long-lived integration branch for the Autopilot initiative when active integration work requires it. (This branch was previously named `feature/autopilot`; that name is obsolete and should only appear in historical command transcripts, not in active documentation.)

### Short-Lived Branches

All other feature or sprint branches are temporary, named `feature/<ticket>-<description>`.

Their lifecycle is:

1. create from the approved base branch;
2. implement and validate;
3. review;
4. merge into the approved target;
5. delete the local branch;
6. delete the remote branch;
7. verify repository health.

### Branch Rules

- Do not create backup branches as a routine safety mechanism.
- Use Git history or an intentional tag to preserve milestones.
- Do not retain abandoned or already-merged feature branches.
- Do not assume the user's locally checked-out branch from GitHub state alone.
- Before branch-sensitive work, explicitly verify the intended active branch and the relevant remote branch state.

## Git Operating Procedure

When guiding the repository owner through Git operations, the Product Owner shall:

- provide one logical operation at a time;
- wait for the command output before proceeding;
- never assume a command succeeded;
- avoid mixing current instructions with optional future work;
- avoid “also” or “while you are there” additions after presenting the requested action;
- provide complete files rather than patch-style editing instructions when a document is materially revised.

Multiple commands may be grouped only when they form one atomic, low-risk operation whose intermediate state does not require review.

## Implementation Efficiency Standards

Principal Developer implementation prompts shall require efficient use of the active environment.

Unless a sprint explicitly requires otherwise:

- use the active working tree;
- do not create disposable or secondary environments;
- do not reinstall dependencies unnecessarily;
- do not run `node_modules` health checks;
- use targeted tests during development;
- run one complete required test pass at the end;
- run one TypeScript validation pass;
- run one production build;
- stop any validation command that exceeds five minutes and report it rather than investigating the environment;
- avoid redundant validation and repeated token-intensive analysis.

## Definition of Done

A sprint is complete only when all applicable requirements are satisfied:

- approved scope is implemented;
- acceptance criteria are met;
- targeted and regression tests pass;
- TypeScript validation passes;
- production build passes, or an explicitly accepted environment limitation is documented;
- safety and non-goal constraints are verified;
- implementation documentation is updated;
- sprint review is completed;
- changes are committed and pushed;
- approved merge is complete;
- temporary branches are cleaned up;
- repository health is verified;
- `planning/SPRINT_STATUS.md` reflects the actual state.

An implementation being committed is not, by itself, sufficient to mark a sprint complete.

## Repository Health

A healthy repository has:

- a clean working tree;
- local branches tracking the intended remote branches;
- `main` synchronized with `origin/main`;
- no stale or obsolete branches;
- no abandoned lock files;
- current planning and status documentation;
- an explicit active sprint or an explicit statement that no sprint is active.

Repository health must be checked after every merge and sprint closeout.

## Documentation Governance

Documentation is part of the product and must remain consistent with the codebase.

### Required Operational Documents

- `planning/PROJECT_GOVERNANCE.md` — project operating rules.
- `planning/SPRINT_STATUS.md` — current status, active objective, completed work, and unresolved follow-ups.
- approved sprint plan or ticket — frozen implementation scope.
- implementation review or report — evidence of what was delivered.

### Documentation Rules

- Prefer complete replacement documents over fragmented edit instructions for substantial changes.
- Preserve useful historical implementation records, but do not let historical detail obscure current status.
- Clearly distinguish current source-of-truth documents from archived or historical records.
- Update status documentation at sprint completion, not later as a separate cleanup exercise.
- Do not mark deployment, smoke testing, or acceptance complete without evidence.

## Safety and Execution Boundaries

TradeEdge execution capabilities must advance through explicit maturity gates:

1. deterministic analysis and recommendation;
2. complete reasoning and observability;
3. simulated or paper execution;
4. autonomous paper-position management;
5. paper beta validation;
6. independent live-readiness review;
7. live implementation only after explicit approval.

No paper or live execution capability may be introduced merely as a convenient extension of a recommendation sprint.

All execution work must include explicit kill-switch, authorization, audit, failure-handling, idempotency, and state-reconciliation requirements appropriate to its maturity stage.

## Session Start and Closeout

### Session Start

Before recommending branch-sensitive implementation work, the Product Owner should establish:

- active local branch as reported by the repository owner or verified through available tooling;
- relevant remote branch state;
- current sprint status;
- whether there are uncommitted changes;
- the approved objective.

### Session Closeout

At the completion of a sprint or merge workflow, the Product Owner shall verify:

- final commit and merge state;
- clean working tree;
- local and remote branches;
- branch cleanup;
- updated documentation;
- next objective status.

## Amendment Process

This document may be changed only through an intentional governance update approved by the repository owner.

When amended:

- update the version or last-updated date;
- describe the material change in the commit message;
- update related operational documents when necessary.

Informal conversation does not silently override this document.
