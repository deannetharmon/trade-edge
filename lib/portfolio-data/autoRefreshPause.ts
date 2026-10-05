// lib/portfolio-data/autoRefreshPause.ts

// PORTFOLIO-AUTOREFRESH-0001: order dialogs pause the Portfolio auto-refresh so prices never change under an order the trader
// is reviewing or submitting. Each open dialog holds one pause; the refresh runs only when none are held.

let held = 0;

/** Holds a pause until the returned release is called. Releasing twice is a no-op. */
export function acquireAutoRefreshPause(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = Math.max(0, held - 1);
  };
}

export function isAutoRefreshPaused(): boolean {
  return held > 0;
}

/** Test-only reset. */
export function resetAutoRefreshPausesForTest(): void {
  held = 0;
}
