// features/screener/components/RankedListHeader.tsx

// SCAN-TOP-0002: replaces the Best Opportunities strip on every strategy. The ranked qualified cards below are the list;
// this is one line saying so, plus the required empty state when a completed scan produced no qualified candidate
// (a disqualified candidate can never be presented as an opportunity).

export const RANKED_EMPTY_STATE_TEXT =
  'No qualified opportunities for this scan. Review the disqualified candidates and their reasons below.';

export function RankedListHeader({
  hasQualified,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
}: {
  hasQualified: boolean;
  borderClassName?: string;
  textFaintClassName?: string;
}) {
  return (
    <section aria-label="Qualified opportunities, ranked" data-testid="ranked-list-header" className="mb-2 space-y-2">
      <h3 className={`text-[9px] font-bold uppercase tracking-widest ${textFaintClassName}`}>
        Qualified · ranked by score
        {hasQualified && <span className="ml-2 font-normal normal-case tracking-normal">Best opportunities carry the gold tab.</span>}
      </h3>
      {!hasQualified && (
        <div className={`rounded-lg border ${borderClassName} px-4 py-4 text-center`}>
          <p className={`text-[11px] ${textFaintClassName}`}>{RANKED_EMPTY_STATE_TEXT}</p>
        </div>
      )}
    </section>
  );
}
