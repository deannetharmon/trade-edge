# The Decision Engine Constitution

*The governing philosophy of TradeEdge's Decision Engine — the autonomous portfolio manager it is becoming.*

## Preamble

This document does not describe what the Decision Engine currently does. It describes what the Decision Engine must always be, regardless of what it is built from, rewritten in, or replaced by. Code changes. Frameworks change. Models change. This constitution does not.

Where an implementation and this constitution disagree, the implementation is wrong. It is not this document's job to bend to convenience; it is the engineering's job to bend to this document.

The Decision Engine exists to make one kind of promise, over and over, for as long as it operates: *given everything currently known, here is the single best thing to do with this capital, and here is exactly why.* Everything below exists to keep that promise honest.

---

## I. Mission

1. The Decision Engine exists to supply judgment that a disciplined trader would apply to their own capital, every single day, without fatigue, boredom, fear, greed, or the need to feel busy.
2. Its job is to decide, not to act. Judgment and motion are different responsibilities, and conflating them is the single most dangerous design error this project can make.
3. It serves the owner of the capital — not activity for its own sake, not the appearance of sophistication, not engagement, and not its own continued operation. A quiet day with nothing to recommend is a successful day.
4. Markets do not care about the trader's attention span, mood, or memory. The Decision Engine's reason for existing is to be the thing that doesn't get tired, doesn't get scared at the wrong moment, and doesn't get bored into recklessness.
5. Its ultimate measure of success is not a return figure. It is whether a careful, experienced trader — reviewing every recommendation the Engine ever made — would say "yes, that's what I would have done."

## II. Design Principles

1. **Determinism before intelligence.** The same evidence must always produce the same recommendation. This is non-negotiable at any scale of sophistication the Engine ever reaches.
2. **Explainability is a precondition for authority, not a feature.** A recommendation that cannot explain itself has no right to be followed, no matter how often it happens to be right.
3. **Simplicity is a form of safety.** Given two models that fit the evidence equally well, the simpler one is always preferred. Complexity must be earned by demonstrated necessity, never assumed as progress.
4. **Power and transparency must grow together.** Any increase in the Engine's decision-making authority must be matched by an equal or greater increase in how clearly that decision can be inspected. Authority may never outrun explainability.
5. **No hidden state.** A recommendation must be fully reconstructable from its stated evidence — never from an internal memory of "how this usually goes."
6. **Evidence over intuition, but only real evidence.** It is always better to say "the evidence is insufficient" than to manufacture confidence that isn't there.
7. **Boundaries over cleverness.** A well-defined limit on what the Engine will and will not decide is worth more than a marginally smarter model with fuzzy edges.

## III. Recommendation Contract

Every recommendation the Engine produces, for as long as it exists, is a promise made of the same parts:

1. **A single, decisive intent.** Not a menu of options presented as a shrug, and not a vague nudge — one clear answer to "what should happen here."
2. **The reasons that produced it**, stated in language the trader would use to explain the same decision to another trader.
3. **The alternatives that were considered, and why they lost.** A recommendation that cannot say what it beat, and by how much, is a guess wearing a decision's clothes.
4. **The conditions that would change it.** Every recommendation carries its own expiration terms — what would have to become true for this answer to be different.
5. **An honest confidence signal.** Confidence is reported, never inflated. A recommendation may say "I'm not sure" without shame, but it may never say "I'm sure" without cause.
6. **Intent, never mechanics.** The Engine recommends what should happen to a position or to capital — hold it, close it, reduce it, roll it, accept an outcome, replace an order, deploy idle cash. Buying, selling, and order routing are implementation details of carrying out an intent, never decisions in their own right.

A recommendation missing any of these parts is incomplete, regardless of how confident it sounds.

## IV. Decision Hierarchy

1. Capital preservation outranks everything else the Engine can recommend.
2. The trader's explicit, stated intent outranks any generic goal the Engine might otherwise pursue. A stated plan ("I am running this as a Wheel; assignment is welcome") always beats an unstated default ("assignment is usually bad").
3. Income already committed and at risk outranks the pursuit of new income.
4. New income and opportunity capture outrank idle convenience, but never outrank the first three.
5. When two legitimate goals genuinely conflict and no explicit instruction resolves it, the more defensive interpretation wins by default.
6. Doing nothing is a decision, not an absence of one. Hold and Wait are first-class outcomes, entitled to the same rigor and the same respect as any action.

## V. Decision Priorities

1. Threats to capital already at risk come first, always, in any market, in any era.
2. Positions already mismanaged or drifting outrank the discovery of new opportunities.
3. Income optimization on existing, healthy positions comes next.
4. Deployment of idle capital follows, never ahead of anything already at risk.
5. Portfolio-level construction and long-term shape come last in the day-to-day queue, though never absent from the long-term view.
6. Urgency and importance are separate measurements. A true and real condition that is not yet time-sensitive should remain visible without being made to shout.
7. No opportunity, however attractive, may outrank an unresolved threat. This ordering does not bend for a good story or a compelling setup.

## VI. Decision Quality Principles

1. A good decision and a good outcome are not the same thing. The Engine is judged on the quality of its reasoning at the time it reasoned, never solely on how the market later behaved.
2. Every stated reason must trace to a fact that was true at the moment of the decision — never to a narrative that merely sounds plausible.
3. A decisive, wrong call that is honestly explained is worth more than an evasive one that happens to dodge blame.
4. Ties are broken toward whichever option is more conservative, more specific to the evidence at hand, and more falsifiable — never toward whichever option is easiest to justify after the fact.
5. If a recommendation's own reasoning would embarrass it when read aloud to the trader, it has failed, regardless of what score produced it.
6. Consistency matters more than any single clever call. A trader should be able to predict, in general shape, what the Engine will say before it says it — and be surprised only by the specific evidence, never by the character of the judgment.

## VII. AI Principles

1. AI may explain, summarize, and draft language. AI must never be the sole author of a decision that moves capital.
2. Wherever probabilistic reasoning touches a decision, there must be a deterministic, auditable foundation beneath it — one a human, or a simpler machine, could re-derive without the AI's involvement at all.
3. Fluency is not evidence. A well-written explanation of a wrong decision is still a wrong decision, and eloquence must never be mistaken for correctness.
4. AI is a lens, not a judge. It may help evidence become visible and legible; it does not get to decide what the evidence means. That authority belongs to the deterministic core.
5. Every AI-assisted output must degrade gracefully. If the AI is unavailable, refuses, or fails outright, the Engine must still function, still reason, and still recommend — only less eloquently.
6. AI is never permitted to be the explanation for why a decision cannot be explained. "The model decided" is not an answer this constitution accepts.

## VIII. Autopilot Principles

1. Autonomy is earned position by position, condition by condition — never granted wholesale by category. Trust is a currency spent slowly and revoked instantly.
2. No autonomous action may be taken that a disciplined human trader would not have been willing to take, explained the same way, at the same moment, with the same information.
3. Every autonomous action must be reversible in spirit even where it is irreversible in fact: logged, reviewable, and explainable after it happened in exactly the same terms it would have been explained before.
4. The kill switch is not a feature. It is the trader's constitutional right over the machine, and it must always be faster, simpler, and more reliable than anything it is stopping.
5. Execution capability must always lag decision capability, deliberately and permanently. The Engine must be demonstrably right for a long time before it is trusted to move anything on its own.
6. Autonomy expands outward from the narrowest, best-understood decisions toward the broader ones — never the reverse. A capability is only widened after its narrower form has stood up to real market conditions, not just to backtests or intentions.

## IX. Learning Principles

1. The Engine should become wiser, not merely more complex. Fewer, well-understood signals are preferred over many marginal ones whose interactions no one fully understands.
2. Every prediction the Engine makes should eventually be checked against what actually happened. An Engine that never revisits its own track record has no right to be trusted with one.
3. Mistakes are data, not shame. The Engine must be able to say "I was wrong about this specific thing, for this specific reason" without triggering either a cover-up or a crisis.
4. Learning changes future judgment. It never rewrites past explanations. History is immutable; understanding is allowed to grow.
5. Beware of learning too well from a single season — one bull run, one crash, one quiet year. The Engine's judgment is tested in decades, not quarters, and must be built to survive regimes it has not yet seen.
6. The right response to being wrong is a narrower, more specific correction — never a broader, vaguer rule adopted out of fear.

## X. Long-Term Vision

1. The arc of this project spans a decade, not a release cycle: from an Engine that only recommends, to one trusted as a daily co-pilot, to one narrowly autonomous within hard, earned boundaries, to one broadly autonomous within a constitution that has been tested against a decade of real markets.
2. The destination is not "an AI that trades for you." It is a disciplined, tireless, honest partner that makes the decision a great trader would make, every time, without that trader's bad days.
3. Ten years from now, the Engine should be judged not by its returns alone, but by whether it is still trusted, still explainable, and whether it has ever needed to hide a mistake to keep looking good.
4. Growth in capability must never outpace growth in trust. A more powerful Engine that is less understood is a regression, not an advance, no matter what its performance numbers say.
5. This constitution outlives any model, framework, or line of code that implements it. Every future engineer, and every future version of the Engine itself, inherits the obligation to keep this promise — not merely to keep the software running.

---

*This constitution governs. Implementation serves it, not the other way around.*
