// lib/screener/ocrBatch.ts

// Multi-image OCR import for the Opportunity Universe watchlist.
// Pure batching logic (cap, bounded concurrency, partial-failure
// accounting); the per-image extractor is injected so this stays testable
// without fetch/FileReader.

export const MAX_OCR_IMAGES = 15;
export const OCR_CONCURRENCY = 3;

export interface OcrBatchResult {
  /** Unique ticker candidates across all successful images, first-seen order. */
  candidates: string[];
  /** Images actually processed (after the cap). */
  processed: number;
  /** Images dropped because the selection exceeded the cap. */
  skipped: number;
  /** Processed images whose extraction threw. */
  failed: number;
  /** First error message, for surfacing when every image failed. */
  firstError: string | null;
}

export async function extractTickerCandidatesFromImages<T>(
  files: T[],
  extractOne: (file: T) => Promise<string[]>,
  opts: { max?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<OcrBatchResult> {
  const max = opts.max ?? MAX_OCR_IMAGES;
  const concurrency = Math.max(1, opts.concurrency ?? OCR_CONCURRENCY);
  const batch = files.slice(0, max);
  const skipped = Math.max(0, files.length - batch.length);

  // Results kept per index so the merged order follows selection order,
  // not completion order.
  const perImage: (string[] | null)[] = new Array(batch.length).fill(null);
  let failed = 0;
  let firstError: string | null = null;
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < batch.length) {
      const i = next++;
      try {
        perImage[i] = await extractOne(batch[i]);
      } catch (err: any) {
        failed++;
        if (firstError == null) firstError = err?.message ?? String(err);
      }
      done++;
      opts.onProgress?.(done, batch.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const list of perImage) {
    for (const t of list ?? []) {
      if (!seen.has(t)) { seen.add(t); candidates.push(t); }
    }
  }

  return { candidates, processed: batch.length, skipped, failed, firstError };
}

export type OcrPhase = 'reading' | 'verifying';

export interface OcrStatus {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

/** Live progress line, e.g. "Reading images… 4 of 15". */
export function describeOcrProgress(phase: OcrPhase, done: number, total: number): string {
  const noun = phase === 'reading'
    ? (total === 1 ? 'image' : 'images')
    : (total === 1 ? 'ticker' : 'tickers');
  return `${phase === 'reading' ? 'Reading' : 'Verifying'} ${noun}… ${done} of ${total}`;
}

/** Whole-number percent for the progress bar, clamped 0-100. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Final status line for the import box after a batch completes. */
export function describeOcrBatch(result: OcrBatchResult, validCount: number): OcrStatus {
  const plural = (n: number, w: string) => `${n} ${w}${n !== 1 ? 's' : ''}`;
  if (result.processed > 0 && result.failed === result.processed) {
    return { tone: 'error', text: `⚠ OCR failed for all ${plural(result.processed, 'image')}${result.firstError ? `: ${result.firstError}` : ''}` };
  }
  const issues: string[] = [];
  if (result.failed > 0) issues.push(`${result.failed} of ${result.processed} images failed`);
  if (result.skipped > 0) issues.push(`${result.skipped} skipped (max ${MAX_OCR_IMAGES})`);
  const head = validCount > 0 ? `✓ ${plural(validCount, 'ticker')} found` : '⚠ No tickers found';
  const text = [head, ...issues].join(' · ');
  return { tone: validCount === 0 ? 'warn' : issues.length ? 'warn' : 'ok', text };
}
