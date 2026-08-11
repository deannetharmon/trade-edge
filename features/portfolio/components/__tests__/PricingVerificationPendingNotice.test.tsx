import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PricingVerificationPendingNotice } from '../PricingVerificationPendingNotice';

describe('PricingVerificationPendingNotice', () => {
  it('surfaces unresolved pricing as a secondary warning when another action is primary', () => {
    render(
      <PricingVerificationPendingNotice
        verificationUnresolved
        recommendationKind="assignment-risk"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Pricing verification is still pending because current broker leg quotes are incomplete or unreliable.',
    );
  });

  it('does not duplicate the primary Verify Pricing disposition', () => {
    const { container } = render(
      <PricingVerificationPendingNotice
        verificationUnresolved
        recommendationKind="verify-pricing"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once verification is resolved', () => {
    const { container } = render(
      <PricingVerificationPendingNotice
        verificationUnresolved={false}
        recommendationKind="hold"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
