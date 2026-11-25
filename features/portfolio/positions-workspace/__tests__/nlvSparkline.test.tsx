// features/portfolio/positions-workspace/__tests__/nlvSparkline.test.tsx

// SPARKLINES-0001A: the Portfolio Value line. Axes and prior-close line show with enough data; a dashed placeholder shows
// without; and the box is built so it cannot make the tile taller (jsdom has no layout, so the structure is what is checked:
// flex-1 + min-h-0 on the box, everything inside absolutely positioned).

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NlvSparkline } from '../NlvSparkline';
import { buildNlvSpark } from '@/lib/portfolio-data/nlvSparkline';

const d = (date: string, netLiquidatingValue: number) => ({ date, netLiquidatingValue });
const spark = buildNlvSpark([d('2026-10-26', 27900), d('2026-11-10', 25700), d('2026-11-23', 26290)], '2026-11-24', 26452);

describe('NlvSparkline', () => {
  it('draws the line, the prior-close line, the value axis and the date axis', () => {
    render(<NlvSparkline spark={spark} />);
    expect(screen.getByTestId('nlv-line')).toBeTruthy();
    expect(screen.getByTestId('nlv-prior-close')).toBeTruthy();
    expect(screen.getByText('$27.9k')).toBeTruthy();
    expect(screen.getByText('$25.7k')).toBeTruthy();
    expect(screen.getByText('Oct 26')).toBeTruthy();
    expect(screen.getByText('Nov 24')).toBeTruthy();
  });

  it('puts the date and value in a hover title for each point', () => {
    const { container } = render(<NlvSparkline spark={spark} />);
    const titles = Array.from(container.querySelectorAll('title')).map(t => t.textContent);
    expect(titles).toContain('Nov 24 · $26,452');
  });

  it('shows a dashed placeholder, never a real-looking line, when there are fewer than 2 days', () => {
    render(<NlvSparkline spark={buildNlvSpark([], '2026-11-24', null)} />);
    expect(screen.getByTestId('nlv-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('nlv-line')).toBeNull();
    render(<NlvSparkline spark={null} />);
  });

  it('cannot grow the tile: the box has no height of its own and its content is absolutely positioned', () => {
    const { container } = render(<NlvSparkline spark={spark} />);
    const box = screen.getByTestId('nlv-spark');
    expect(box.className).toContain('flex-1');
    expect(box.className).toContain('min-h-0');
    expect(box.className).toContain('relative');
    expect((box.firstElementChild as HTMLElement).className).toContain('absolute');
    expect(container.querySelector('svg')?.getAttribute('height')).toBeNull();
  });
});
