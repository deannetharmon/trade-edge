#!/bin/bash
set -e

git checkout feature/te-0007c-covered-call-screener
git pull --rebase origin feature/te-0007c-covered-call-screener

cat > /tmp/te0007c_jobkind_fix.py << 'PYEOF'
import sys
PATH = "lib/screener/screenerJobStore.ts"
with open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        print(f"ABORT: anchor '{label}' matched {count} times (expected exactly 1).")
        sys.exit(1)
    return text.replace(old, new, 1)

old = """export type ScreenerJobKind = 'filter' | 'rank' | 'targeted' | 'pmcc' | 'csp' | 'passive';"""
new = """export type ScreenerJobKind = 'filter' | 'rank' | 'targeted' | 'pmcc' | 'csp' | 'cc' | 'passive';"""

src = replace_once(src, old, new, "ScreenerJobKind union")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print("Patched lib/screener/screenerJobStore.ts")
PYEOF
python3 /tmp/te0007c_jobkind_fix.py

git add lib/screener/screenerJobStore.ts
git commit -m "TE-0007C fix: add 'cc' to ScreenerJobKind

Build failure: runCcScan() calls startScreenerJob({ kind: 'cc', ... }) but
ScreenerJobKind's union never included 'cc' (only 'csp' was added for
TE-0007A). Type error caught by Vercel's tsc pass, not by my earlier
isolated-harness test run, since screenerJobStore.ts wasn't part of that
harness. One-line fix."

git push origin feature/te-0007c-covered-call-screener

echo ""
echo "Pushed fix. Commit hash: $(git rev-parse HEAD)"
