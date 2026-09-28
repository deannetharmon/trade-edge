// lib/screener/__tests__/ocrBatch.test.ts

import { describe, it, expect } from 'vitest';
import { extractTickerCandidatesFromImages, describeOcrBatch, MAX_OCR_IMAGES } from '../ocrBatch';

describe('extractTickerCandidatesFromImages', () => {
  it('merges and de-duplicates tickers across images in selection order', async () => {
    const images = [['AAPL', 'MSFT'], ['MSFT', 'KO'], ['AAPL', 'T']];
    const r = await extractTickerCandidatesFromImages(images, async x => x);
    expect(r.candidates).toEqual(['AAPL', 'MSFT', 'KO', 'T']);
    expect(r).toMatchObject({ processed: 3, skipped: 0, failed: 0 });
  });

  it('keeps selection order even when later images finish first', async () => {
    const delays = [30, 0, 10];
    const r = await extractTickerCandidatesFromImages([0, 1, 2], i =>
      new Promise(res => setTimeout(() => res([`T${i}`]), delays[i])));
    expect(r.candidates).toEqual(['T0', 'T1', 'T2']);
  });

  it('caps at 15 images and reports the rest as skipped', async () => {
    const files = Array.from({ length: 20 }, (_, i) => i);
    const seen: number[] = [];
    const r = await extractTickerCandidatesFromImages(files, async i => { seen.push(i); return []; });
    expect(MAX_OCR_IMAGES).toBe(15);
    expect(r.processed).toBe(15);
    expect(r.skipped).toBe(5);
    expect(seen.sort((a, b) => a - b)).toEqual(files.slice(0, 15));
  });

  it('never runs more than `concurrency` extractions at once', async () => {
    let active = 0; let peak = 0;
    await extractTickerCandidatesFromImages(Array.from({ length: 10 }, (_, i) => i), async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(res => setTimeout(res, 5));
      active--;
      return [];
    }, { concurrency: 3 });
    expect(peak).toBe(3);
  });

  it('keeps tickers from successful images when some fail', async () => {
    const r = await extractTickerCandidatesFromImages([1, 2, 3], async i => {
      if (i === 2) throw new Error('OpenAI error: 429');
      return [`T${i}`];
    });
    expect(r.candidates).toEqual(['T1', 'T3']);
    expect(r.failed).toBe(1);
    expect(r.firstError).toBe('OpenAI error: 429');
  });

  it('reports progress for every image', async () => {
    const calls: [number, number][] = [];
    await extractTickerCandidatesFromImages([1, 2, 3], async () => [], { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('handles an empty selection', async () => {
    const r = await extractTickerCandidatesFromImages([], async () => ['X']);
    expect(r).toMatchObject({ candidates: [], processed: 0, skipped: 0, failed: 0 });
  });
});

describe('describeOcrBatch', () => {
  const base = { candidates: [], processed: 3, skipped: 0, failed: 0, firstError: null };

  it('is silent on a clean batch', () => {
    expect(describeOcrBatch(base, 5)).toBeNull();
  });

  it('reports partial failures and skipped images together', () => {
    expect(describeOcrBatch({ ...base, processed: 15, skipped: 4, failed: 2 }, 10))
      .toBe('⚠ 2 of 15 images failed; only the first 15 images were used (4 skipped, max 15)');
  });

  it('reports a total failure with the error', () => {
    expect(describeOcrBatch({ ...base, failed: 3, firstError: 'boom' }, 0))
      .toBe('⚠ OCR failed for all 3 images: boom');
  });

  it('reports when no tickers were found', () => {
    expect(describeOcrBatch(base, 0)).toBe('⚠ no tickers found');
  });
});
