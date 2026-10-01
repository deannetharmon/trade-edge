// features/screener/components/scanConfig/RsiEntryControl.tsx

// RSI-ENTRY-0001 slice A2a: the one "Entry timing (RSI)" control, shared by the CSP and CC scan modals so the two
// cannot differ. On/Off pills, the dip (CSP) or peak (CC) level, and the turn rule under "advanced".
// Uses the same pills and numeric inputs as every other scan control.

'use client';

import type { EntryGateStrategy } from '@/lib/indicators/rsiEntryGate';
import { rsiEntryFieldErrors, type RsiEntryField, type RsiEntrySettings } from '@/lib/indicators/rsiEntrySettings';
import type { ScanModalTheme } from '../ScanModalShell';
import { CriterionInput } from './CriterionInput';
import { CriterionPills } from './CriterionPills';

export function RsiEntryControl({ th, strategy, settings, onChange }: {
  th: ScanModalTheme;
  strategy: EntryGateStrategy;
  settings: RsiEntrySettings;
  onChange: (next: RsiEntrySettings) => void;
}) {
  const errors = rsiEntryFieldErrors(strategy, settings);
  const set = (field: RsiEntryField, value: number) => onChange({ ...settings, [field]: value });
  const isCsp = strategy === 'CSP';
  const label = strategy === 'CSP' ? 'CSP' : 'CC';
  return (
    <div data-testid={`rsi-entry-control-${strategy.toLowerCase()}`}>
      <CriterionPills
        th={th}
        groupLabel={`${label} entry timing`}
        pills={[
          { key: 'off', label: 'Off', pressed: !settings.on, off: true, onSelect: () => onChange({ ...settings, on: false }) },
          { key: 'on', label: 'On', pressed: settings.on, onSelect: () => onChange({ ...settings, on: true }) },
        ]}
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <CriterionInput
          id="rsiLevel"
          label={isCsp ? 'Dip level' : 'Peak level'}
          ariaLabel={isCsp ? 'RSI dip level' : 'RSI peak level'}
          title={isCsp ? 'The daily RSI must have been at or below this within the window' : 'The daily RSI must have been at or above this within the window'}
          step="1"
          value={settings.level}
          onValueChange={value => set('level', value)}
          unit="RSI"
          error={errors.level}
        />
      </div>
      <details className="mt-2 text-[10px] text-neutral-400">
        <summary className="cursor-pointer font-bold text-neutral-300">Turn rule (advanced)</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          <CriterionInput id="rsiWindow" label="Window" ariaLabel="RSI window" title="How many latest daily RSI values are examined" step="1" value={settings.window} onValueChange={value => set('window', value)} unit="bars" error={errors.window} />
          <CriterionInput id="rsiLift" label={isCsp ? 'Lift' : 'Drop'} ariaLabel={isCsp ? 'RSI lift' : 'RSI drop'} title={isCsp ? 'Points the RSI must have risen off the dip' : 'Points the RSI must have fallen off the peak'} step="1" value={settings.lift} onValueChange={value => set('lift', value)} unit="points" error={errors.lift} />
          <CriterionInput id="rsiMid" label={isCsp ? 'Ceiling' : 'Floor'} ariaLabel={isCsp ? 'RSI ceiling' : 'RSI floor'} title={isCsp ? 'The turn must still be below this, so a bounce that has already run is Wait' : 'The turn must still be above this, so a fade that has already run is Wait'} step="1" value={settings.mid} onValueChange={value => set('mid', value)} unit="RSI" error={errors.mid} />
        </div>
      </details>
    </div>
  );
}
