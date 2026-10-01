import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { EconomicUnderlyingExposureGroups } from '../EconomicUnderlyingExposureGroups';
import type { LeveragedPositionExposureGroup } from '@/lib/portfolio/leveragedPositionExposure';

const complete: LeveragedPositionExposureGroup = {
  economicUnderlying: 'NVDA',
  normalizationAuthoritative: true,
  grossBullishExposure: 7500,
  grossBearishExposure: 1000,
  grossExposure: 8500,
  netDirectionalExposure: 6500,
  capitalDeployed: 900,
  members: [
    {
      positionKey: 'nvda',
      symbol: 'NVDA',
      strategy: 'BPS',
      economicUnderlying: 'NVDA',
      leverageMultiplier: 1,
      signedEffectiveExposure: 5000,
      capitalDeployed: 500,
      normalizationAuthoritative: true,
      reason: null,
    },
    {
      positionKey: 'nvdu',
      symbol: 'NVDU',
      strategy: 'BPS',
      economicUnderlying: 'NVDA',
      leverageMultiplier: 2,
      signedEffectiveExposure: 2500,
      capitalDeployed: 400,
      normalizationAuthoritative: true,
      reason: null,
    },
  ],
};

describe('Gate 8 EconomicUnderlyingExposureGroups', () => {
  it('keeps gross bullish, gross bearish, net, and capital distinct', () => {
    render(<EconomicUnderlyingExposureGroups groups={[complete]} th={THEMES.dark} />);
    expect(screen.getByText('NVDA Exposure Group')).toBeInTheDocument();
    expect(screen.getByText('Gross bullish')).toBeInTheDocument();
    expect(screen.getByText('$7,500')).toBeInTheDocument();
    expect(screen.getByText('Gross bearish')).toBeInTheDocument();
    expect(screen.getByText('$1,000')).toBeInTheDocument();
    expect(screen.getByText('Net directional')).toBeInTheDocument();
    expect(screen.getByText('$6,500')).toBeInTheDocument();
    expect(screen.getByText('Capital deployed')).toBeInTheDocument();
    expect(screen.getByText('$900')).toBeInTheDocument();
    expect(screen.getByText(/NVDU · BPS · 2×/)).toBeInTheDocument();
  });

  it('fails closed in presentation when any member is incomplete', () => {
    render(<EconomicUnderlyingExposureGroups groups={[{
      ...complete,
      normalizationAuthoritative: false,
      grossBullishExposure: null,
      grossBearishExposure: null,
      grossExposure: null,
      netDirectionalExposure: null,
      capitalDeployed: null,
      members: [{ ...complete.members[0], normalizationAuthoritative: false, signedEffectiveExposure: null, reason: 'Missing delta.' }],
    }]} th={THEMES.dark} />);

    expect(screen.getByText('Normalization Incomplete')).toBeInTheDocument();
    expect(screen.getByText(/Authoritative group totals are unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Unavailable/).length).toBeGreaterThan(0);
  });

  it('renders nothing when no leveraged-related group exists', () => {
    const { container } = render(<EconomicUnderlyingExposureGroups groups={[]} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });
});
