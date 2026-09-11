// SCAN-RATE-LIMIT-0001 — shared read-rate-limiting and retry helpers for
// scan loops. Deliberately NOT wired into ttFetch itself: TastyTrade
// reads all funnel through that one shared function, so throttling it
// directly would rate-limit every scan type (PMCC, CSP, CC) at once.
// Ian/Paul approved a spreads-only pilot first — this utility is generic
// and reusable, but each scan loop opts in individually by wrapping its
// own read call sites with schedule()/withRetry(), so the blast radius
// stays exactly where it's approved to be.
//
// Numbers per TastyTrade's own suggested client-side ceiling (~60
// reads/minute) with real headroom under it, since that number is a
// suggested conservative cap, not a published guaranteed quota.

export interface ReadRateLimiterOptions {
  maxPerMinute?: number;
  maxConcurrent?: number;
}

export class ReadRateLimiter {
  private readonly maxPerMinute: number;
  private readonly maxConcurrent: number;
  private readonly timestamps: number[] = [];
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];
  private pendingCheck: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ReadRateLimiterOptions = {}) {
    this.maxPerMinute = opts.maxPerMinute ?? 45;
    this.maxConcurrent = opts.maxConcurrent ?? 6;
  }

  private prune(now: number): void {
    const cutoff = now - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) this.timestamps.shift();
  }

  private tryDispatch(): void {
    if (this.pendingCheck) {
      clearTimeout(this.pendingCheck);
      this.pendingCheck = null;
    }
    while (this.queue.length > 0) {
      const now = Date.now();
      this.prune(now);
      if (this.timestamps.length >= this.maxPerMinute) break;
      if (this.inFlight >= this.maxConcurrent) break;
      const next = this.queue.shift();
      if (!next) break;
      this.timestamps.push(now);
      this.inFlight += 1;
      next();
    }
    if (this.queue.length > 0) {
      const now = Date.now();
      this.prune(now);
      const waitForRateSlot = this.timestamps.length >= this.maxPerMinute
        ? (this.timestamps[0] + 60_000) - now
        : 50;
      this.pendingCheck = setTimeout(() => this.tryDispatch(), Math.max(waitForRateSlot, 50));
    }
  }

  /** Runs fn() once both a rate-window slot and a concurrency slot are
   * available. Safe to call many times concurrently -- callers do not
   * need to serialize their own calls to schedule(). */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          this.inFlight -= 1;
          this.tryDispatch();
        });
      });
      this.tryDispatch();
    });
  }
}

export function createReadRateLimiter(opts?: ReadRateLimiterOptions): ReadRateLimiter {
  return new ReadRateLimiter(opts);
}

function extractHttpStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  // ttFetch's own thrown message shape: `${path} failed (${res.status}): ...`
  const match = /failed \((\d{3})\)/.exec(message);
  return match ? Number(match[1]) : null;
}

/** Retry only on 429 and 5xx, per TastyTrade's documented guidance —
 * 400/403/404/422 are terminal and will fail again unchanged, so
 * retrying them only adds load for nothing. */
export function isRetryableStatus(status: number | null): boolean {
  return status === 429 || (status !== null && status >= 500 && status < 600);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; baseDelayMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const status = extractHttpStatus(error);
      if (attempt >= retries || !isRetryableStatus(status)) throw error;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}
