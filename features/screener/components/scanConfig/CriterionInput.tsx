import { DeferredNumberInput } from '../DeferredNumberInput';

const INPUT_CLASS = 'mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white';

/**
 * One labelled numeric input. The label text is the visible name, the aria-label is
 * the accessible name tests and screen readers use, and an inline message is
 * announced politely when the value is invalid.
 */
export function CriterionInput({
  id, label, ariaLabel, title, step, value, onValueChange, unit, error, hideLabel = false, inputClassName, invalid = false, hideStatus = false,
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
  /** Compact layout: the caller shows the visible name, so the label text is for screen readers only. */
  hideLabel?: boolean;
  inputClassName?: string;
  /** Marks the field invalid when the caller shows the message elsewhere. */
  invalid?: boolean;
  /** The caller renders the polite status message itself. */
  hideStatus?: boolean;
}) {
  return (
    <label title={title} data-criterion-input={id} className={`flex flex-col text-[10px] text-neutral-400 ${hideLabel ? 'gap-0' : 'gap-1'}`}>
      {hideLabel ? <span className="sr-only">{label}</span> : label}
      <DeferredNumberInput
        aria-label={ariaLabel ?? label}
        step={step}
        value={value}
        onValueChange={onValueChange}
        className={`${inputClassName ?? INPUT_CLASS}${invalid || error ? ' !border-red-500' : ''}`}
      />
      {unit ? <span className="text-[9px] text-neutral-500">{unit}</span> : null}
      {hideStatus ? null : <span role="status" aria-live="polite" className="min-h-0 text-[9px] text-red-400">{error ?? ''}</span>}
    </label>
  );
}
