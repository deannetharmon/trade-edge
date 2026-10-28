// lib/screener/failReasonSummary.ts

// SCREENER-ROW-REASON-0001: the collapsed screener row shows a short label for each reason; the full sentence is on hover and in the expanded section.
const MAX_LEN = 48;

export function summarizeFailReason(reason: string): string {
  const capital = /^Insufficient CSP capacity\s+[—-]\s+requires \$([\d,.]+),\s*\$([\d,.]+) available/i.exec(reason);
  if (capital) return `Needs $${capital[1]} · $${capital[2]} available`;
  const lowIvr = /^Low IVR ([\d.]+)%/i.exec(reason);
  if (lowIvr) return `Low IVR ${lowIvr[1]}%`;
  const text = reason.trim();
  return text.length <= MAX_LEN ? text : `${text.slice(0, MAX_LEN - 1).trimEnd()}…`;
}

/** Up to `limit` short labels for the row, with the full reasons for the hover title. */
export function summarizeFailReasons(reasons: readonly string[], limit = 2): { text: string; title: string } {
  return { text: reasons.slice(0, limit).map(summarizeFailReason).join(' · '), title: reasons.join('\n') };
}
