// Writes a capture as CSS a person could paste into a stylesheet.

import { easingToCss } from './easingCss';
import { formatMs, formatNumber } from './format';
import { effectiveDelay, groupByShorthand, type PropertyGroup } from './groups';
import { flattenShapes } from './shapes';
import type { Capture, Easing, Keyframe, Shape, Track } from './types';

// ---------- Small helpers ----------

// A value could contain "*/" and end a comment early.
function safeInComment(text: string): string {
  return text.replaceAll('*/', '* /');
}

function selectorFor(capture: Capture, shape: Shape): string {
  const isRoot = shape.id === capture.root.id;
  const selector =
    isRoot && capture.source.selector.length > 0 ? capture.source.selector : shape.label;
  return selector.length > 0 ? selector : '.element';
}

function isLinear(easing: Easing): boolean {
  return easing.kind === 'linear';
}

// ---------- Which easing to write ----------

// CSS keyframes have an easing per keyframe only. A captured track can also
// have one over the whole effect (transitions, and element.animate()).
// With 2 keyframes the two mean the same, so the effect easing can be
// written as the keyframe's. With more keyframes CSS cannot express it.
function effectEasingFitsCss(track: Track): boolean {
  if (isLinear(track.timing.easing)) return true;
  const keyframeEasingsUnused = track.keyframes
    .slice(0, -1)
    .every((keyframe) => isLinear(keyframe.easing));
  return track.keyframes.length === 2 && keyframeEasingsUnused;
}

function segmentEasing(track: Track, keyframe: Keyframe): Easing {
  const useEffectEasing = !isLinear(track.timing.easing) && effectEasingFitsCss(track);
  return useEffectEasing ? track.timing.easing : keyframe.easing;
}

// The single easing of a 2-keyframe track, for transitions and tables.
export function trackEasingCss(track: Track): string {
  const first = track.keyframes[0];
  if (track.keyframes.length > 2 || first === undefined) return 'per keyframe';
  if (!effectEasingFitsCss(track)) {
    return `${easingToCss(track.timing.easing)} over ${easingToCss(first.easing)}`;
  }
  return easingToCss(segmentEasing(track, first));
}

// ---------- Transitions ----------

function transitionPart(group: PropertyGroup): string {
  const track = group.tracks[0];
  if (track === undefined) return '';
  const delayMs = effectiveDelay(track);
  const parts = [
    group.property,
    formatMs(track.timing.duration),
    trackEasingCss(track),
    ...(delayMs === 0 ? [] : [formatMs(delayMs)]),
  ];
  return parts.join(' ');
}

function transitionValuesComment(groups: PropertyGroup[]): string[] {
  const lines = groups.flatMap((group) => {
    const track = group.tracks[0];
    const from = track?.keyframes[0];
    const to = track?.keyframes[track.keyframes.length - 1];
    if (track === undefined || from === undefined || to === undefined) return [];
    const note = track.interrupted ? ' (duration was shortened by the browser)' : '';
    return [`     ${group.property}: ${from.value} -> ${to.value}${note}`];
  });
  return ['/* The transition runs when these values change:', ...lines.map(safeInComment), '*/'];
}

// ---------- Keyframe animations ----------

// Tracks that are written as one @keyframes rule.
type AnimationUnit = { shape: Shape; tracks: Track[] };

// Tracks can share a rule only if they share one timing, and agree on the
// easing wherever they have a keyframe at the same offset.
function canShareRule(tracks: Track[]): boolean {
  const first = tracks[0];
  if (first === undefined) return false;
  const sameTiming = tracks.every(
    (track) =>
      JSON.stringify(track.timing) === JSON.stringify(first.timing) &&
      track.startOffset === first.startOffset,
  );
  const easingAt = (track: Track, offset: number): string | null => {
    const keyframe = track.keyframes.find((candidate) => candidate.offset === offset);
    return keyframe === undefined ? null : easingToCss(segmentEasing(track, keyframe));
  };
  const sameEasings = tracks.every((track) =>
    track.keyframes.every((keyframe) =>
      tracks.every((other) => {
        const otherEasing = easingAt(other, keyframe.offset);
        return otherEasing === null || otherEasing === easingAt(track, keyframe.offset);
      }),
    ),
  );
  return sameTiming && sameEasings;
}

function animationUnits(shape: Shape, tracks: Track[]): AnimationUnit[] {
  const groupIds = Array.from(new Set(tracks.map((track) => track.groupId)));
  return groupIds.flatMap((id): AnimationUnit[] => {
    const members = tracks.filter((track) => track.groupId === id);
    // A null group id means "stands alone", and so does a group whose
    // tracks no longer fit one rule.
    if (id === null || !canShareRule(members)) {
      return members.map((track) => ({ shape, tracks: [track] }));
    }
    return [{ shape, tracks: members }];
  });
}

// The inside of a @keyframes rule. Two units with the same body share one
// rule, so three dots that differ only in delay do not repeat it three times.
function keyframesBody(unit: AnimationUnit): string[] {
  const offsets = Array.from(
    new Set(
      unit.tracks.flatMap((track) =>
        track.keyframes.filter((keyframe) => !keyframe.implicit).map((keyframe) => keyframe.offset),
      ),
    ),
  ).sort((first, second) => first - second);

  return offsets.flatMap((offset) => {
    const declarations = unit.tracks.flatMap((track) => {
      const keyframe = track.keyframes.find(
        (candidate) => candidate.offset === offset && !candidate.implicit,
      );
      return keyframe === undefined ? [] : [`    ${track.property}: ${keyframe.value};`];
    });
    const owner = unit.tracks.find((track) =>
      track.keyframes.some((keyframe) => keyframe.offset === offset),
    );
    const keyframe = owner?.keyframes.find((candidate) => candidate.offset === offset);
    const easingLine =
      offset === 1 || owner === undefined || keyframe === undefined
        ? []
        : [`    animation-timing-function: ${easingToCss(segmentEasing(owner, keyframe))};`];
    return [`  ${formatNumber(offset * 100)}% {`, ...declarations, ...easingLine, '  }'];
  });
}

function keyframesRule(name: string, unit: AnimationUnit): string[] {
  const first = unit.tracks[0];
  const warning =
    first !== undefined && !effectEasingFitsCss(first)
      ? [
          `/* The original also eases the whole animation with ${easingToCss(first.timing.easing)}.`,
          '   CSS keyframes cannot express that, so this is an approximation. */',
        ]
      : [];
  return [...warning, `@keyframes ${name} {`, ...keyframesBody(unit), '}'];
}

function animationPart(name: string, unit: AnimationUnit): string {
  const track = unit.tracks[0];
  if (track === undefined) return '';
  const timing = track.timing;
  const iterations =
    timing.iterations.kind === 'infinite' ? 'infinite' : formatNumber(timing.iterations.count);
  return [
    name,
    formatMs(timing.duration),
    'linear',
    formatMs(effectiveDelay(track)),
    iterations,
    timing.direction,
    timing.fill,
  ].join(' ');
}

// ---------- One shape, then the whole capture ----------

function declaration(name: string, parts: string[]): string[] {
  if (parts.length === 0) return [];
  if (parts.length === 1) return [`  ${name}: ${parts[0]};`];
  return [
    `  ${name}:`,
    ...parts.map((part, index) => `    ${part}${index === parts.length - 1 ? ';' : ','}`),
  ];
}

export function captureToCss(capture: Capture): string {
  const perShape = flattenShapes(capture.root)
    .map((shape) => {
      const tracks = capture.tracks.filter((track) => track.shapeId === shape.id);
      return {
        selector: selectorFor(capture, shape),
        transitions: groupByShorthand(tracks.filter((track) => track.origin === 'css-transition')),
        units: animationUnits(
          shape,
          tracks.filter((track) => track.origin !== 'css-transition'),
        ),
      };
    })
    .filter((entry) => entry.transitions.length > 0 || entry.units.length > 0);

  // One @keyframes rule per distinct body, numbered across the capture.
  const bodyOf = (unit: AnimationUnit): string => keyframesBody(unit).join('\n');
  const allUnits = perShape.flatMap((entry) => entry.units);
  const bodies = Array.from(new Set(allUnits.map(bodyOf)));
  const nameOf = (unit: AnimationUnit): string => `motion-${bodies.indexOf(bodyOf(unit)) + 1}`;
  // A rule is written just before the first shape that uses it.
  const introduces = (unit: AnimationUnit): boolean =>
    allUnits.find((other) => bodyOf(other) === bodyOf(unit)) === unit;

  const sections = perShape.map((entry, index) => {
    // Children have no selector of their own, only a label, so several can
    // share one. Say which is which.
    const sameSelector = perShape.filter((other) => other.selector === entry.selector);
    const position = perShape
      .slice(0, index + 1)
      .filter((other) => other.selector === entry.selector);
    const which =
      sameSelector.length > 1
        ? [
            `/* ${safeInComment(entry.selector)}, number ${position.length} of ${sameSelector.length} */`,
          ]
        : [];
    return [
      ...entry.units
        .filter(introduces)
        .flatMap((unit) => [...keyframesRule(nameOf(unit), unit), '']),
      ...which,
      `${entry.selector} {`,
      ...declaration('transition', entry.transitions.map(transitionPart)),
      ...declaration(
        'animation',
        entry.units.map((unit) => animationPart(nameOf(unit), unit)),
      ),
      '}',
      ...(entry.transitions.length > 0 ? transitionValuesComment(entry.transitions) : []),
    ].join('\n');
  });

  return sections.length === 0 ? '/* No animations to export. */' : sections.join('\n\n');
}
