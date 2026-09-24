import { buildCcReceipt, type CcConfigValues, type CcResultCounts } from '@/lib/screener/scanConfig/ccRegistry';
import { CcReceiptPanel } from './scanConfig/ScanReceiptPanel';
import type { ScanModalTheme } from './ScanModalShell';

// The receipt sits inside the amber results banner, so it uses this fixed palette rather than the
// modal theme (the same one the CSP receipt uses).
const RECEIPT_THEME: ScanModalTheme = {
  bg: '', card: '', border: 'border-amber-500/30', text: 'text-neutral-100', textMuted: 'text-neutral-300',
  textFaint: 'text-neutral-400', input: '', inputBorder: '',
};

/**
 * SCREENER-CONFIG-0001B -- the covered-call result receipt. Built from the same criterion registry
 * as the configuration modal's scan summary, so a label cannot differ between the two, plus the
 * result counts. A covered-call scan returns one best call per symbol, so the counts are symbols.
 */
export function ActiveCcRules({ values, counts = null, onEdit }: {
  values: CcConfigValues;
  counts?: CcResultCounts | null;
  onEdit: () => void;
}) {
  const receipt = buildCcReceipt(values, counts);
  return (
    <section aria-label="Active CC rules" data-testid="active-cc-rules" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] text-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold uppercase tracking-wider text-amber-300">Active CC rules</h3>
        <button onClick={onEdit} className="rounded border border-amber-500/50 px-2 py-1 font-bold text-amber-300">Edit / Run Again</button>
      </div>
      <div className="mt-2">
        <CcReceiptPanel th={RECEIPT_THEME} receipt={receipt} heading="Active CC rules" bare />
      </div>
    </section>
  );
}
