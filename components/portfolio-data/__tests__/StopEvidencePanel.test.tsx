import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DebitStopObservation, STOP_CLASSIFICATION_COPY, STOP_CONTROL_LABELS } from '../StopEvidencePanel';
import type { StopClassification } from '@/lib/portfolio/stopLossPolicy';

describe('stop presentation contract', () => {
  it('has an explicit control for every classification', () => {
    const expected: Record<StopClassification, string> = {
      NO_STOP: 'Add Stop', ALIGNED: 'Edit Stop', TOO_TIGHT: 'Verify/Adjust Stop', TOO_LOOSE: 'Adjust Stop',
      UNKNOWN_PROVENANCE: 'Verify Stop', INVALID: 'Repair Stop', NOT_EVALUATED: 'Retry Stop Check', UNSUPPORTED: 'Stop Workflow Unavailable',
    };
    expect(STOP_CONTROL_LABELS).toEqual(expected);
  });

  it('preserves the required neutral-state copy', () => {
    expect(STOP_CLASSIFICATION_COPY.NOT_EVALUATED).toBe('Stop not evaluated — required broker evidence is unavailable or ambiguous.');
    expect(STOP_CLASSIFICATION_COPY.UNSUPPORTED).toBe('Stop evaluation is not supported for this position structure.');
    expect(STOP_CLASSIFICATION_COPY.NO_STOP).toBe('No matching protective stop found.');
  });

  it('renders debit observation without any mutation control', () => {
    render(<DebitStopObservation position={{ stopAssessment: undefined } as any} />);
    expect(screen.getByText(/Debit stop observation only/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Stop not evaluated/)).toBeInTheDocument();
  });
});

