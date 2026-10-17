// lib/salvage/salvageDryRun.ts
//
// SALVAGE-0001 slice D -- reads a TastyTrade order dry-run response. Pure.
// The dry run is how Dane's open question is answered: whether the broker
// accepts the wing as covered by the held long, and what it asks of buying power.

export interface SalvageDryRunResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Positive = buying power the order uses; negative = frees buying power. Null when the broker did not say. */
  buyingPowerChange: number | null;
  fees: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const messages = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((e: any) => (typeof e === 'string' ? e : e?.message ?? e?.reason ?? '')).filter(Boolean) : [];

export function parseSalvageDryRun(httpOk: boolean, body: any): SalvageDryRunResult {
  const data = body?.data ?? {};
  const warnings = messages(data.warnings ?? body?.warnings);
  const errors = messages(data.errors ?? body?.errors);
  if (!httpOk) {
    const nested = Array.isArray(body?.error?.errors) ? body.error.errors.map((e: any) => `${e?.domain ?? ''} ${e?.reason ?? e?.message ?? ''}`.trim()) : [];
    const msg = body?.error?.message ?? body?.['error-message'] ?? (nested.length ? nested.join('; ') : null) ?? 'The broker rejected the order.';
    return { valid: false, errors: [msg, ...errors], warnings, buyingPowerChange: null, fees: null };
  }
  const bpe = data['buying-power-effect'];
  let bp = num(bpe?.['change-in-buying-power']);
  if (bp != null && String(bpe?.['change-in-buying-power-effect'] ?? '').toLowerCase() === 'credit') bp = -Math.abs(bp);
  else if (bp != null) bp = Math.abs(bp);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    buyingPowerChange: bp,
    fees: num(data['fee-calculation']?.['total-fees']),
  };
}
