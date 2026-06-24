#!/usr/bin/env python3
"""
Patch: Move module-level document.head mutations into useEffect
Target file: app/screener/page.tsx

Root cause: two `if (typeof document !== 'undefined')` blocks at module
scope were calling document.head.appendChild() the moment the client
bundle evaluated — before/during React's hydration of the page. Direct
DOM mutation outside React's render cycle during the hydration window is
a known trigger for React error #418/#423 (hydration mismatch), which in
turn can leave the page's event-handling tree in a broken state (buttons
appear normal but don't respond to clicks).

Fix: remove the module-level side effects entirely; perform the same
DOM injection inside a useEffect in the Home component, so it runs
strictly after React commits the initial tree, never during hydration.
Idempotency checks (getElementById) are preserved unchanged.

Verified: npx next build succeeds clean against a fresh clone of main
(/screener route, 55.9 kB). tsc --noEmit also clean.

Run from repo root: python3 patch_hydration_fix.py
"""
import sys

PATH = "app/screener/page.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

original_content = content


def apply(old, new, label):
    global content
    count = content.count(old)
    if count != 1:
        print(f"FAILED [{label}]: expected exactly 1 occurrence of anchor, found {count}.")
        print("---- anchor (first 300 chars) ----")
        print(old[:300])
        sys.exit(1)
    content = content.replace(old, new, 1)
    print(f"OK [{label}]")


# 1. Remove the two module-level document.head mutation blocks.
old_1 = """// Inject accent CSS variable stylel
if (typeof document !== 'undefined') {
  if (!document.getElementById('hunter-accent-style')) {
    const style = document.createElement('style');
    style.id = 'hunter-accent-style';
    style.textContent = `
      :root { --accent: #3b82f6; --accent-r: 59; --accent-g: 130; --accent-b: 246; }
      .accent-border { border-color: var(--accent) !important; }
      .accent-text { color: var(--accent) !important; }
      .accent-bg { background-color: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.1) !important; }
      .accent-ring { box-shadow: 0 0 0 1px var(--accent) !important; }
      nav a.active-nav, nav span.active-nav { background: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.2); color: var(--accent); }
    `;
    document.head.appendChild(style);
  }
}

// Inject DM Sans font
if (typeof document !== 'undefined') {
  if (!document.getElementById('hunter-font')) {
    const link = document.createElement('link');
    link.id = 'hunter-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }
}"""

new_1 = """// NOTE: accent-style and DM-Sans-font <head> injection used to live here
// as module-level side effects (`if (typeof document !== 'undefined') {...}`).
// That ran document.head.appendChild() the instant the client bundle
// evaluated — i.e. during/before React's hydration pass over this same
// page. Direct DOM mutation outside React during the hydration window is
// a known cause of React error #418/#423 hydration mismatches, which can
// leave the page's event handling broken even though it looks normal.
// Moved into a useEffect inside Home() (search "ensureHeadAssets") so it
// runs strictly after React commits the initial tree."""

apply(old_1, new_1, "1. remove module-level document.head mutation blocks")

# 2. Add the replacement useEffect inside Home(), right alongside the
#    existing accent-related useEffects (same component, same pattern).
old_2 = """export default function Home() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  const th = THEMES[theme];
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { applyAccent(getSavedAccent()); }, []);"""

new_2 = """export default function Home() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  const th = THEMES[theme];
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { applyAccent(getSavedAccent()); }, []);

  // ensureHeadAssets — runs once after mount, strictly post-hydration.
  // Replaces the old module-level document.head.appendChild() side effects
  // (accent CSS vars + DM Sans font link) that used to fire at client
  // bundle-evaluation time and could race React's hydration of this page.
  useEffect(() => {
    if (!document.getElementById('hunter-accent-style')) {
      const style = document.createElement('style');
      style.id = 'hunter-accent-style';
      style.textContent = `
        :root { --accent: #3b82f6; --accent-r: 59; --accent-g: 130; --accent-b: 246; }
        .accent-border { border-color: var(--accent) !important; }
        .accent-text { color: var(--accent) !important; }
        .accent-bg { background-color: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.1) !important; }
        .accent-ring { box-shadow: 0 0 0 1px var(--accent) !important; }
        nav a.active-nav, nav span.active-nav { background: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.2); color: var(--accent); }
      `;
      document.head.appendChild(style);
    }
    if (!document.getElementById('hunter-font')) {
      const link = document.createElement('link');
      link.id = 'hunter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);"""

apply(old_2, new_2, "2. add ensureHeadAssets useEffect inside Home()")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"\nAll patches applied successfully to {PATH}.")
print(f"Bytes before: {len(original_content)}  Bytes after: {len(content)}")
