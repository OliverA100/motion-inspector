// parseCapture: from any value to a valid Capture, or a list of readable
// errors. It never throws.
//
// This is the only way a Capture gets into the app: from the capture
// script, from storage, or from pasted JSON. Each parse function below
// checks one type from types.ts and builds a fresh value, so unknown extra
// fields are dropped and every number has gone through its constructor.

import { cubicBezier, linear, linearPoints, steps } from './easing';
import {
  delay,
  duration,
  finite,
  groupId,
  iterationCount,
  offset,
  shapeId,
  unitInterval,
} from './numbers';
import { allOk, andThen, at, errorsOf, fail, failAll, ok, type Result } from './result';
import { flattenShapes } from './shapes';
import type {
  Capture,
  Easing,
  GroupId,
  Iterations,
  Keyframe,
  ParsedValue,
  Shape,
  StepPosition,
  Timing,
  Track,
  TransformFunction,
} from './types';

// ---------- Readers for plain values ----------

type Fields = Record<string, unknown>;

function fields(value: unknown): Result<Fields> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('Expected an object.');
  }
  return ok(value as Fields);
}

// Reads one field. A missing field reads as undefined, which every reader
// below rejects with its own message.
function get(source: Fields, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function text(value: unknown): Result<string> {
  return typeof value === 'string' ? ok(value) : fail('Expected text.');
}

function number(value: unknown): Result<number> {
  return typeof value === 'number' ? finite(value) : fail('Expected a number.');
}

function notNegative(value: unknown): Result<number> {
  return andThen(number(value), (checked) =>
    checked < 0 ? fail(`Expected zero or more. Got ${checked}.`) : ok(checked),
  );
}

function boolean(value: unknown): Result<boolean> {
  return typeof value === 'boolean' ? ok(value) : fail('Expected true or false.');
}

function list(value: unknown): Result<unknown[]> {
  return Array.isArray(value) ? ok(value) : fail('Expected a list.');
}

function oneOf<Option extends string>(value: unknown, options: readonly Option[]): Result<Option> {
  const match = options.find((option) => option === value);
  return match === undefined ? fail(`Expected one of: ${options.join(', ')}.`) : ok(match);
}

// Parses every item of a list, and says which item an error came from.
function listOf<Item>(
  value: unknown,
  parseItem: (item: unknown) => Result<Item>,
): Result<Item[]> {
  return andThen(list(value), (items) =>
    allOk(items.map((item, index) => at(`[${index}]`, parseItem(item)))),
  );
}

// ---------- Easing ----------

const STEP_POSITIONS: readonly StepPosition[] = ['start', 'end', 'jump-none', 'jump-both'];

function parsePoint(value: unknown): Result<{ input: number; output: number }> {
  return andThen(fields(value), (source) => {
    const input = at('input', number(get(source, 'input')));
    const output = at('output', number(get(source, 'output')));
    if (!input.ok || !output.ok) return failAll([...errorsOf(input), ...errorsOf(output)]);
    return ok({ input: input.value, output: output.value });
  });
}

export function parseEasingData(value: unknown): Result<Easing> {
  return andThen(fields(value), (source): Result<Easing> => {
    const kind = get(source, 'kind');
    if (kind === 'linear') return ok(linear);
    if (kind === 'cubic-bezier') {
      const x1 = at('x1', number(get(source, 'x1')));
      const y1 = at('y1', number(get(source, 'y1')));
      const x2 = at('x2', number(get(source, 'x2')));
      const y2 = at('y2', number(get(source, 'y2')));
      if (!x1.ok || !y1.ok || !x2.ok || !y2.ok) {
        return failAll([x1, y1, x2, y2].flatMap(errorsOf));
      }
      return cubicBezier(x1.value, y1.value, x2.value, y2.value);
    }
    if (kind === 'steps') {
      const count = at('count', number(get(source, 'count')));
      const position = at('position', oneOf(get(source, 'position'), STEP_POSITIONS));
      if (!count.ok || !position.ok) return failAll([...errorsOf(count), ...errorsOf(position)]);
      return steps(count.value, position.value);
    }
    if (kind === 'linear-points') {
      return andThen(at('points', listOf(get(source, 'points'), parsePoint)), linearPoints);
    }
    return fail('kind: Expected one of: linear, cubic-bezier, steps, linear-points.');
  });
}

// ---------- Parsed values ----------

function parseTransformFunction(value: unknown): Result<TransformFunction> {
  return andThen(fields(value), (source): Result<TransformFunction> => {
    const fn = get(source, 'fn');
    if (fn === 'translate' || fn === 'scale') {
      const x = at('x', number(get(source, 'x')));
      const y = at('y', number(get(source, 'y')));
      if (!x.ok || !y.ok) return failAll([...errorsOf(x), ...errorsOf(y)]);
      return ok({ fn, x: x.value, y: y.value });
    }
    if (fn === 'rotate') {
      const deg = at('deg', number(get(source, 'deg')));
      return deg.ok ? ok({ fn, deg: deg.value }) : deg;
    }
    if (fn === 'skew') {
      const xDeg = at('xDeg', number(get(source, 'xDeg')));
      const yDeg = at('yDeg', number(get(source, 'yDeg')));
      if (!xDeg.ok || !yDeg.ok) return failAll([...errorsOf(xDeg), ...errorsOf(yDeg)]);
      return ok({ fn, xDeg: xDeg.value, yDeg: yDeg.value });
    }
    return fail('fn: Expected one of: translate, scale, rotate, skew.');
  });
}

function colorChannel(value: unknown): Result<number> {
  return andThen(number(value), (checked) =>
    checked < 0 || checked > 255 ? fail(`Expected 0 to 255. Got ${checked}.`) : ok(checked),
  );
}

function parseParsedValue(value: unknown): Result<ParsedValue | null> {
  if (value === null) return ok(null);
  return andThen(fields(value), (source): Result<ParsedValue | null> => {
    const kind = get(source, 'kind');
    if (kind === 'number' || kind === 'percent') {
      const amount = at('value', number(get(source, 'value')));
      return amount.ok ? ok({ kind, value: amount.value }) : amount;
    }
    if (kind === 'length') {
      const px = at('px', number(get(source, 'px')));
      return px.ok ? ok({ kind, px: px.value }) : px;
    }
    if (kind === 'color') {
      const r = at('r', colorChannel(get(source, 'r')));
      const g = at('g', colorChannel(get(source, 'g')));
      const b = at('b', colorChannel(get(source, 'b')));
      const a = at('a', andThen(number(get(source, 'a')), unitInterval));
      if (!r.ok || !g.ok || !b.ok || !a.ok) return failAll([r, g, b, a].flatMap(errorsOf));
      return ok({ kind, r: r.value, g: g.value, b: b.value, a: a.value });
    }
    if (kind === 'transform') {
      const functions = at('functions', listOf(get(source, 'functions'), parseTransformFunction));
      return functions.ok ? ok({ kind, functions: functions.value }) : functions;
    }
    return fail('kind: Expected one of: number, length, percent, color, transform.');
  });
}

// ---------- Keyframes and timing ----------

function parseKeyframe(value: unknown): Result<Keyframe> {
  return andThen(fields(value), (source) => {
    const keyframeOffset = at('offset', andThen(number(get(source, 'offset')), offset));
    const cssValue = at('value', text(get(source, 'value')));
    const parsed = at('parsed', parseParsedValue(get(source, 'parsed')));
    const easing = at('easing', parseEasingData(get(source, 'easing')));
    const implicit = at('implicit', boolean(get(source, 'implicit')));
    if (!keyframeOffset.ok || !cssValue.ok || !parsed.ok || !easing.ok || !implicit.ok) {
      return failAll([keyframeOffset, cssValue, parsed, easing, implicit].flatMap(errorsOf));
    }
    return ok({
      offset: keyframeOffset.value,
      value: cssValue.value,
      parsed: parsed.value,
      easing: easing.value,
      implicit: implicit.value,
    });
  });
}

// The rules a list of keyframes has to follow as a whole.
function checkKeyframeOrder(keyframes: Keyframe[]): Result<Keyframe[]> {
  if (keyframes.length < 2) return fail('A track needs at least 2 keyframes.');
  const sorted = keyframes.every(
    (keyframe, index) => index === 0 || keyframe.offset >= (keyframes[index - 1]?.offset ?? 0),
  );
  const errors = [
    ...(keyframes[0]?.offset === 0 ? [] : ['The first keyframe must be at offset 0.']),
    ...(keyframes[keyframes.length - 1]?.offset === 1
      ? []
      : ['The last keyframe must be at offset 1.']),
    ...(sorted ? [] : ['Keyframe offsets must never decrease.']),
  ];
  return errors.length > 0 ? failAll(errors) : ok(keyframes);
}

function parseIterations(value: unknown): Result<Iterations> {
  return andThen(fields(value), (source): Result<Iterations> => {
    const kind = get(source, 'kind');
    if (kind === 'infinite') return ok({ kind });
    if (kind === 'count') {
      const count = at('count', andThen(number(get(source, 'count')), iterationCount));
      return count.ok ? ok({ kind, count: count.value }) : count;
    }
    return fail('kind: Expected one of: count, infinite.');
  });
}

const DIRECTIONS = ['normal', 'reverse', 'alternate', 'alternate-reverse'] as const;
const FILLS = ['none', 'forwards', 'backwards', 'both'] as const;

export function parseTiming(value: unknown): Result<Timing> {
  return andThen(fields(value), (source) => {
    const timingDelay = at('delay', andThen(number(get(source, 'delay')), delay));
    const timingDuration = at('duration', andThen(number(get(source, 'duration')), duration));
    const iterations = at('iterations', parseIterations(get(source, 'iterations')));
    const direction = at('direction', oneOf(get(source, 'direction'), DIRECTIONS));
    const fill = at('fill', oneOf(get(source, 'fill'), FILLS));
    const easing = at('easing', parseEasingData(get(source, 'easing')));
    if (
      !timingDelay.ok ||
      !timingDuration.ok ||
      !iterations.ok ||
      !direction.ok ||
      !fill.ok ||
      !easing.ok
    ) {
      return failAll(
        [timingDelay, timingDuration, iterations, direction, fill, easing].flatMap(errorsOf),
      );
    }
    return ok({
      delay: timingDelay.value,
      duration: timingDuration.value,
      iterations: iterations.value,
      direction: direction.value,
      fill: fill.value,
      easing: easing.value,
    });
  });
}

// ---------- Tracks ----------

const ORIGINS = ['css-transition', 'css-animation', 'web-animation'] as const;

function parseGroupId(value: unknown): Result<GroupId | null> {
  if (value === null) return ok(null);
  return andThen(text(value), groupId);
}

function parseProperty(value: unknown): Result<string> {
  return andThen(text(value), (name) =>
    name.length === 0 ? fail('A property name cannot be empty.') : ok(name),
  );
}

export function parseTrack(value: unknown): Result<Track> {
  return andThen(fields(value), (source) => {
    const id = at('shapeId', andThen(text(get(source, 'shapeId')), shapeId));
    const property = at('property', parseProperty(get(source, 'property')));
    const origin = at('origin', oneOf(get(source, 'origin'), ORIGINS));
    const group = at('groupId', parseGroupId(get(source, 'groupId')));
    const startOffset = at(
      'startOffset',
      andThen(number(get(source, 'startOffset')), duration),
    );
    const interrupted = at('interrupted', boolean(get(source, 'interrupted')));
    const keyframes = at(
      'keyframes',
      andThen(listOf(get(source, 'keyframes'), parseKeyframe), checkKeyframeOrder),
    );
    const timing = at('timing', parseTiming(get(source, 'timing')));
    if (
      !id.ok ||
      !property.ok ||
      !origin.ok ||
      !group.ok ||
      !startOffset.ok ||
      !interrupted.ok ||
      !keyframes.ok ||
      !timing.ok
    ) {
      return failAll(
        [id, property, origin, group, startOffset, interrupted, keyframes, timing].flatMap(
          errorsOf,
        ),
      );
    }
    return ok({
      shapeId: id.value,
      property: property.value,
      origin: origin.value,
      groupId: group.value,
      startOffset: startOffset.value,
      interrupted: interrupted.value,
      keyframes: keyframes.value,
      timing: timing.value,
    });
  });
}

// ---------- Shapes ----------

const SHAPE_KINDS = ['box', 'text', 'image'] as const;

// A page can nest elements deeply, but a snapshot keeps about 40 boxes.
// The limit keeps a hostile input from overflowing the call stack.
const MAX_SHAPE_DEPTH = 32;

function parseBox(value: unknown): Result<Shape['box']> {
  return andThen(fields(value), (source) => {
    const x = at('x', number(get(source, 'x')));
    const y = at('y', number(get(source, 'y')));
    const width = at('width', notNegative(get(source, 'width')));
    const height = at('height', notNegative(get(source, 'height')));
    if (!x.ok || !y.ok || !width.ok || !height.ok) {
      return failAll([x, y, width, height].flatMap(errorsOf));
    }
    return ok({ x: x.value, y: y.value, width: width.value, height: height.value });
  });
}

function parseRadius(value: unknown): Result<Shape['radius']> {
  return andThen(listOf(value, notNegative), (corners): Result<Shape['radius']> => {
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    if (
      corners.length !== 4 ||
      topLeft === undefined ||
      topRight === undefined ||
      bottomRight === undefined ||
      bottomLeft === undefined
    ) {
      return fail('Expected 4 numbers, one per corner.');
    }
    return ok([topLeft, topRight, bottomRight, bottomLeft]);
  });
}

function parseFill(value: unknown): Result<string | null> {
  return value === null ? ok(null) : text(value);
}

function parseStroke(value: unknown): Result<Shape['stroke']> {
  if (value === null) return ok(null);
  return andThen(fields(value), (source) => {
    const color = at('color', text(get(source, 'color')));
    const width = at('width', notNegative(get(source, 'width')));
    if (!color.ok || !width.ok) return failAll([...errorsOf(color), ...errorsOf(width)]);
    return ok({ color: color.value, width: width.value });
  });
}

function parsePoint2d(value: unknown): Result<{ x: number; y: number }> {
  return andThen(fields(value), (source) => {
    const x = at('x', number(get(source, 'x')));
    const y = at('y', number(get(source, 'y')));
    if (!x.ok || !y.ok) return failAll([...errorsOf(x), ...errorsOf(y)]);
    return ok({ x: x.value, y: y.value });
  });
}

function parseShapeAtDepth(value: unknown, depth: number): Result<Shape> {
  if (depth > MAX_SHAPE_DEPTH) return fail(`Shapes are nested more than ${MAX_SHAPE_DEPTH} deep.`);
  return andThen(fields(value), (source) => {
    const id = at('id', andThen(text(get(source, 'id')), shapeId));
    const label = at('label', text(get(source, 'label')));
    const kind = at('kind', oneOf(get(source, 'kind'), SHAPE_KINDS));
    const box = at('box', parseBox(get(source, 'box')));
    const radius = at('radius', parseRadius(get(source, 'radius')));
    const fill = at('fill', parseFill(get(source, 'fill')));
    const stroke = at('stroke', parseStroke(get(source, 'stroke')));
    const opacity = at('opacity', andThen(number(get(source, 'opacity')), unitInterval));
    const transformOrigin = at('transformOrigin', parsePoint2d(get(source, 'transformOrigin')));
    const children = at(
      'children',
      listOf(get(source, 'children'), (child) => parseShapeAtDepth(child, depth + 1)),
    );
    if (
      !id.ok ||
      !label.ok ||
      !kind.ok ||
      !box.ok ||
      !radius.ok ||
      !fill.ok ||
      !stroke.ok ||
      !opacity.ok ||
      !transformOrigin.ok ||
      !children.ok
    ) {
      return failAll(
        [id, label, kind, box, radius, fill, stroke, opacity, transformOrigin, children].flatMap(
          errorsOf,
        ),
      );
    }
    return ok({
      id: id.value,
      label: label.value,
      kind: kind.value,
      box: box.value,
      radius: radius.value,
      fill: fill.value,
      stroke: stroke.value,
      opacity: opacity.value,
      transformOrigin: transformOrigin.value,
      children: children.value,
    });
  });
}

export function parseShape(value: unknown): Result<Shape> {
  return parseShapeAtDepth(value, 0);
}

// ---------- Capture ----------

function parseSource(value: unknown): Result<Capture['source']> {
  return andThen(fields(value), (source) => {
    const url = at('url', text(get(source, 'url')));
    const selector = at('selector', text(get(source, 'selector')));
    const capturedAt = at('capturedAt', text(get(source, 'capturedAt')));
    if (!url.ok || !selector.ok || !capturedAt.ok) {
      return failAll([url, selector, capturedAt].flatMap(errorsOf));
    }
    return ok({ url: url.value, selector: selector.value, capturedAt: capturedAt.value });
  });
}

// Rules that involve more than one part of the capture.
function checkReferences(capture: Capture): Result<Capture> {
  const ids = flattenShapes(capture.root).map((shape) => shape.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unknown = capture.tracks.flatMap((track, index) =>
    ids.includes(track.shapeId)
      ? []
      : [`tracks[${index}].shapeId: No shape has the id "${track.shapeId}".`],
  );
  const errors = [
    ...Array.from(new Set(duplicates)).map((id) => `root: The shape id "${id}" is used twice.`),
    ...unknown,
  ];
  return errors.length > 0 ? failAll(errors) : ok(capture);
}

export function parseCapture(value: unknown): Result<Capture> {
  return andThen(fields(value), (source) => {
    const captureSource = at('source', parseSource(get(source, 'source')));
    const root = at('root', parseShape(get(source, 'root')));
    const tracks = at('tracks', listOf(get(source, 'tracks'), parseTrack));
    const notShown = at('notShown', listOf(get(source, 'notShown'), text));
    if (!captureSource.ok || !root.ok || !tracks.ok || !notShown.ok) {
      return failAll([captureSource, root, tracks, notShown].flatMap(errorsOf));
    }
    return checkReferences({
      source: captureSource.value,
      root: root.value,
      tracks: tracks.value,
      notShown: notShown.value,
    });
  });
}

// From JSON text. JSON.parse is the one function used in core that throws,
// so this is the one try/catch.
export function parseCaptureJson(json: string): Result<Capture> {
  try {
    return parseCapture(JSON.parse(json));
  } catch {
    return fail('This is not valid JSON.');
  }
}
