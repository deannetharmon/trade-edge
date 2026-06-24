import re

path = "app/engine/page.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = """                  {[
                    { label: '4%', pct: 4 },
                    { label: '6%', pct: 6 },
                    { label: '8%', pct: 8 },
                  ] as { label: string; pct: number }[]).map(p => ("""

new = """                  {([
                    { label: '4%', pct: 4 },
                    { label: '6%', pct: 6 },
                    { label: '8%', pct: 8 },
                  ] as { label: string; pct: number }[]).map(p => ("""

if old not in content:
    raise SystemExit("ERROR: anchor text not found in app/engine/page.tsx — aborting, no changes made.")

count = content.count(old)
if count != 1:
    raise SystemExit(f"ERROR: anchor text found {count} times (expected exactly 1) — aborting, no changes made.")

content = content.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patched app/engine/page.tsx: added missing '(' before OTM floor buttons array literal (line ~3186).")
