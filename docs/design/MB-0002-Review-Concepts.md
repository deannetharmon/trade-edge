# MB-0002 — Review Experience & Dashboard Transformation

## Phase 1: Experience Exploration

**Status:** Awaiting concept selection (Quinn / Paul / Chuck / Dean). No implementation has begun — per the CES, Phase 2 does not start until one concept below is selected.

**Owner:** Dane (Lead Engineer)

---

## 1. Mission Recap

The Review experience must answer three questions in under ten seconds:

1. Am I okay?
2. What changed since my last review?
3. What deserves my attention right now?

The trader should finish informed, not overwhelmed.

**Six architectural standards carried forward from MB-0001B (Quinn/Paul/Chuck-approved, binding on this sprint):**

1. The Review Conductor is a composition layer — no duplicate ranking logic.
2. Trader Commitments represent active trader intent.
3. The Revalidation Engine determines whether commitments remain valid.
4. Presentation consumes `ReviewNarrative`.
5. Silence is a first-class outcome.
6. Review evolves from the existing `/dashboard`; it is not a second dashboard.

**Seven product principles this sprint adds**, applied as design criteria to all three concepts below: attention is the product; silence is a feature; Review has a beginning and an end; reduce cognitive load; show confidence, not volume; earn the right to interrupt; never make the trader hunt for reassurance.

**Explicit non-goals for this sprint** (not evaluated by any concept below, not touched in Phase 2 regardless of which concept is selected): Trader Commitment persistence, new Decision Engine rules, `LET_THETA_WORK`/`GTC_WORKING` revalidation, new ranking algorithms, new scoring models, broker integrations, additional recommendation engines.

## 2. The Data Contract Every Concept Designs Against

All three concepts are pure presentation layers over the one existing contract `lib/review-conductor` already produces — `conductReview(input): ReviewNarrative`. No concept computes, ranks, scores, or transforms this data; each only decides how to arrange and disclose it. Restating the contract here so every mockup below can be checked against it directly:

```ts
interface ReviewNarrative {
  generatedAt: string;
  portfolioStatus: { review: PortfolioReviewSnapshot };       // health.score, health.status, topRisks, concentrationConcerns, capitalConcerns, incomeConcern, composition
  sinceLastReview: { changes: RevalidationResult[] };         // each: { commitment, changed: true, change: { whatChanged, whyItMatters, whyNow } }
  attention: { items: AttentionItem[] };                      // each: { headline, recommendedAction, explanation: { decisionDrivers, whyNow, confidenceLabel }, band, tier, score, reasons }
  newOpportunities: { items: OpportunityRecommendation[] };    // each: { symbol, strategy, primaryReason, opportunityScoreTotal, disposition, ... }
  leadItem: { kind: 'COMMITMENT_CHANGE'; result } | { kind: 'ATTENTION_ITEM'; item } | null;
  shouldInterrupt: boolean;
  counts: { changes: number; attention: number; opportunities: number };
  complete: { isComplete: boolean; message: string };
}
```

Every mockup below names the exact field it renders. If a concept needs something this shape doesn't provide, that is a defect in the concept, not a reason to invent new data in React.

## 3. Concept A — Executive Briefing

**Philosophy:** calm, sequential, linear. The Review reads top to bottom in exactly the order `ReviewNarrative`'s seven sections already exist in — Portfolio Status, Since Last Review, Attention Required, Recommended Actions, Supporting Evidence, New Opportunities, Review Complete — with recommended actions and supporting evidence folded into each `AttentionItem`'s own card (its `recommendedAction` and `explanation` fields), matching MB-0001B's design note that these are three narrative beats over one item, not three separate lists. Feels like reading a well-written morning memo from a colleague who already looked at everything for you.

### Desktop mockup

```
┌───────────────────────────────────────────────────────────┐
│  TradeEdge Review                         Generated 8:14a  │  <- slim, unobtrusive header
├───────────────────────────────────────────────────────────┤
│                                                             │
│   PORTFOLIO STATUS                                         │
│   ● Healthy                          Score 82              │  <- portfolioStatus.review.currentState.health
│   No concentration or capital concerns today.               │
│                                                             │
│   SINCE YOUR LAST REVIEW                                    │
│   Nothing changed since your last review.                   │  <- sinceLastReview.changes.length === 0, honest silence
│                                                             │
│   ATTENTION REQUIRED (1)                                    │
│   ┌───────────────────────────────────────────────────┐   │
│   │ AAPL — Hold Position: reached 21 DTE target         │   │  <- attention.items[0].headline
│   │ Recommended: Close or roll before expiration.       │   │  <- .recommendedAction
│   │ Why now: Risk threshold crossed.  Confidence: High  │   │  <- .explanation.whyNow[0], .confidenceLabel
│   └───────────────────────────────────────────────────┘   │
│                                                             │
│   NEW OPPORTUNITIES (2)                    View all →       │  <- newOpportunities.items, collapsed to a count + link
│                                                             │
│   ✓ REVIEW COMPLETE                                          │
│   Nothing else requires your attention.                     │  <- complete.message
│                                                             │
└───────────────────────────────────────────────────────────┘
```

### Tablet / mobile behavior

Identical single column, same order, no reflow logic needed — margins narrow, card width becomes 100%. Sections with nothing to show collapse to their one honest sentence (never hidden entirely — an explicit "nothing changed" beats a missing section, per "never make the trader hunt for reassurance"). On mobile, the whole page is one continuous scroll; no swipe gesture, no accordion — the least amount of new interaction to learn.

### Reading flow

1:1 with `ReviewNarrative`'s own section order. No branching, no drill-down — "Am I okay?" and "what changed" are answered in the first two blocks a trader's eyes hit; "what deserves attention" is the very next block after that.

### Strengths

- Simplest possible mapping from data contract to layout — lowest risk of a design decision accidentally becoming a business-logic decision.
- Linear DOM order is linear reading order is linear screen-reader order — accessibility is close to "free" here.
- The literal "Review Complete" block at the true end of the page is the strongest, least-ambiguous expression of "Review has a beginning and an end" achievable with a scrolling layout.
- Cheapest to build: mostly restyled versions of presentational fragments MB-0001A/DT-0001 already built for `AttentionItem.headline`/`.recommendedAction`/`.explanation`.

### Weaknesses

- On a day with real content (the common case — this is not the empty-state day), the health/lead-item/changes summary the mission asks to see "without scrolling" may not all fit above the fold, since it's spread across the first three sections rather than surfaced together.
- Feels the least like "attention is the product" and more like "a document to get through," since nothing is visually prioritized over anything else except by position.
- Least suited to a trader who wants a fast operational scan rather than a read-through.

### Implementation complexity

**Low.** One new page layout, a handful of new small section components (`PortfolioStatusSection`, `SinceLastReviewSection`, `ReviewCompleteSection`), and reuse of existing `AttentionItem` card rendering. Fewest new interaction states — no expand/collapse, no stepper, no drill-down.

## 4. Concept B — Mission Control

**Philosophy:** operational, status-first. A trader who already knows their book wants to see everything that matters in one glance, then choose where to look closer — not be walked through it. Visual health up front, a single unmistakable "one thing" banner, then a quiet grid the trader can scan or ignore.

### Desktop mockup

```
┌────────────────────────────────────────────────────────────────────┐
│  ● Healthy · 82                    ⚠ AAPL reached 21 DTE — act now  │  <- health + leadItem, fixed top strip, no scroll needed
├────────────────────────────────────────────┬─────────────────────┤
│  SINCE YOUR LAST REVIEW                     │  NEW OPPORTUNITIES   │
│  Nothing changed.                           │  2 candidates        │  <- quiet, greyed when empty; never an empty box
│                                              │  View all →          │
├──────────────────────────────────────────────────────────────────┤
│  ATTENTION REQUIRED (1)                                             │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ AAPL — Hold Position: reached 21 DTE target                  │   │
│  │ Recommended: Close or roll before expiration.  Confidence: High│  │
│  └────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  ✓ Review complete — nothing else requires your attention.          │  <- complete.message, in a fixed footer strip
└──────────────────────────────────────────────────────────────────┘
```

The top strip (health + lead item) and the bottom strip (completion state) are both fixed, single-line, and load before anything else — this is the concept's direct answer to the mission's "first screen, no scrolling" requirement: all three questions are answerable from the top strip plus the completion strip alone, with the grid below available only if the trader wants more.

### Tablet / mobile behavior

The 2-column grid collapses to a single column, re-ordered by priority (Attention Required promoted directly under the top strip; Opportunities pushed last). Each grid module becomes a collapsible section — collapsed by default except the top strip, the Attention Required module (if non-empty), and the completion strip, so an empty day is nearly a single screen everywhere.

### Reading flow

Non-linear by design: top strip answers all three mission questions at a glance; the grid below is optional drill-down in any order the trader chooses. The completion strip is always reachable at a fixed position, not buried at the end of a scroll.

### Strengths

- Most directly satisfies the mission's literal "first screen ... without scrolling" requirement and Paul's ten-second acceptance test, because health, the one thing that matters most, and the completion state are all visible without any interaction.
- Matches a trader's existing mental model of a control center (Chuck's own vocabulary) more than a memo does.
- Scales better than a scroll on a heavy day — a grid absorbs volume; a long list does not.
- "Silence is a feature" is very legible visually: quiet modules are visibly quiet (greyed, one line), not just short.

### Weaknesses

- Non-linear layout requires deliberate `tabIndex`/DOM-order work to keep keyboard and screen-reader order matching visual priority — this is buildable but is not "free" the way Concept A's order is.
- "Review has a beginning and an end" is structurally weaker: there is no single screen the trader "arrives at" the way Concept A's terminal block provides, unless the fixed completion strip is treated as a first-class, permanent piece of chrome and never allowed to feel like an afterthought.
- Closest of the three to "just a rearranged dashboard" — the CES's own explicit worry — and requires real visual discipline (whitespace, restrained color, no competing badges) to avoid recreating TC-0001's card wall under a new name.

### Implementation complexity

**Medium.** Needs a new grid layout, a fixed top/bottom strip, local expand/collapse UI state (no persistence, no business logic — purely which modules are open), and per-breakpoint collapse rules. Reuses the same `AttentionItem`/`RevalidationResult`/`OpportunityRecommendation` rendering fragments as Concept A, arranged differently.

## 5. Concept C — Trading Partner

**Philosophy:** conversational, one-thing-at-a-time. The application walks the trader through the Review the way an experienced trading partner sitting beside them would — one beat, fully absorbed, then forward. Nothing is skimmed past by accident.

### Desktop mockup

```
┌───────────────────────────────────────────────────┐
│                                                     │
│              ●●●○○○○   (step 3 of 7 shown)          │  <- progress rail; empty steps are auto-skipped, not shown
│                                                     │
│        "One thing needs your attention:"            │  <- templated from leadItem.kind, not invented copy
│                                                     │
│        AAPL has reached your 21-DTE target.         │  <- leadItem.result.change.whatChanged / item.headline
│        Recommended: close or roll before expiration.│  <- .recommendedAction
│        Why now: risk threshold crossed.              │  <- .explanation.whyNow[0]
│                                                     │
│                          ← Back        Next →        │
│                                                     │
└───────────────────────────────────────────────────┘
```

The opening beat (step 1, not pictured above) is always a single templated sentence built only from `portfolioStatus.review.currentState.health.status` and `counts` — e.g. "You're in good shape. One thing needs your attention." — never invented commentary, always a direct template over already-computed fields, matching this codebase's "never fabricate" convention.

### Tablet / mobile behavior

Unchanged — this is the one concept where mobile is not a compromise. One focused card, Back/Next (or swipe), large touch targets. This pattern is native to mobile (comparable to a stories/onboarding flow) more than it is to desktop.

### Reading flow

Same seven-beat order as Concept A, but paced explicitly: the trader must act (click/swipe/press a key) to advance. A section with nothing to report is skipped from the sequence entirely rather than shown as an empty beat — e.g., if `sinceLastReview.changes` is empty, step 2 simply does not exist that day, and the progress rail reflects the shorter path. The final beat is always `complete.message`, arrived at deliberately, never scrolled past.

### Strengths

- Strongest "beginning and end" of the three — advancing is a conscious action, so the trader cannot accidentally skim past the close the way a scroll allows. This is the most direct answer to Chuck's specific ask for the confidence of knowing everything was seen.
- Cleanest mechanical expression of "silence is a feature": a silent section isn't just short, it doesn't exist as a step at all that day.
- Least likely of the three to be mistaken for "a prettier dashboard" — it doesn't resemble a dashboard.
- Naturally accessible: exactly one focused region in the DOM at a time, straightforward `aria-live` announcement on step change, unambiguous focus management.

### Weaknesses

- Weakest fit for the mission's literal "first screen, no scrolling, see everything at a glance" requirement — seeing all three answers requires stepping through multiple beats rather than one glance, even though nothing requires scrolling.
- Least suited to a trader who already knows their book and wants a two-second operational scan rather than a guided walk-through — this is a real tension with Chuck's own "control center" instincts even though it best serves his stated emotional goal.
- Requires the most new interaction machinery of the three: a step controller, skip-empty-steps logic, per-beat templated sentence components, and both click/keyboard and swipe navigation.

### Implementation complexity

**Medium-High.** A step/carousel controller (local UI state only — which step is active, computed from which sections are non-empty; no business logic), one templated presentational component per beat type, a progress rail, and navigation handling across input methods and breakpoints.

## 6. Comparison

| | Concept A — Executive Briefing | Concept B — Mission Control | Concept C — Trading Partner |
|---|---|---|---|
| First-screen, no-scroll fit | Weak on a real day | **Strong** | Weak (steps replace scroll) |
| "Beginning and end" / closure | Strong | Weakest of the three | **Strongest** |
| Familiarity to an operational trader | Medium | **Strong** | Weakest |
| "Silence is a feature" legibility | Medium (quiet lines) | Strong (quiet modules) | **Strongest (steps vanish)** |
| Accessibility cost | **Lowest** | Medium (needs deliberate order work) | Low (one region at a time, more state to announce) |
| Implementation complexity | **Low** | Medium | Medium-High |
| Risk of "just a rearranged dashboard" | Low | **Highest — needs discipline** | Lowest |

## 7. Recommendation

**Recommend Concept B — Mission Control**, with one execution condition attached.

Rationale: the mission statement and Paul's acceptance criteria are unusually concrete and testable here — "the first screen should communicate overall portfolio health, highest-priority item, and changes since last review, without requiring scrolling whenever possible," and "a trader can answer Am I okay / what changed / what should I do within ten seconds of opening the application." Of the three concepts, only Concept B is structurally built to satisfy that bar in the common case (a day with real content), not just the empty-state case — Concept A's answer is spread across a scroll, and Concept C's is spread across steps. Concept B also aligns most naturally with Chuck's own "control center" instinct for how a trader wants to work.

Concept B's real weakness — the CES's own literal worry that this becomes "a prettier dashboard," and the risk that closure feels weaker without a true terminal screen — is not a structural flaw in the concept, it is an execution risk. It is addressed directly in Phase 2, if selected, by treating the completion strip (`complete.message`) as permanent, fixed chrome rather than a minor footnote, and by holding firmly to the visual-hierarchy constraints already specified in the CES (whitespace, restrained color, no competing badges, progressive disclosure) so the grid reads as calm and quiet rather than as a wall of cards.

This is a recommendation, not a decision — per the CES, Phase 2 does not begin until Quinn, Paul, Chuck, and Dean select one concept.

## 8. Next Steps

Awaiting concept selection. Once one of the three above is approved, Phase 2 implements the selected concept's layout as `/dashboard`'s replacement, consuming `ReviewNarrative` from `lib/review-conductor` directly, introducing no new business logic, and following every constraint in the original MB-0002 CES (responsive behavior, accessibility, performance, explicit non-goals).
