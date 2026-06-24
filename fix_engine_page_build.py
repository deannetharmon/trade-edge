path = "app/engine/page.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# ── Fix 1: Remove misplaced duplicate block inside EngineOrderModal ──
# A stray useEffect + duplicate timeline-helper block (belonging to EnginePage,
# not EngineOrderModal) was sitting between resolveWheelOption's useCallback
# and EngineOrderModal's actual return statement. It references runEngine,
# engineData, includeMargin — none of which exist in EngineOrderModal's scope —
# and breaks the parser well before it reaches the real JSX return.
old1 = """  }, [entry.symbol, entry.shortStrike, entry.dte, entry.optionType, entry.strategy, entry.credit, isWheelEntry]);

    useEffect(() => {
    runEngine();
  }, [runEngine]);

  const d = engineData;

  const formatCurrency = (value: number) => {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const allocationDollar = (pct: number) => {
    if (!d?.capital?.obp) return 0;
    const base = includeMargin ? d.capital.obp : d.capital.obpCash;
    return base * (pct / 100);
  };

  const allocationLabel = (pct: number) => {
    return d?.capital?.obp ? `$${formatCurrency(allocationDollar(pct))}` : '$—';
  };

  // ── Timeline date helpers ──────────────────────────────────────────────
  const today = new Date();
  const allTimelinePositions = [
    ...(d?.spxPositions ?? []),
    ...(d?.spyPositions ?? []),
  ];

  const earliestEntryDaysAgo = allTimelinePositions.reduce((max, pos) => {
    if (!pos.entryDate) return max;

    const entry = new Date(`${pos.entryDate}T00:00:00`);
    const daysAgo = Math.round(
      (today.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24)
    );

    return Math.max(max, daysAgo, 0);
  }, 0);

  const lookbackDays = Math.min(earliestEntryDaysAgo, 45);
  const forwardDays = 60;
  const timelineDays = lookbackDays + forwardDays;

  const timelineStart = new Date(today);
  timelineStart.setDate(timelineStart.getDate() - lookbackDays);

  const timelineDates: Date[] = [];

  for (let i = 0; i <= timelineDays; i += 7) {
    const dt = new Date(timelineStart);
    dt.setDate(dt.getDate() + i);
    timelineDates.push(dt);
  }

  const fmt = (dt: Date) => {
    return `${dt.toLocaleString('en', { month: 'short' })} ${dt.getDate()}`;
  };

  const dteFromAxisStart = (
    dateStr: string | null,
    fallbackDte: number,
    isEntry: boolean
  ): number => {
    if (dateStr) {
      const target = new Date(`${dateStr}T00:00:00`);
      return Math.round(
        (target.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return isEntry ? lookbackDays : lookbackDays + fallbackDte;
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4" onClick={onClose}>"""

new1 = """  }, [entry.symbol, entry.shortStrike, entry.dte, entry.optionType, entry.strategy, entry.credit, isWheelEntry]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4" onClick={onClose}>"""

if old1 not in content:
    raise SystemExit("ERROR: Fix 1 anchor not found — aborting, no changes made.")
if content.count(old1) != 1:
    raise SystemExit(f"ERROR: Fix 1 anchor found {content.count(old1)} times (expected 1) — aborting.")
content = content.replace(old1, new1, 1)

# ── Fix 2: Missing opening '(' before OTM floor buttons array type assertion ──
old2 = """                  {[
                    { label: '4%', pct: 4 },
                    { label: '6%', pct: 6 },
                    { label: '8%', pct: 8 },
                  ] as { label: string; pct: number }[]).map(p => ("""

new2 = """                  {([
                    { label: '4%', pct: 4 },
                    { label: '6%', pct: 6 },
                    { label: '8%', pct: 8 },
                  ] as { label: string; pct: number }[]).map(p => ("""

if old2 not in content:
    raise SystemExit("ERROR: Fix 2 anchor not found — aborting (Fix 1 was already written to disk).")
if content.count(old2) != 1:
    raise SystemExit(f"ERROR: Fix 2 anchor found {content.count(old2)} times (expected 1) — aborting.")
content = content.replace(old2, new2, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patched app/engine/page.tsx:")
print("  1) Removed misplaced duplicate useEffect/timeline-helper block inside EngineOrderModal")
print("  2) Added missing '(' before OTM floor buttons array literal")
