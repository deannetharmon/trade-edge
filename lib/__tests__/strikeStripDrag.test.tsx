// lib/__tests__/strikeStripDrag.test.tsx
//
// Regression: dragging a strike-strip marker must survive the re-render each step causes. The marker's React key once
// included its strike, so the first step rebuilt the button and dropped the pointer grab (click worked, drag did not).

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StrikeStrip from '@/features/trade-map/StrikeStrip';
import type { StripMarker } from '@/lib/trademap/stripModel';

const STRIKES = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
const PX = 44; // 10 strikes -> min(44, floor(1000 / 10))
const xOf = (k: number) => STRIKES.indexOf(k) * PX + PX / 2;

function Harness({ log, startShort = 108 }: { log: number[]; startShort?: number }) {
  const [short, setShort] = useState(startShort);
  const [long, setLong] = useState(startShort - 4);
  const markers: StripMarker[] = [
    { strike: short, right: 'P', side: 'short', role: 'anchor' },
    { strike: long, right: 'P', side: 'long', role: 'width' },
  ];
  return (
    <StrikeStrip
      th={{ text: '', textFaint: '' }}
      strikes={STRIKES}
      spot={104.5}
      markers={markers}
      oi={{}}
      legInfo={[]}
      onMove={(role, k) => {
        if (role === 'anchor') { log.push(k); setShort(k); setLong(l => Math.min(l, k - 1)); }
        if (role === 'slide') { log.push(k); setLong(l => l + (k - short)); setShort(k); }
      }}
      onStep={() => {}}
    />
  );
}

// jsdom has no pointer capture; track it per DOM element like a browser does.
function installPointerCapture() {
  const held = new WeakSet<Element>();
  (HTMLElement.prototype as any).setPointerCapture = function () { held.add(this); };
  (HTMLElement.prototype as any).hasPointerCapture = function () { return held.has(this); };
}

const ptr = (el: Element, type: string, clientX: number, shiftKey = false) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, shiftKey }));

describe('StrikeStrip drag', () => {
  it('keeps following the pointer across several strike changes', () => {
    installPointerCapture();
    const log: number[] = [];
    render(<Harness log={log} />);
    const grab = () => screen.getByLabelText(/^Short \d+ put/);
    ptr(grab(), 'pointerdown', xOf(108));
    ptr(grab(), 'pointermove', xOf(106));
    ptr(grab(), 'pointermove', xOf(104));
    ptr(grab(), 'pointermove', xOf(102));
    expect(log).toEqual([106, 104, 102]);
  });

  it('shows the spread width in dollars', () => {
    render(<Harness log={[]} />);
    expect(screen.getByText('$4 wide')).toBeTruthy();
  });

  it('dragging the shaded band slides the whole spread and keeps the width', () => {
    installPointerCapture();
    const log: number[] = [];
    render(<Harness log={log} />);
    const band = () => screen.getByTestId('spread-band');
    ptr(band(), 'pointerdown', xOf(106)); // grab inside the band
    ptr(band(), 'pointermove', xOf(105));
    ptr(band(), 'pointermove', xOf(103));
    expect(log).toEqual([107, 105]);
    expect(screen.getByText('$4 wide')).toBeTruthy();
  });

  it('Shift-dragging the short circle slides the whole spread', () => {
    installPointerCapture();
    const log: number[] = [];
    render(<Harness log={log} />);
    const grab = () => screen.getByLabelText(/^Short \d+ put/);
    ptr(grab(), 'pointerdown', xOf(108), true);
    ptr(grab(), 'pointermove', xOf(106));
    expect(log).toEqual([106]);
    expect(screen.getByText('$4 wide')).toBeTruthy();
  });
});
