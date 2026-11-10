// M1 spike: a rough recorder that dumps what Chrome reports for every
// animation it sees under one root element. No picker, no snapshot.
//
// The goal is evidence, not a product: the data format in packages/core is
// locked from the output of this file. It never pauses, changes or restyles
// the page's animations. It only reads.

// The properties the editor will preview in v1. The list is fixed and short,
// so resting values for all of them can be read at pick time, before anything
// has been triggered.
const PREVIEWED_PROPERTIES = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'opacity',
  'background-color',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'width',
  'height',
  'box-shadow',
] as const;

const TRANSFORM_PROPERTIES = ['transform', 'translate', 'rotate', 'scale'];

const NON_PROPERTY_KEYS = ['offset', 'computedOffset', 'easing', 'composite'];

// Two ways to read one property from an element.
// "resolved" is getComputedStyle (transforms come back as a matrix).
// "computed" is the Typed OM computed value (transforms keep their functions).
export type StyleRead = { resolved: string; computed: string | null };

export type SpikeKeyframe = {
  offset: number | null;
  computedOffset: number;
  easing: string;
  composite: string;
  // Property names exactly as Chrome returns them (camelCase).
  properties: { name: string; cssName: string; value: string }[];
  // CSSStyleValue.parse() result for each transform-like property.
  typedOm: { cssName: string; parsed: unknown }[];
};

export type SpikeRecord = {
  constructorName: string;
  // "subtree": returned by root.getAnimations({ subtree: true }).
  // "shadow-root": only found by asking an open shadow root directly.
  foundVia: 'subtree' | 'shadow-root';
  transitionProperty: string | null;
  animationName: string | null;
  id: string;
  target: { tag: string; className: string; pathFromRoot: number[] } | null;
  pseudoElement: string | null;
  timelineType: string | null;
  playState: string;
  startTime: unknown;
  currentTime: unknown;
  firstSeenAtMs: number;
  // The document timeline's time when the animation was first seen.
  timelineTimeAtFirstSight: number | null;
  // animation.startTime once the animation is no longer pending.
  startTimeWhenReady: number | null;
  keyframes: SpikeKeyframe[];
  timing: unknown;
  computedTiming: unknown;
  // The target's own transition settings when the animation was first seen.
  transitionStyle: { property: string; duration: string; delay: string; timingFunction: string };
  // Three reads of each animated property, to compare (implicit keyframes).
  restingAtPick: { cssName: string; read: StyleRead }[];
  readAtFirstSight: { cssName: string; read: StyleRead }[];
  readAfterFinish: { cssName: string; read: StyleRead }[] | null;
};

export type SpikeEvent = {
  type: string;
  name: string;
  elapsedTime: number;
  atMs: number;
  targetClassName: string;
};

export type SpikeDump = {
  userAgent: string;
  records: SpikeRecord[];
  events: SpikeEvent[];
};

type Session = {
  root: Element;
  startedAt: number;
  seen: WeakSet<Animation>;
  records: SpikeRecord[];
  events: SpikeEvent[];
  resting: Map<Element, { cssName: string; read: StyleRead }[]>;
  frame: number;
  removeListeners: () => void;
};

let session: Session | null = null;

function camelToKebab(name: string): string {
  // getKeyframes() uses cssFloat and cssOffset to avoid clashing with keys.
  if (name === 'cssFloat') return 'float';
  if (name === 'cssOffset') return 'offset';
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function readStyle(element: Element, cssName: string): StyleRead {
  const resolved = getComputedStyle(element).getPropertyValue(cssName);
  const typed = element.computedStyleMap().get(cssName);
  return { resolved, computed: typed === undefined ? null : typed.toString() };
}

function readStyles(element: Element, cssNames: readonly string[]) {
  return cssNames.map((cssName) => ({ cssName, read: readStyle(element, cssName) }));
}

function describeNumeric(value: CSSNumberish): unknown {
  if (typeof value === 'number') return { value, unit: 'number' };
  if (value instanceof CSSUnitValue) return { value: value.value, unit: value.unit };
  return { math: value.toString() };
}

function describeComponent(component: CSSTransformComponent): unknown {
  const base = { is2D: component.is2D, text: component.toString() };
  if (component instanceof CSSTranslate) {
    return {
      type: 'CSSTranslate',
      x: describeNumeric(component.x),
      y: describeNumeric(component.y),
      z: describeNumeric(component.z),
      ...base,
    };
  }
  if (component instanceof CSSRotate) {
    return {
      type: 'CSSRotate',
      angle: describeNumeric(component.angle),
      x: describeNumeric(component.x),
      y: describeNumeric(component.y),
      z: describeNumeric(component.z),
      ...base,
    };
  }
  if (component instanceof CSSScale) {
    return {
      type: 'CSSScale',
      x: describeNumeric(component.x),
      y: describeNumeric(component.y),
      z: describeNumeric(component.z),
      ...base,
    };
  }
  if (component instanceof CSSSkew) {
    return {
      type: 'CSSSkew',
      ax: describeNumeric(component.ax),
      ay: describeNumeric(component.ay),
      ...base,
    };
  }
  if (component instanceof CSSSkewX) {
    return { type: 'CSSSkewX', ax: describeNumeric(component.ax), ...base };
  }
  if (component instanceof CSSSkewY) {
    return { type: 'CSSSkewY', ay: describeNumeric(component.ay), ...base };
  }
  if (component instanceof CSSPerspective) {
    return { type: 'CSSPerspective', ...base };
  }
  if (component instanceof CSSMatrixComponent) {
    return { type: 'CSSMatrixComponent', ...base };
  }
  return { type: 'unknown', ...base };
}

// Does CSS Typed OM give the transform as a list of functions?
function describeTyped(cssName: string, value: string): unknown {
  try {
    const parsed = CSSStyleValue.parse(cssName, value);
    if (parsed instanceof CSSTransformValue) {
      return { type: 'CSSTransformValue', components: Array.from(parsed, describeComponent) };
    }
    return { type: parsed.constructor.name, text: parsed.toString() };
  } catch (error) {
    return { type: 'error', message: String(error) };
  }
}

function toNumber(value: CSSNumberish | null): number | null {
  return typeof value === 'number' ? value : null;
}

function pathFromRoot(root: Element, element: Element): number[] {
  const path: number[] = [];
  let current: Element | null = element;
  while (current !== null && current !== root) {
    const parent: Element | null = current.parentElement;
    if (parent === null) break;
    path.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }
  return path;
}

function readKeyframes(effect: KeyframeEffect): SpikeKeyframe[] {
  return effect.getKeyframes().map((keyframe) => {
    const names = Object.keys(keyframe).filter((key) => !NON_PROPERTY_KEYS.includes(key));
    const properties = names.map((name) => ({
      name,
      cssName: camelToKebab(name),
      value: String(keyframe[name]),
    }));
    return {
      offset: keyframe.offset,
      computedOffset: keyframe.computedOffset,
      easing: keyframe.easing,
      composite: keyframe.composite,
      properties,
      typedOm: properties
        .filter((property) => TRANSFORM_PROPERTIES.includes(property.cssName))
        .map((property) => ({
          cssName: property.cssName,
          parsed: describeTyped(property.cssName, property.value),
        })),
    };
  });
}

function readAnimation(
  current: Session,
  animation: Animation,
  foundVia: SpikeRecord['foundVia'],
): SpikeRecord | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) return null;

  const target = effect.target;
  const keyframes = readKeyframes(effect);
  const animatedNames = Array.from(
    new Set(keyframes.flatMap((keyframe) => keyframe.properties.map((p) => p.cssName))),
  );
  const style = target === null ? null : getComputedStyle(target);

  const record: SpikeRecord = {
    constructorName: animation.constructor.name,
    foundVia,
    transitionProperty: animation instanceof CSSTransition ? animation.transitionProperty : null,
    animationName: animation instanceof CSSAnimation ? animation.animationName : null,
    id: animation.id,
    target:
      target === null
        ? null
        : {
            tag: target.tagName.toLowerCase(),
            className: target.getAttribute('class') ?? '',
            pathFromRoot: pathFromRoot(current.root, target),
          },
    pseudoElement: effect.pseudoElement,
    timelineType: animation.timeline === null ? null : animation.timeline.constructor.name,
    playState: animation.playState,
    startTime: animation.startTime,
    currentTime: animation.currentTime,
    firstSeenAtMs: performance.now() - current.startedAt,
    timelineTimeAtFirstSight: toNumber(document.timeline.currentTime),
    startTimeWhenReady: null,
    keyframes,
    timing: effect.getTiming(),
    computedTiming: effect.getComputedTiming(),
    transitionStyle: {
      property: style?.transitionProperty ?? '',
      duration: style?.transitionDuration ?? '',
      delay: style?.transitionDelay ?? '',
      timingFunction: style?.transitionTimingFunction ?? '',
    },
    restingAtPick: (target === null ? undefined : current.resting.get(target)) ?? [],
    readAtFirstSight: target === null ? [] : readStyles(target, animatedNames),
    readAfterFinish: null,
  };

  animation.ready.then(
    () => {
      record.startTimeWhenReady = toNumber(animation.startTime);
    },
    () => {
      // Cancelled before it started.
    },
  );

  // When the animation ends by itself (and does not fill forwards), the
  // element is back at rest. Read again, as the "true" resting value.
  if (target !== null) {
    animation.finished.then(
      () => {
        record.readAfterFinish = readStyles(target, animatedNames);
      },
      () => {
        // Cancelled (for example an interrupted transition). Nothing to read.
      },
    );
  }

  return record;
}

// Every open shadow root on the root element or inside it.
function shadowRootsUnder(root: Element): ShadowRoot[] {
  return [root, ...Array.from(root.querySelectorAll('*'))].flatMap((element) =>
    element.shadowRoot === null ? [] : [element.shadowRoot],
  );
}

function poll(): void {
  if (session === null) return;
  const current = session;
  const found: { animation: Animation; foundVia: SpikeRecord['foundVia'] }[] = [
    ...current.root
      .getAnimations({ subtree: true })
      .map((animation) => ({ animation, foundVia: 'subtree' as const })),
    ...shadowRootsUnder(current.root).flatMap((shadowRoot) =>
      shadowRoot
        .getAnimations()
        .map((animation) => ({ animation, foundVia: 'shadow-root' as const })),
    ),
  ];
  for (const { animation, foundVia } of found) {
    if (current.seen.has(animation)) continue;
    current.seen.add(animation);
    const record = readAnimation(current, animation, foundVia);
    if (record !== null) current.records.push(record);
  }
  current.frame = requestAnimationFrame(poll);
}

const EVENT_TYPES = [
  'transitionrun',
  'transitionstart',
  'transitionend',
  'transitioncancel',
  'animationstart',
  'animationiteration',
  'animationend',
  'animationcancel',
];

function listen(current: Session): () => void {
  const onEvent = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const name =
      event instanceof TransitionEvent
        ? event.propertyName
        : event instanceof AnimationEvent
          ? event.animationName
          : '';
    const elapsedTime =
      event instanceof TransitionEvent || event instanceof AnimationEvent ? event.elapsedTime : 0;
    current.events.push({
      type: event.type,
      name,
      elapsedTime,
      atMs: performance.now() - current.startedAt,
      targetClassName: target?.getAttribute('class') ?? '',
    });
  };
  for (const type of EVENT_TYPES) current.root.addEventListener(type, onEvent, true);
  return () => {
    for (const type of EVENT_TYPES) current.root.removeEventListener(type, onEvent, true);
  };
}

// Infinity and NaN do not survive JSON. Write them as strings so the dump
// shows exactly where Chrome returns them.
function jsonSafe<T>(value: T): T {
  const text = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'number' && !Number.isFinite(item) ? String(item) : item,
  );
  return JSON.parse(text) as T;
}

export function start(rootSelector: string): void {
  const root = document.querySelector(rootSelector);
  if (root === null) throw new Error(`Spike root not found: ${rootSelector}`);

  // "Pick time": read resting values before anything has been triggered.
  const resting: Session['resting'] = new Map();
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    resting.set(element, readStyles(element, PREVIEWED_PROPERTIES));
  }

  const current: Session = {
    root,
    startedAt: performance.now(),
    seen: new WeakSet(),
    records: [],
    events: [],
    resting,
    frame: 0,
    removeListeners: () => {},
  };
  current.removeListeners = listen(current);
  session = current;
  poll();
}

export function stop(): SpikeDump {
  if (session === null) throw new Error('Spike was not started');
  cancelAnimationFrame(session.frame);
  session.removeListeners();
  const dump: SpikeDump = {
    userAgent: navigator.userAgent,
    records: session.records,
    events: session.events,
  };
  session = null;
  return jsonSafe(dump);
}
