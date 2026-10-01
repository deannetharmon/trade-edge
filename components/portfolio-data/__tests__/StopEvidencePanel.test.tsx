import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DebitStopObservation, STOP_CLASSIFICATION_COPY, STOP_CONTROL_LABELS, stopReasonText } from '../StopEvidencePanel';
import type { StopClassification } from '@/lib/portfolio/stopLossPolicy';

describe('stop presentation contract', () => {
  it('has an explicit control for every classification', () => {
    const expected: Record<StopClassification, string> = {
      NO_STOP: 'Add Stop', ALIGNED: 'Edit Stop', TOO_TIGHT: 'Review Stop', TOO_LOOSE: 'Adjust Stop',
      UNKNOWN_PROVENANCE: 'Review Stop', INVALID: 'Review Stop', NOT_EVALUATED: 'Retry Stop Check', UNSUPPORTED: 'Stop Workflow Unavailable',
    };
    expect(STOP_CONTROL_LABELS).toEqual(expected);
  });

  it('preserves the required neutral-state copy', () => {
    expect(STOP_CLASSIFICATION_COPY.NOT_EVALUATED).toBe('Stop not evaluated — required broker evidence is unavailable or ambiguous.');
    expect(STOP_CLASSIFICATION_COPY.UNSUPPORTED).toBe('Stop evaluation is not supported for this position structure.');
    expect(STOP_CLASSIFICATION_COPY.NO_STOP).toBe('No matching protective stop found.');
  });

  it('renders debit observation as one plain line without any control', () => {
    render(<DebitStopObservation position={{ stopAssessment: undefined } as any} />);
    expect(screen.getByText(/Stop not evaluated/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('STOP-CARD-SIMPLIFY-0001: says plainly why an unsupported long option has no stop', () => {
    const unsupported = { classification: 'UNSUPPORTED', reasonCode: 'DEBIT_STRUCTURE_UNSUPPORTED' } as any;
    expect(stopReasonText(unsupported)).toBe('Stops are not available for this position type yet.');
    render(<DebitStopObservation position={{ stopAssessment: unsupported } as any} />);
    expect(screen.getByText('Stops are not available for this position type yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Stop Evidence/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('falls back to the classification copy for other reasons', () => {
    expect(stopReasonText({ classification: 'NOT_EVALUATED', reasonCode: 'X' } as any)).toBe(STOP_CLASSIFICATION_COPY.NOT_EVALUATED);
    expect(stopReasonText(null)).toBe(STOP_CLASSIFICATION_COPY.NOT_EVALUATED);
  });
});
