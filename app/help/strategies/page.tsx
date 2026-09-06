'use client';
// app/help/strategies/page.tsx
//
// HELP-0001 — Options Strategy Reference. Content-driven: every strategy
// card, detail panel, and comparison row renders from the single canonical
// model in lib/help/optionsStrategyReference.ts — nothing about any
// individual strategy is hardcoded here.
//
// Isolation boundary: this page and everything it imports must never import
// from lib/decision-engine, lib/opportunity-engine, lib/recommendations,
// lib/scans/*, or lib/wheel/* — this is pure educational reference content,
// not a recommendation, suitability, screening, or execution surface.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { THEMES, getSavedTheme, type Theme } from '@/lib/theme';
import {
  STRATEGIES, GOALS, getStrategy, getStrategiesForGoal, getOutlookLabel,
  CONTENT_VERSION, LAST_REVIEWED, MAX_COMPARISON_STRATEGIES, COMPARISON_LIMIT_MESSAGE,
  EDUCATIONAL_DISCLAIMER,
  type StrategyId, type GoalId, type StrategyReferenceEntry,
} from '@/lib/help/optionsStrategyReference';

function cardBtnId(id: StrategyId) { return `strategy-card-open-${id}`; }
function compareBtnId(id: StrategyId) { return `strategy-compare-open-${id}`; }
const COMPARISON_HEADING_ID = 'strategy-comparison-heading';
const RESULTS_HEADING_ID = 'strategy-results-heading';
const GOAL_RADIO_NAME = 'strategy-goal';

// HELP-0001 corrective pass: the accessible name for the compare toggle
// must reflect its CURRENT effect, not always say "Add" — a checked box
// whose action button still reads "Add X to comparison" contradicts its own
// checked state for screen-reader users.
function compareToggleLabel(displayName: string, compared: boolean): string {
  return compared ? `Remove ${displayName} from comparison` : `Add ${displayName} to comparison`;
}

// ── Small shared bits ───────────────────────────────────────────────────────
function RiskBadge({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  // Mechanical risk labels must never rely on color alone — an explicit
  // text label always accompanies the icon.
  return (
    <div className={`flex items-start gap-1.5 text-[10px] ${th.textFaint}`}>
      <span aria-hidden="true">⚠</span>
      <span>{label}</span>
    </div>
  );
}

function LegRow({ leg, th }: { leg: StrategyReferenceEntry['positionLegs'][number]; th: typeof THEMES[Theme] }) {
  const actionLabel = leg.action === 'Own' ? 'OWN' : leg.action === 'Buy' ? 'BUY' : 'SELL';
  const actionStyle =
    leg.action === 'Own' ? 'border-slate-500 text-slate-300'
    : leg.action === 'Buy' ? 'border-blue-500 text-blue-300'
    : 'border-amber-500 text-amber-300';
  return (
    <li className={`flex flex-wrap items-center gap-2 py-1.5 border-b ${th.border} last:border-0 text-[11px]`}>
      <span className={`shrink-0 border ${actionStyle} rounded px-1.5 py-0.5 font-bold text-[9px] tracking-wider`}>{actionLabel}</span>
      <span className={`${th.text} font-medium`}>{leg.quantity}× {leg.instrument}</span>
      <span className={th.textFaint}>{leg.strikeLabel}</span>
      {leg.note && <span className={`${th.textFaint} basis-full sm:basis-auto`}>{leg.note}</span>}
    </li>
  );
}

function Disclosure({ title, children, th }: { title: string; children: React.ReactNode; th: typeof THEMES[Theme] }) {
  return (
    <details open className={`border ${th.border} rounded-lg p-3`}>
      <summary className={`text-[11px] font-bold ${th.textMuted} uppercase tracking-wider cursor-pointer select-none`}>
        {title}
      </summary>
      <div className={`mt-2 text-[11px] ${th.textFaint} leading-relaxed space-y-1.5`}>{children}</div>
    </details>
  );
}

// ── Strategy card (grid view) ───────────────────────────────────────────────
function StrategyCard({
  strategy, goalId, th, compared, onOpen, onToggleCompare,
}: {
  strategy: StrategyReferenceEntry; goalId: GoalId | null; th: typeof THEMES[Theme];
  compared: boolean; onOpen: (id: StrategyId) => void; onToggleCompare: (id: StrategyId) => void;
}) {
  const outlook = getOutlookLabel(goalId, strategy.strategyId);
  return (
    <div className={`border ${th.border} ${th.card} rounded-xl p-4 flex flex-col gap-2.5 min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className={`text-sm font-bold ${th.text}`}>{strategy.displayName}</h3>
        <span className="text-[9px] font-bold uppercase tracking-wider border border-blue-500 text-blue-300 rounded px-1.5 py-0.5 shrink-0">
          {outlook}
        </span>
      </div>
      <p className={`text-[11px] ${th.textFaint} leading-relaxed`}>{strategy.plainSummary}</p>
      <RiskBadge label={strategy.mechanicalLabels.riskLabel} th={th} />
      <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
        <button
          id={cardBtnId(strategy.strategyId)}
          type="button"
          onClick={() => onOpen(strategy.strategyId)}
          className="text-[11px] font-bold tracking-wide border border-blue-500 text-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-500/10 transition-colors"
        >
          View full reference →
        </button>
        <label className={`flex items-center gap-1.5 text-[10px] ${th.textFaint} cursor-pointer`}>
          <input
            type="checkbox"
            checked={compared}
            onChange={() => onToggleCompare(strategy.strategyId)}
            className="w-3.5 h-3.5"
            aria-label={compareToggleLabel(strategy.displayName, compared)}
          />
          Compare
        </label>
      </div>
    </div>
  );
}

// ── Strategy detail view ────────────────────────────────────────────────────
function StrategyDetail({
  strategy, th, compared, onToggleCompare, onBack,
}: {
  strategy: StrategyReferenceEntry; th: typeof THEMES[Theme];
  compared: boolean; onToggleCompare: (id: StrategyId) => void; onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [strategy.strategyId]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={`text-[11px] font-medium ${th.textFaint} hover:text-blue-400 transition-colors`}>
        ← Back to results
      </button>

      <div className={`border ${th.border} ${th.card} rounded-xl p-5 space-y-4`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h2 ref={headingRef} tabIndex={-1} className={`text-lg font-bold ${th.text} outline-none`}>
            {strategy.displayName}
          </h2>
          <label className={`flex items-center gap-1.5 text-[10px] ${th.textFaint} cursor-pointer shrink-0`}>
            <input
              type="checkbox"
              checked={compared}
              onChange={() => onToggleCompare(strategy.strategyId)}
              className="w-3.5 h-3.5"
              aria-label={compareToggleLabel(strategy.displayName, compared)}
            />
            Compare
          </label>
        </div>
        <p className={`text-[12px] ${th.textFaint} leading-relaxed`}>{strategy.plainSummary}</p>
        <RiskBadge label={strategy.mechanicalLabels.riskLabel} th={th} />
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] ${th.textFaint}`}>
          <p><span className={`${th.textMuted} font-bold`}>Capital: </span>{strategy.mechanicalLabels.capitalType}</p>
          <p><span className={`${th.textMuted} font-bold`}>Structure: </span>{strategy.mechanicalLabels.positionShape}</p>
        </div>

        <Disclosure title="Position legs" th={th}>
          <ul>{strategy.positionLegs.map((leg, i) => <LegRow key={i} leg={leg} th={th} />)}</ul>
        </Disclosure>

        <Disclosure title="Example inputs" th={th}>
          <ul className="list-disc pl-4 space-y-1">
            {strategy.exampleInputs.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </Disclosure>

        <Disclosure title="Example outputs" th={th}>
          <dl className="space-y-1">
            {strategy.exampleOutputs.map((o, i) => (
              <div key={i} className="flex gap-3">
                <dt className={`${th.textMuted} font-bold w-52 shrink-0`}>{o.label}</dt>
                <dd>{o.value}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>

        <Disclosure title="Falls sharply / stays near today's price / rises sharply" th={th}>
          <p><span className={`${th.textMuted} font-bold`}>Falls sharply: </span>{strategy.scenarioResponses.fallsSharply}</p>
          <p><span className={`${th.textMuted} font-bold`}>Stays near today's price: </span>{strategy.scenarioResponses.staysNearPrice}</p>
          <p><span className={`${th.textMuted} font-bold`}>Rises sharply: </span>{strategy.scenarioResponses.risesSharply}</p>
        </Disclosure>

        <Disclosure title="Maximum profit" th={th}><p>{strategy.maxProfitExplanation}</p></Disclosure>
        <Disclosure title="Maximum loss" th={th}><p>{strategy.maxLossExplanation}</p></Disclosure>
        <Disclosure title="Expiration and breakeven" th={th}><p>{strategy.expirationBreakeven}</p></Disclosure>
        <Disclosure title="Time decay (theta)" th={th}><p>{strategy.timeDecay}</p></Disclosure>
        <Disclosure title="Volatility (vega)" th={th}><p>{strategy.volatility}</p></Disclosure>
        <Disclosure title="Assignment and exercise" th={th}><p>{strategy.assignmentExercise}</p></Disclosure>

        <Disclosure title="Use when / avoid when" th={th}>
          <div>
            <p className={`${th.textMuted} font-bold`}>Use when:</p>
            <ul className="list-disc pl-4 space-y-1">{strategy.useWhen.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
          <div className="mt-2">
            <p className={`${th.textMuted} font-bold`}>Avoid when:</p>
            <ul className="list-disc pl-4 space-y-1">{strategy.avoidWhen.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        </Disclosure>

        <Disclosure title="Common beginner misunderstanding" th={th}><p>{strategy.beginnerMisunderstanding}</p></Disclosure>

        <Disclosure title="Caveats" th={th}>
          <ul className="list-disc pl-4 space-y-1">{strategy.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Disclosure>
      </div>
    </div>
  );
}

// ── Comparison tray ─────────────────────────────────────────────────────────
function ComparisonTray({
  compareIds, th, onRemove, onClear, onOpen,
}: {
  compareIds: StrategyId[]; th: typeof THEMES[Theme];
  onRemove: (id: StrategyId) => void; onClear: () => void; onOpen: (id: StrategyId) => void;
}) {
  if (compareIds.length === 0) return null;
  const strategies = compareIds.map(id => getStrategy(id)!).filter(Boolean);
  // HELP-0001 corrective pass: these are the six APPROVED primary
  // comparison dimensions, each mapped directly onto an existing canonical
  // content-model field (no ad-hoc summary strings invented here). Maximum
  // profit and the dollar example of maximum loss are deliberately NOT
  // shown here — they were substituted in for assignment/time-decay in the
  // original delivery, which this pass corrects.
  const fields: Array<[string, (s: StrategyReferenceEntry) => string]> = [
    ['Typical outlook', s => s.typicalOutlook],
    ['Capital commitment', s => s.mechanicalLabels.capitalType],
    ['Maximum-loss type', s => s.mechanicalLabels.riskLabel],
    ['Assignment or exercise obligation', s => s.assignmentExercise],
    ['Complexity and mechanics', s => s.mechanicalLabels.positionShape],
    ['Time-decay tendency', s => s.timeDecay],
  ];
  return (
    <section aria-label="Strategy comparison" className={`border ${th.border} ${th.card} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 id={COMPARISON_HEADING_ID} tabIndex={-1} className={`text-xs font-bold ${th.textMuted} uppercase tracking-widest outline-none`}>
          Comparing {strategies.length} strateg{strategies.length === 1 ? 'y' : 'ies'}
        </h2>
        <button type="button" onClick={onClear} className={`text-[10px] font-bold ${th.textFaint} hover:text-red-400 transition-colors`}>
          Clear comparison
        </button>
      </div>
      {/* Stacks vertically on mobile (grid-cols-1 by default); becomes a
          side-by-side grid at sm+ — no reliance on hover anywhere below.
          Tailwind needs statically-analyzable class names, so the column
          count is chosen from a fixed lookup rather than interpolated. */}
      <div className={`grid grid-cols-1 ${
        strategies.length >= 3 ? 'sm:grid-cols-3' : strategies.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
      } gap-3`}>
        {strategies.map(s => (
          <div key={s.strategyId} className={`border ${th.border} rounded-lg p-3 space-y-2 min-w-0`}>
            <div className="flex items-start justify-between gap-2">
              <button
                id={compareBtnId(s.strategyId)}
                type="button"
                onClick={() => onOpen(s.strategyId)}
                className={`text-xs font-bold ${th.text} hover:text-blue-400 transition-colors text-left`}
              >
                {s.displayName}
              </button>
              <button
                type="button"
                onClick={() => onRemove(s.strategyId)}
                aria-label={`Remove ${s.displayName} from comparison`}
                className={`text-[10px] font-bold ${th.textFaint} hover:text-red-400 transition-colors shrink-0`}
              >
                ✕ Remove
              </button>
            </div>
            <dl className="space-y-1">
              {fields.map(([label, get]) => (
                <div key={label} className="text-[10px]">
                  <dt className={`${th.textMuted} font-bold`}>{label}</dt>
                  <dd className={th.textFaint}>{get(s)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function OptionsStrategyReferencePage() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => { setTheme(getSavedTheme()); }, []);
  const th = THEMES[theme];

  // HELP-0001 corrective pass — goal-first information architecture:
  // showing all 8 strategy cards as the default landing experience was
  // flagged as wrong; the approved default is "no cards until a goal is
  // chosen, with Browse all strategies as an explicit secondary action."
  // `browseAll` is that explicit opt-in; it's independent of selectedGoalId
  // so choosing a goal later and then returning to "no goal" doesn't leave
  // the page in an ambiguous in-between state.
  const [selectedGoalId, setSelectedGoalId] = useState<GoalId | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<StrategyId | null>(null);
  const [compareIds, setCompareIds] = useState<StrategyId[]>([]);
  const [limitMessage, setLimitMessage] = useState('');
  // Tracks the CONTROL that opened the current detail view -- a strategy
  // card button and a comparison-tray strategy button are different DOM
  // elements with different ids, and either can disappear out from under
  // the detail view (a goal change can remove the card; removing the
  // strategy from comparison removes the tray button) -- so both the kind
  // and the id must be tracked to find (or fail to find) the right opener
  // to refocus.
  const lastOpenerRef = useRef<{ kind: 'card' | 'compare'; id: StrategyId } | null>(null);

  const showingResults = selectedGoalId != null || browseAll;
  const visibleStrategies = useMemo(
    () => (selectedGoalId ? getStrategiesForGoal(selectedGoalId) : browseAll ? STRATEGIES : []),
    [selectedGoalId, browseAll],
  );

  const openDetailFromCard = useCallback((id: StrategyId) => {
    lastOpenerRef.current = { kind: 'card', id };
    setSelectedStrategyId(id);
  }, []);

  const openDetailFromCompare = useCallback((id: StrategyId) => {
    lastOpenerRef.current = { kind: 'compare', id };
    setSelectedStrategyId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedStrategyId(null);
    const opener = lastOpenerRef.current;
    // Restore focus to the exact control that opened this detail when it
    // still exists; otherwise fall back, in order, to: the comparison
    // heading, any remaining comparison-strategy control, the
    // filtered-results heading, or the goal picker's first radio -- always
    // a real, visible, focusable control, never a silent focus loss.
    requestAnimationFrame(() => {
      if (opener) {
        const openerElId = opener.kind === 'card' ? cardBtnId(opener.id) : compareBtnId(opener.id);
        const openerEl = document.getElementById(openerElId);
        if (openerEl) { openerEl.focus(); return; }
      }
      const comparisonHeading = document.getElementById(COMPARISON_HEADING_ID);
      if (comparisonHeading) { comparisonHeading.focus(); return; }
      const anyCompareControl = document.querySelector<HTMLElement>('[id^="strategy-compare-open-"]');
      if (anyCompareControl) { anyCompareControl.focus(); return; }
      const resultsHeading = document.getElementById(RESULTS_HEADING_ID);
      if (resultsHeading) { resultsHeading.focus(); return; }
      const firstGoalRadio = document.querySelector<HTMLElement>(`input[name="${GOAL_RADIO_NAME}"]`);
      firstGoalRadio?.focus();
    });
  }, []);

  const toggleCompare = useCallback((id: StrategyId) => {
    setCompareIds(prev => {
      if (prev.includes(id)) {
        setLimitMessage('');
        return prev.filter(x => x !== id);
      }
      if (prev.length >= MAX_COMPARISON_STRATEGIES) {
        // Preserve the original three; reject the fourth with an
        // accessible, visible message.
        setLimitMessage(COMPARISON_LIMIT_MESSAGE);
        return prev;
      }
      setLimitMessage('');
      return [...prev, id];
    });
  }, []);

  const removeFromCompare = useCallback((id: StrategyId) => {
    setLimitMessage('');
    setCompareIds(prev => prev.filter(x => x !== id));
  }, []);

  const clearComparison = useCallback(() => {
    setLimitMessage('');
    setCompareIds([]);
  }, []);

  const selectedStrategy = selectedStrategyId ? getStrategy(selectedStrategyId) : null;

  return (
    <div className={`min-h-screen ${th.bg} font-sans transition-colors duration-200`}>
      <div className={`${th.header} border-b ${th.border} px-4 sm:px-6 py-4`}>
        <a href="/help" className={`text-[10px] ${th.textFaint} hover:text-blue-400 transition-colors tracking-wider`}>← Back to Help</a>
        <h1 className="text-base font-bold tracking-widest text-white mt-1">OPTIONS STRATEGY REFERENCE</h1>
        <p className="text-[10px] text-white/50 tracking-wider">Educational reference — not a recommendation</p>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Visible educational disclaimer — always shown, not gated behind
            any interaction. */}
        <div role="note" className={`border border-amber-600/60 bg-amber-500/10 rounded-xl p-3 text-[11px] text-amber-200 leading-relaxed`}>
          {EDUCATIONAL_DISCLAIMER}
        </div>

        {/* Goal picker — native radiogroup via fieldset/legend + radio
            inputs, so keyboard navigation and screen-reader semantics work
            without any hand-rolled ARIA. */}
        <fieldset className={`border ${th.border} ${th.card} rounded-xl p-4`}>
          <legend className={`text-xs font-bold ${th.textMuted} uppercase tracking-widest px-1`}>What are you trying to do?</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {GOALS.map(goal => (
              <label
                key={goal.id}
                className={`flex items-center gap-2 text-[11px] ${th.textFaint} border ${th.border} rounded-lg px-3 py-2 cursor-pointer transition-colors ${selectedGoalId === goal.id ? 'border-blue-500 bg-blue-500/10 text-blue-200' : ''}`}
              >
                <input
                  type="radio"
                  name={GOAL_RADIO_NAME}
                  value={goal.id}
                  checked={selectedGoalId === goal.id}
                  onChange={() => { setSelectedGoalId(goal.id); setBrowseAll(false); }}
                  className="w-3.5 h-3.5 shrink-0"
                />
                {goal.label}
              </label>
            ))}
          </div>
          {/* HELP-0001 corrective pass: goal-first architecture. This is
              the ONLY "browse all" control, deliberately kept outside the
              six-option radiogroup above (it is not a 7th goal choice) so
              the radiogroup itself always has exactly six members. */}
          {selectedGoalId ? (
            <button
              type="button"
              onClick={() => { setSelectedGoalId(null); setBrowseAll(true); }}
              className={`text-[10px] font-bold ${th.textFaint} hover:text-blue-400 transition-colors mt-2`}
            >
              Browse all strategies
            </button>
          ) : !browseAll ? (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <p className={`text-[10px] ${th.textFaint}`}>Choose a goal above, or</p>
              <button
                type="button"
                onClick={() => setBrowseAll(true)}
                className={`text-[10px] font-bold text-blue-400 hover:underline`}
              >
                Browse all strategies
              </button>
            </div>
          ) : (
            <p className={`text-[10px] ${th.textFaint} mt-2`}>Showing all 8 strategies.</p>
          )}
        </fieldset>

        {/* Accessible, always-present live region for comparison-limit
            feedback — announced by screen readers the moment it changes,
            and also visible to sighted users when populated. */}
        <div role="status" aria-live="polite" className={limitMessage ? `text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2` : 'sr-only'}>
          {limitMessage}
        </div>

        <ComparisonTray compareIds={compareIds} th={th} onRemove={removeFromCompare} onClear={clearComparison} onOpen={openDetailFromCompare} />

        {selectedStrategy ? (
          <StrategyDetail
            strategy={selectedStrategy}
            th={th}
            compared={compareIds.includes(selectedStrategy.strategyId)}
            onToggleCompare={toggleCompare}
            onBack={closeDetail}
          />
        ) : showingResults ? (
          <div>
            <h2 id={RESULTS_HEADING_ID} tabIndex={-1} className={`text-xs font-bold ${th.textMuted} uppercase tracking-widest mb-2 outline-none`}>
              {selectedGoalId ? `Strategies for: ${GOALS.find(g => g.id === selectedGoalId)?.label}` : 'All strategies'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleStrategies.map(s => (
                <StrategyCard
                  key={s.strategyId}
                  strategy={s}
                  goalId={selectedGoalId}
                  th={th}
                  compared={compareIds.includes(s.strategyId)}
                  onOpen={openDetailFromCard}
                  onToggleCompare={toggleCompare}
                />
              ))}
            </div>
          </div>
        ) : (
          // HELP-0001 corrective pass: goal-first default -- no strategy
          // cards render until a goal is chosen or "Browse all strategies"
          // is explicitly activated (see the fieldset above).
          <p className={`text-[11px] ${th.textFaint} text-center py-6`}>
            Choose a goal above to see the relevant strategies, or browse the complete reference.
          </p>
        )}

        <div className={`text-center text-[10px] ${th.textFaint} py-4 border-t ${th.border} space-y-0.5`}>
          <p>Educational reference only — not investment advice, a recommendation, or a suitability assessment.</p>
          <p>Content version {CONTENT_VERSION} · Last reviewed {LAST_REVIEWED}</p>
        </div>
      </div>
    </div>
  );
}
