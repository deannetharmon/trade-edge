import type { CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';

export function ActiveCspRules({ snapshot, onEdit }: { snapshot: CspRuleSnapshot; onEdit: () => void }) {
  return (
    <section aria-label="Active CSP rules" data-testid="active-csp-rules" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] text-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold uppercase tracking-wider text-amber-300">Active CSP rules</h3><button onClick={onEdit} className="rounded border border-amber-500/50 px-2 py-1 font-bold text-amber-300">Edit / Run Again</button></div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>Mode <b className="uppercase">{snapshot.mode}</b></span><span>Preset <b>{snapshot.preset}</b></span>
        <span>DTE <b>{snapshot.dteMin}–{snapshot.dteMax}</b></span><span>Delta <b>{snapshot.deltaMin.toFixed(2)}–{snapshot.deltaMax.toFixed(2)}</b></span>
        <span>Preferred OI <b>{snapshot.oiMin}</b></span><span>Liquidity <b>strong ≤ max($0.10, 10% mid); borderline ≤ 15%</b></span>
        {snapshot.popMin != null && <span>POP ≥ <b>{snapshot.popMin}%</b></span>}{snapshot.otmMin != null && <span>OTM ≥ <b>{snapshot.otmMin}%</b></span>}{snapshot.rocMin != null && <span>Period ROC ≥ <b>{snapshot.rocMin}%</b></span>}
        {snapshot.mode === 'rank' && <span>Order <b>Score → {snapshot.rankSecondary === 'none' ? 'None' : snapshot.rankSecondary}</b></span>}
        <span>Earnings <b>disqualify inside expiration</b></span>
      </div>
    </section>
  );
}
