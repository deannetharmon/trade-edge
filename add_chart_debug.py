#!/usr/bin/env python3
import sys

FILE_PATH = "app/engine/page.tsx"

with open(FILE_PATH, "r") as f:
    content = f.read()

old = """  const closeChart = () => setOpenChartSymbol(null);"""

new = """  const closeChart = () => { console.trace('[ChartDebug] closeChart called'); setOpenChartSymbol(null); };
  useEffect(() => { console.log('[ChartDebug] openChartSymbol changed to:', openChartSymbol); }, [openChartSymbol]);"""

count = content.count(old)
print(f"Found {count} occurrence(s)")

if count == 0:
    print("ERROR: not found")
    sys.exit(1)
elif count > 1:
    print(f"WARNING: {count} matches, expected 1")
    sys.exit(1)
else:
    content = content.replace(old, new, 1)
    with open(FILE_PATH, "w") as f:
        f.write(content)
    print("SUCCESS: diagnostic logging added")
