// features/portfolio/positions-workspace/HistoryStrip.tsx
//
// LEAPS-SPARK-0001 -- the History strip on a held LEAPS: three small lines (value, delta, stock) over the days the app has recorded the
// position. Presentational only: every series, colour and coordinate comes from lib/leaps-position-intelligence/sparklines.ts.

import { TEXT } from '@/components/dashboard/DashboardParts';
import { sparkPath, type Sparklines, type SparkSeries } from '@/lib/leaps-position-intelligence/sparklines';

const WIDTH = 120;
const HEIGHT = 32;
const STROKE: Record<SparkSeries['tone'], string> = { good: '#34d399', watch: '#fcd34d', bad: '#f87171', neutral: '#a3a3a3' };

function Line({ series }: { series: SparkSeries }) {
  const path = sparkPath(series.points, WIDTH, HEIGHT);
  const last = path.split(' ').pop()?.split(',').map(Number) ?? [0, 0];
  return (
    <svg role="img" aria-label={series.description} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-1 h-8 w-full" preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={STROKE[series.tone]} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={STROKE[series.tone]} />
    </svg>
  );
}

export function HistoryStrip({ sparklines, daysRecorded, th }: { sparklines: Sparklines | null; daysRecorded: number; th: { text: string } }) {
  if (!sparklines) {
    return (
      <p className="text-[10px] text-neutral-500" data-testid="history-strip">
        History fills in as the app records this position each day you open Portfolio ({daysRecorded} day{daysRecorded === 1 ? '' : 's'} recorded so far).
      </p>
    );
  }
  return (
    <div data-testid="history-strip">
      <p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">History · {sparklines.days} recorded days, {sparklines.firstDate} to {sparklines.lastDate}</p>
      <div className="grid grid-cols-3 gap-2">
        {sparklines.series.map(series => (
          <div key={series.id} className="rounded-lg border border-neutral-700 bg-neutral-900/60 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[9px] uppercase tracking-wider text-neutral-400">{series.label}</span>
              <span className={`text-[10px] ${TEXT[series.tone]}`}>{series.changeText}</span>
            </div>
            <div className={`font-mono text-sm font-semibold ${th.text}`}>{series.lastText}</div>
            <Line series={series} />
          </div>
        ))}
      </div>
    </div>
  );
}
