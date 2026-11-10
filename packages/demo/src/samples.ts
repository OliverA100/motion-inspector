// The sample captures the demo site offers, by name.

import {
  bounce,
  buttonHover,
  cardLift,
  dots,
  interruptedHover,
  linearSpring,
  loader,
  morph,
  staggerList,
  stepsSample,
} from '@motion-inspector/core/src/samples';
import { parseCapture, type Capture } from '@motion-inspector/core';

// ---------- Stress samples: not real captures, made to test the limits ----------

function built(raw: unknown): Capture {
  const parsed = parseCapture(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return parsed.value;
}

const source = {
  url: 'http://localhost:5173/fixtures.html',
  selector: 'div.stress',
  capturedAt: '2026-11-12T00:00:00.000Z',
};

function box(
  id: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: unknown[] = [],
) {
  return {
    id,
    label,
    kind: 'box',
    box: { x, y, width, height },
    radius: [3, 3, 3, 3],
    fill: children.length > 0 ? null : '#2f6fed',
    stroke: null,
    opacity: 1,
    transformOrigin: { x: width / 2, y: height / 2 },
    children,
  };
}

const HUNDRED = Array.from({ length: 50 }, (_item, index) => index);

// 50 shapes with 2 tracks each: 100 tracks.
const hundredTracks = built({
  source,
  root: box(
    'root',
    'div.stress',
    0,
    0,
    238,
    118,
    HUNDRED.map((index) =>
      box(`cell-${index}`, 'span.cell', (index % 10) * 24, Math.floor(index / 10) * 24, 22, 22),
    ),
  ),
  tracks: HUNDRED.flatMap((index) =>
    [
      { property: 'transform', from: 'scale(0.4)', to: 'none' },
      { property: 'opacity', from: '0.2', to: '1' },
    ].map((change) => ({
      shapeId: `cell-${index}`,
      property: change.property,
      origin: 'css-transition',
      groupId: null,
      startOffset: 0,
      interrupted: false,
      keyframes: [
        {
          offset: 0,
          value: change.from,
          parsed: null,
          easing: { kind: 'linear' },
          implicit: false,
        },
        { offset: 1, value: change.to, parsed: null, easing: { kind: 'linear' }, implicit: false },
      ],
      timing: {
        delay: index * 12,
        duration: 400,
        iterations: { kind: 'count', count: 1 },
        direction: 'normal',
        fill: 'backwards',
        easing: { kind: 'cubic-bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
      },
    })),
  ),
  notShown: [],
});

// Nothing could be drawn, and a selector far longer than any panel.
const LONG_SELECTOR =
  'main#app > section.marketing-hero__container--with-a-very-long-modifier-name > div.card-grid__item.card-grid__item--featured.is-visible:nth-child(3)';

const nothingCaptured = built({
  source: { ...source, selector: LONG_SELECTOR },
  root: box('root', LONG_SELECTOR, 0, 0, 160, 90),
  tracks: [],
  notShown: [
    'A shine sweep on ::after cannot be drawn, because it runs on a pseudo-element.',
    'A scroll-driven animation cannot be drawn, because it follows the scroll position, not time.',
  ],
});

export const samples: { id: string; name: string; capture: Capture }[] = [
  { id: 'card-lift', name: 'Card lift', capture: cardLift },
  { id: 'button-hover', name: 'Button hover', capture: buttonHover },
  { id: 'stagger-list', name: 'Staggered list', capture: staggerList },
  { id: 'loader', name: 'Loader', capture: loader },
  { id: 'bounce', name: 'Bounce', capture: bounce },
  { id: 'dots', name: 'Staggered dots', capture: dots },
  { id: 'morph', name: 'Color and radius morph', capture: morph },
  { id: 'steps', name: 'Steps', capture: stepsSample },
  { id: 'linear-spring', name: 'Linear easing', capture: linearSpring },
  { id: 'interrupted', name: 'Interrupted hover', capture: interruptedHover },
  { id: 'hundred', name: 'Stress: 100 tracks', capture: hundredTracks },
  { id: 'nothing', name: 'Stress: nothing captured', capture: nothingCaptured },
];

export function sampleById(id: string | null): { id: string; name: string; capture: Capture } {
  const first = samples[0];
  if (first === undefined) throw new Error('No samples');
  return samples.find((sample) => sample.id === id) ?? first;
}
