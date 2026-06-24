#!/usr/bin/env python3
import sys

FILE_PATH = "app/portfolio/page.tsx"

with open(FILE_PATH, "r") as f:
    content = f.read()

original_content = content
applied = []
skipped = []

old_1 = """            {/* ── P&L ────────────────────────────────── */}
            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>
                {lifecycle.type === 'CSP' ? 'Cash Req' : 'Buyback'}
              </p>
              <p className={`text-xs font-bold ${lifecycle.type === 'CSP' ? 'text-amber-400' : th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {lifecycle.type === 'CSP' && cspCashRequired != null
                  ? `$${cspCashRequired.toLocaleString()}`
                  : pos.currentValue != null
                  ? `$${pos.currentValue.toFixed(2)}`
                  : '—'}
              </p>
            </div>

            {/* Max Risk — already computed in calculateMaxRisk (net of credit received) but
                previously never surfaced in the card for spread positions. CSP already shows
                its own capital requirement via Cash Req above, so this is spread-only. */}
            {lifecycle.type !== 'CSP' && (
              <div className="border-t-2 border-emerald-600/50 pt-1">
                <p className={`text-[9px] ${th.textFaint}`}>Max Risk</p>
                <p className="text-xs font-bold text-red-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${pos.maxRisk.toLocaleString()}
                </p>
              </div>
            )}

            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Credit</p>"""

new_1 = """            {/* ── P&L ────────────────────────────────── */}
            {/* Max Risk — already computed in calculateMaxRisk (net of credit received).
                CSP already shows its own capital requirement via Cash Req next to it, so
                this risk column is spread-only. Positioned right after Strikes so downside
                is established before Buyback/Credit, ahead of the value columns. */}
            {lifecycle.type !== 'CSP' && (
              <div className="border-t-2 border-emerald-600/50 pt-1">
                <p className={`text-[9px] ${th.textFaint}`}>Max Risk</p>
                <p className="text-xs font-bold text-red-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${pos.maxRisk.toLocaleString()}
                </p>
              </div>
            )}

            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>
                {lifecycle.type === 'CSP' ? 'Cash Req' : 'Buyback'}
              </p>
              <p className={`text-xs font-bold ${lifecycle.type === 'CSP' ? 'text-amber-400' : th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {lifecycle.type === 'CSP' && cspCashRequired != null
                  ? `$${cspCashRequired.toLocaleString()}`
                  : pos.currentValue != null
                  ? `$${pos.currentValue.toFixed(2)}`
                  : '—'}
              </p>
            </div>

            <div className="border-t-2 border-emerald-600/50 pt-1">
              <p className={`text-[9px] ${th.textFaint}`}>Credit</p>"""

old_2 = """gridTemplateColumns: '72px 120px 80px 70px 110px 80px 80px 90px 70px 50px 45px 45px 45px 55px 60px 90px 130px', gap: '0 12px', alignItems: 'start', minWidth: '1464px' """

new_2 = """gridTemplateColumns: '72px 120px 80px 70px 110px 80px 80px 90px 70px 50px 45px 45px 45px 55px 60px 90px 150px', gap: '0 12px', alignItems: 'start', minWidth: '1484px' """

old_3 = """              <span className={`text-[10px] font-bold ${ACTION_META[rec.action].color}`}>{ACTION_META[rec.action].label}</span>"""
new_3 = """              <span className={`text-[10px] font-bold whitespace-nowrap ${ACTION_META[rec.action].color}`}>{ACTION_META[rec.action].label}</span>"""

old_4 = """            return (
              <button key={action}
                onClick={e => { e.stopPropagation(); onExecute(pos, action); }}
                className={`text-[9px] px-2.5 py-1 border rounded font-bold transition-colors ${meta.btnClass}`}>
                {meta.label}
              </button>
            );"""

new_4 = """            return (
              <button key={action}
                onClick={e => { e.stopPropagation(); onExecute(pos, action); }}
                className={`text-[9px] px-2.5 py-1 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
                {meta.label}
              </button>
            );"""

old_5 = """          <button onClick={() => onGroupAction(positions, groupAction)}
            className={`text-[10px] px-3 py-1.5 border rounded font-bold transition-colors ${meta.btnClass}`}>
            {meta.label} All
          </button>"""

new_5 = """          <button onClick={() => onGroupAction(positions, groupAction)}
            className={`text-[10px] px-3 py-1.5 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
            {meta.label} All
          </button>"""

old_6 = """                <button key={action}
                  onClick={() => onExecute(selected.map(pos => ({ pos, action })))}
                  className={`text-[10px] px-3 py-1.5 border rounded font-bold transition-colors ${meta.btnClass}`}>
                  {meta.label}
                </button>"""

new_6 = """                <button key={action}
                  onClick={() => onExecute(selected.map(pos => ({ pos, action })))}
                  className={`text-[10px] px-3 py-1.5 border rounded font-bold whitespace-nowrap transition-colors ${meta.btnClass}`}>
                  {meta.label}
                </button>"""

fixes = [
    ("Move Max Risk column before Buyback/Cash Req", old_1, new_1),
    ("Widen Suggested column track to 150px", old_2, new_2),
    ("whitespace-nowrap on Suggested column label", old_3, new_3),
    ("whitespace-nowrap on per-position action button", old_4, new_4),
    ("whitespace-nowrap on group 'X All' button", old_5, new_5),
    ("whitespace-nowrap on sticky bulk-action bar buttons", old_6, new_6),
]

for name, old, new in fixes:
    count = content.count(old)
    if count == 0:
        skipped.append((name, "exact text not found"))
    elif count > 1:
        skipped.append((name, f"found {count} matches, expected 1"))
    else:
        content = content.replace(old, new, 1)
        applied.append(name)

print(f"\nApplied {len(applied)}/{len(fixes)} fixes:")
for name in applied:
    print(f"  [OK] {name}")

if skipped:
    print(f"\nSkipped {len(skipped)}:")
    for name, reason in skipped:
        print(f"  [SKIP] {name} -- {reason}")

if content == original_content:
    print("\nNo changes made.")
    sys.exit(1)

with open(FILE_PATH, "w") as f:
    f.write(content)

print(f"\nWrote changes to {FILE_PATH}")
