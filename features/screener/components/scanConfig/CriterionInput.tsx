import { DeferredNumberInput } from '../DeferredNumberInput';

const INPUT_CLASS = 'mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white';

/**
 * One labelled numeric input. The label text is the visible name, the aria-label is
 * the accessible name tests and screen readers use, and an inline message is
 * announced politely when the value is invalid.
 */
export function CriterionInput({
  id, label, ariaLabel, title, step, value, onValueChange, unit, error,
}: {
  id: string;
  label: string;
  ariaLabel?: string;
  title?: string;
  step?: string;
  value: number;
  onValueChange: (value: number) => void;
  unit?: string;
  error?: string;
}) {
  return (
    <label title={title} data-criterion-input={id} className="flex flex-col gap-1 text-[10px] text-neutral-400">
      {label}
      <DeferredNumberInput aria-label={ariaLabel ?? label} step={step} value={value} onValueChange={onValueChange} className={INPUT_CLASS} />
      {unit ? <span className="text-[9px] text-neutral-500">{unit}</span> : null}
      <span role="status" aria-live="polite" className="min-h-0 text-[9px] text-red-400">{error ?? ''}</span>
    </label>
  );
}
