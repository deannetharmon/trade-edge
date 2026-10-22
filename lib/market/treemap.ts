// lib/market/treemap.ts
//
// MARKET-MAP-0001: squarified treemap layout (Bruls, Huizing, van Wijk). Pure: items in, rectangles out. Tile area is proportional to
// value. Items with a non-positive or non-finite value are left out.

export interface Rect { x: number; y: number; w: number; h: number }
export interface TreeItem<T> { value: number; data: T }
export interface Placed<T> { item: TreeItem<T>; rect: Rect }

/** Worst aspect ratio in a row of `areas` laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((s, a) => s + a, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

export function squarify<T>(items: TreeItem<T>[], rect: Rect): Placed<T>[] {
  const positive = items.filter(i => Number.isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const out: Placed<T>[] = [];
  if (positive.length === 0 || !(rect.w > 0) || !(rect.h > 0)) return out;
  const total = positive.reduce((s, i) => s + i.value, 0);
  const scale = (rect.w * rect.h) / total;
  let remaining = positive.map(item => ({ item, area: item.value * scale }));
  let { x, y, w, h } = rect;

  while (remaining.length > 0) {
    const side = Math.min(w, h);
    const row = [remaining[0]];
    let rowArea = remaining[0].area;
    let i = 1;
    while (i < remaining.length) {
      const areas = row.map(r => r.area);
      if (worst([...areas, remaining[i].area], side) <= worst(areas, side)) { row.push(remaining[i]); rowArea += remaining[i].area; i++; }
      else break;
    }
    if (w >= h) {
      const colW = rowArea / h;
      let cy = y;
      for (const r of row) { const rh = r.area / colW; out.push({ item: r.item, rect: { x, y: cy, w: colW, h: rh } }); cy += rh; }
      x += colW; w -= colW;
    } else {
      const rowH = rowArea / w;
      let cx = x;
      for (const r of row) { const rw = r.area / rowH; out.push({ item: r.item, rect: { x: cx, y, w: rw, h: rowH } }); cx += rw; }
      y += rowH; h -= rowH;
    }
    remaining = remaining.slice(row.length);
  }
  return out;
}
