'use client';

interface PricingVerificationPendingNoticeProps {
  verificationUnresolved: boolean;
  recommendationKind: string | null | undefined;
}

export function PricingVerificationPendingNotice({
  verificationUnresolved,
  recommendationKind,
}: PricingVerificationPendingNoticeProps) {
  if (!verificationUnresolved || recommendationKind === 'verify-pricing') return null;

  return (
    <div
      role="status"
      className="mx-4 mt-2 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-[10px] text-amber-300"
    >
      Pricing verification is still pending because current broker leg quotes are incomplete or unreliable.
    </div>
  );
}
