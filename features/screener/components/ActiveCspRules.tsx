import type { CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { buildCspReceipt, valuesFromSnapshot, type CspResultCounts } from '@/lib/screener/scanConfig/cspRegistry';
import { ScanReceiptPanel } from './scanConfig/ScanReceiptPanel';
import type { ScanModalTheme } from './ScanModalShell';

// The receipt sits inside the amber results banner, so it uses this fixed palette
// rather than the modal theme.
const RECEIPT_THEME: ScanModalTheme = {
  bg: '', card: '', border: 'border-amber-500/30', text: 'text-neutral-100', textMuted: 'text-neutral-300',
  textFaint: 'text-neutral-400', input: '', inputBorder: '',
};

/**
 * SCREENER-CONFIG-0001A -- the result receipt. It is built from the same CSP
 * criterion registry as the configuration modal's scan summary, so a label cannot
 * differ between the two, and it adds the result counts.
 */
export function ActiveCspRules({ snapshot, onEdit, counts = null, capital }: {
  snapshot: CspRuleSnapshot;
  onEdit: () => void;
  counts?: CspResultCounts | null;
  capital?: { affordableOnly?: boolean; capitalLimit?: number | null };
}) {
  const receipt = buildCspReceipt(valuesFromSnapshot(snapshot, capital), counts);
  const modeLabel = snapshot.mode === 'filter' ? 'Filter (older scan)' : snapshot.mode === 'rank' ? 'Rank' : 'Targeted';
  return (
    <section aria-label="Active CSP rules" data-testid="active-csp-rules" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] text-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold uppercase tracking-wider text-amber-300">Active CSP rules · {modeLabel} · {snapshot.preset} preset</h3>
        <button onClick={onEdit} className="rounded border border-amber-500/50 px-2 py-1 font-bold text-amber-300">Edit / Run Again</button>
      </div>
      <div className="mt-2">
        <ScanReceiptPanel th={RECEIPT_THEME} receipt={receipt} heading="Active CSP rules" bare />
      </div>
    </section>
  );
}
