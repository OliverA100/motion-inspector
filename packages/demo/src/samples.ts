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
import type { Capture } from '@motion-inspector/core';

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
];

export function sampleById(id: string | null): { id: string; name: string; capture: Capture } {
  const first = samples[0];
  if (first === undefined) throw new Error('No samples');
  return samples.find((sample) => sample.id === id) ?? first;
}
