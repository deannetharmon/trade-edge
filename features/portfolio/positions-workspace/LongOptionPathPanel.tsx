// features/portfolio/positions-workspace/LongOptionPathPanel.tsx

// LONG-OPTION-PATH-0001 -- the price path for a bought option: stock, strike, expiration breakeven, in price order, with
// the distance from the stock to each, what today's value is made of, and a plain-language status. Display only.

import type { LongOptionPath } from './model/longOptionPath';

const usd = (n: number) => `$${n.toFixed(2)}`;

export function LongOptionPathPanel({ path, textFaint }: { path: LongOptionPath; textFaint: string }) {
  const { symbol, kind } = path;
  const marks = [
    { id: 'stock', label: `${symbol} ${usd(path.stock)}`, price: path.stock, gap: null as string | null },
    { id: 'strike', label: `Strike ${usd(path.strike)}`, price: path.strike, gap: gapText(path.toStrike) },
    { id: 'breakeven', label: `Breakeven ${usd(path.breakeven)}`, price: path.breakeven, gap: gapText(path.toBreakeven) },
  ];
  // Left to right by price; a put reads right to left because its profit side is below the strike.
  const lo = Math.min(...marks.map(m => m.price));
  const hi = Math.max(...marks.map(m => m.price));
  const span = hi - lo || 1;
  const x = (price: number) => 8 + ((price - lo) / span) * 84; // percent, with room for labels
  const ordered = [...marks].sort((a, b) => a.price - b.price);
  return (
    <div data-testid="long-option-path" className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs text-white">{path.status}</p>
      <ol aria-label="Price path" className="relative mt-3 h-16" data-order={marks.map(m => m.id).join('>')}>
        <span aria-hidden className="absolute left-[4%] right-[4%] top-3 h-px bg-white/30" />
        {ordered.map(m => (
          <li key={m.id} data-testid={`path-${m.id}`} className="absolute -translate-x-1/2 text-center" style={{ left: `${x(m.price)}%` }}>
            <span aria-hidden className={`mx-auto block h-2.5 w-2.5 rounded-full ${m.id === 'stock' ? 'bg-sky-400' : m.id === 'strike' ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ marginTop: 7 }} />
            <span className="block whitespace-nowrap text-[10px] font-bold text-white">{m.label}</span>
            {m.gap && <span className={`block whitespace-nowrap text-[10px] ${textFaint}`}>{m.gap}</span>}
          </li>
        ))}
      </ol>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-white">
        <div><dt className={`text-[10px] ${textFaint}`}>Intrinsic value (locked in)</dt><dd className="font-bold">{usd(path.intrinsic)}</dd><dd className={`text-[10px] ${textFaint}`}>Begins at the strike</dd></div>
        <div><dt className={`text-[10px] ${textFaint}`}>Extrinsic value (future possibility)</dt><dd className="font-bold">{path.extrinsic === null ? '—' : usd(path.extrinsic)}</dd><dd className={`text-[10px] ${textFaint}`}>Profit at expiration begins {kind === 'C' ? 'above' : 'below'} strike {kind === 'C' ? '+' : '−'} premium paid ({usd(path.premium)})</dd></div>
      </dl>
    </div>
  );
}

function gapText(distance: number): string {
  if (Math.abs(distance) < 0.005) return 'at the stock';
  return distance > 0 ? `${usd(distance)} to go` : `${usd(-distance)} past`;
}
