#!/usr/bin/env python3
import sys

FILE_PATH = "app/portfolio/page.tsx"

with open(FILE_PATH, "r") as f:
    content = f.read()

original_content = content
applied = []
skipped = []

old_a = """gridTemplateColumns: '72px 120px 80px 70px 110px 80px 80px 90px 70px 50px 45px 45px 45px 55px 60px 90px 150px', gap: '0 12px', alignItems: 'start', minWidth: '1484px' """

new_a = """gridTemplateColumns: '72px 120px 80px 70px 110px 80px 80px 90px 70px 50px 45px 45px 45px 55px 60px 80px 90px 150px', gap: '0 12px', alignItems: 'start', minWidth: '1564px' """

old_b = """            {lifecycle.type !== 'CSP' && (
              <div className="border-t-2 border-emerald-600/50 pt-1">
                <p className={`text-[9px] ${th.textFaint}`}>Max Risk</p>
                <p className="text-xs font-bold text-red-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${pos.maxRisk.toLocaleString()}
                </p>
              </div>
            )}"""

new_b = """            {lifecycle.type !== 'CSP' ? (
              <div className="border-t-2 border-emerald-600/50 pt-1">
                <p className={`text-[9px] ${th.textFaint}`}>Max Risk</p>
                <p className="text-xs font-bold text-red-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ${pos.maxRisk.toLocaleString()}
                </p>
              </div>
            ) : (
              <div className="border-t-2 border-emerald-600/50 pt-1" />
            )}"""

fixes = [
    ("Add 18th grid track for Max Risk, bump minWidth to 1564px", old_a, new_a),
    ("Always render Max Risk div (empty placeholder for CSP)", old_b, new_b),
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
