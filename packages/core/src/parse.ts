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
  Gradient,
  GroupId,
  IconPath,
  Measured,
  Follow,
  FollowChannel,
  PointerSample,
  ShapeId,
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
function listOf<Item>(value: unknown, parseItem: (item: unknown) => Result<Item>): Result<Item[]> {
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
    if (kind === 'number') {
      const amount = at('value', number(get(source, 'value')));
      return amount.ok ? ok({ kind, value: amount.value }) : amount;
    }
    if (kind === 'percent') {
      const amount = at('value', number(get(source, 'value')));
      // Takes saved before "of" was read have none. They still load.
      const rawOf = get(source, 'of');
      const of = at('of', rawOf === undefined || rawOf === null ? ok(null) : notNegative(rawOf));
      if (!amount.ok || !of.ok) return failAll([amount, of].flatMap(errorsOf));
      return ok({ kind, value: amount.value, of: of.value });
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

const TRIGGERS = [
  'hover',
  'leave',
  'hover-and-leave',
  'click',
  'focus',
  'blur',
  'key',
  'loop',
  'running',
  'unknown',
] as const;

const ORIGINS = ['css-transition', 'css-animation', 'web-animation', 'layout', 'script'] as const;

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
    const startOffset = at('startOffset', andThen(number(get(source, 'startOffset')), duration));
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

const SHAPE_KINDS = ['box', 'text', 'image', 'path', 'group'] as const;

// Takes saved before a field existed have none. They still load, with null.
function optional<Value>(
  value: unknown,
  parseValue: (value: unknown) => Result<Value>,
): Result<Value | null> {
  return value === undefined || value === null ? ok(null) : parseValue(value);
}

export const MOST_GRADIENT_STOPS = 32;

function parseStop(value: unknown): Result<Gradient['stops'][number]> {
  return andThen(fields(value), (source) => {
    const color = at('color', text(get(source, 'color')));
    const position = at('at', andThen(number(get(source, 'at')), unitInterval));
    if (!color.ok || !position.ok) return failAll([color, position].flatMap(errorsOf));
    return ok({ color: color.value, at: position.value });
  });
}

function parseTile(value: unknown): Result<NonNullable<Gradient['tile']>> {
  return andThen(parseBox(value), (box) =>
    andThen(fields(value), (source) => {
      const raw = get(source, 'repeat');
      const repeat = at('repeat', raw === undefined ? ok(true) : boolean(raw));
      return repeat.ok ? ok({ ...box, repeat: repeat.value }) : repeat;
    }),
  );
}

function parseGradient(value: unknown): Result<Gradient> {
  return andThen(fields(value), (source): Result<Gradient> => {
    const kind = at('kind', oneOf(get(source, 'kind'), ['linear', 'radial'] as const));
    const stops = at(
      'stops',
      andThen(listOf(get(source, 'stops'), parseStop), (list) =>
        list.length < 2 || list.length > MOST_GRADIENT_STOPS
          ? fail(`Expected 2 to ${MOST_GRADIENT_STOPS} stops.`)
          : ok(list),
      ),
    );
    // Takes saved before the tile was read have none: the gradient fills the box.
    const tile = at('tile', optional(get(source, 'tile'), parseTile));
    if (!kind.ok || !stops.ok || !tile.ok) return failAll([kind, stops, tile].flatMap(errorsOf));
    if (kind.value === 'radial')
      return ok({ kind: 'radial', stops: stops.value, tile: tile.value });
    const angle = at('angle', number(get(source, 'angle')));
    return angle.ok
      ? ok({ kind: 'linear', angle: angle.value, stops: stops.value, tile: tile.value })
      : angle;
  });
}

export const MOST_WORDS = 64;

function parseWord(value: unknown): Result<{ x: number; width: number }> {
  return andThen(fields(value), (source) => {
    const x = at('x', number(get(source, 'x')));
    const width = at('width', notNegative(get(source, 'width')));
    if (!x.ok || !width.ok) return failAll([x, width].flatMap(errorsOf));
    return ok({ x: x.value, width: width.value });
  });
}

function parseWords(value: unknown): Result<{ x: number; width: number }[]> {
  return andThen(listOf(value, parseWord), (words) =>
    words.length > MOST_WORDS ? fail(`At most ${MOST_WORDS} words in a line.`) : ok(words),
  );
}

function parseShadow(value: unknown): Result<NonNullable<Shape['shadow']>> {
  return andThen(fields(value), (source) => {
    const color = at('color', text(get(source, 'color')));
    const x = at('x', number(get(source, 'x')));
    const y = at('y', number(get(source, 'y')));
    const blur = at('blur', notNegative(get(source, 'blur')));
    if (!color.ok || !x.ok || !y.ok || !blur.ok)
      return failAll([color, x, y, blur].flatMap(errorsOf));
    return ok({ color: color.value, x: x.value, y: y.value, blur: blur.value });
  });
}

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

type Sides = [string, string, string, string];
const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;

function parseSides(value: unknown): Result<Sides> {
  return andThen(listOf(value, text), (colors): Result<Sides> => {
    const [top, right, bottom, left] = colors;
    if (
      colors.length !== 4 ||
      top === undefined ||
      right === undefined ||
      bottom === undefined ||
      left === undefined
    ) {
      return fail('Expected 4 colors, one per side.');
    }
    return ok([top, right, bottom, left]);
  });
}

function parseStroke(value: unknown): Result<Shape['stroke']> {
  if (value === null) return ok(null);
  return andThen(fields(value), (source) => {
    const color = at('color', text(get(source, 'color')));
    const width = at('width', notNegative(get(source, 'width')));
    // Takes saved before sides were read have none. They still load.
    const rawSides = get(source, 'sides');
    const sides = at(
      'sides',
      rawSides === undefined || rawSides === null ? ok(null) : parseSides(rawSides),
    );
    // Takes saved before the style was read are solid.
    const rawStyle = get(source, 'style');
    const style = at(
      'style',
      rawStyle === undefined ? ok('solid' as const) : oneOf(rawStyle, BORDER_STYLES),
    );
    if (!color.ok || !width.ok || !sides.ok || !style.ok) {
      return failAll([color, width, sides, style].flatMap(errorsOf));
    }
    return ok({ color: color.value, width: width.value, sides: sides.value, style: style.value });
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

// An icon outline is kept small: a page could put a huge path in an SVG.
export const MOST_ICON_PATHS = 64;
export const LONGEST_PATH_DATA = 50000;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const LINE_CAPS = ['butt', 'round', 'square'] as const;
const FILL_RULES = ['nonzero', 'evenodd'] as const;
const LINE_JOINS = ['miter', 'round', 'bevel'] as const;

function parsePathData(value: unknown): Result<string> {
  return andThen(text(value), (d) =>
    d.length > LONGEST_PATH_DATA
      ? fail(`Path data is longer than ${LONGEST_PATH_DATA} characters.`)
      : PATH_DATA.test(d)
        ? ok(d)
        : fail('Path data can hold only path commands and numbers.'),
  );
}

function parseMatrix(value: unknown): Result<IconPath['matrix']> {
  return andThen(listOf(value, number), (numbers): Result<IconPath['matrix']> => {
    const [a, b, c, d, e, f] = numbers;
    if (
      numbers.length !== 6 ||
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined ||
      e === undefined ||
      f === undefined
    ) {
      return fail('Expected 6 numbers.');
    }
    return ok([a, b, c, d, e, f]);
  });
}

function parseIconStroke(value: unknown): Result<IconPath['stroke']> {
  if (value === null) return ok(null);
  return andThen(fields(value), (source) => {
    const color = at('color', text(get(source, 'color')));
    const width = at('width', notNegative(get(source, 'width')));
    const cap = at('cap', oneOf(get(source, 'cap'), LINE_CAPS));
    const join = at('join', oneOf(get(source, 'join'), LINE_JOINS));
    if (!color.ok || !width.ok || !cap.ok || !join.ok) {
      return failAll([color, width, cap, join].flatMap(errorsOf));
    }
    return ok({ color: color.value, width: width.value, cap: cap.value, join: join.value });
  });
}

function parseDash(value: unknown): Result<NonNullable<IconPath['dash']>> {
  return andThen(fields(value), (source) => {
    const array = at(
      'array',
      andThen(listOf(get(source, 'array'), notNegative), (list) =>
        list.length > 16 ? fail('At most 16 dash lengths.') : ok(list),
      ),
    );
    const offset = at('offset', number(get(source, 'offset')));
    if (!array.ok || !offset.ok) return failAll([array, offset].flatMap(errorsOf));
    return ok({ array: array.value, offset: offset.value });
  });
}

function parseIconPath(value: unknown): Result<IconPath> {
  return andThen(fields(value), (source) => {
    const d = at('d', parsePathData(get(source, 'd')));
    const matrix = at('matrix', parseMatrix(get(source, 'matrix')));
    const fill = at('fill', parseFill(get(source, 'fill')));
    const stroke = at('stroke', parseIconStroke(get(source, 'stroke')));
    const followsText = at('followsText', boolean(get(source, 'followsText')));
    const dash = at('dash', optional(get(source, 'dash'), parseDash));
    // Takes saved before the fill rule was read use the default.
    const rawRule = get(source, 'fillRule');
    const fillRule = at(
      'fillRule',
      rawRule === undefined ? ok('nonzero' as const) : oneOf(rawRule, FILL_RULES),
    );
    if (
      !d.ok ||
      !matrix.ok ||
      !fill.ok ||
      !stroke.ok ||
      !followsText.ok ||
      !dash.ok ||
      !fillRule.ok
    ) {
      return failAll([d, matrix, fill, stroke, followsText, dash, fillRule].flatMap(errorsOf));
    }
    return ok({
      d: d.value,
      matrix: matrix.value,
      fill: fill.value,
      fillRule: fillRule.value,
      stroke: stroke.value,
      dash: dash.value,
      followsText: followsText.value,
    });
  });
}

// Takes saved before icons were copied have no icon field. They still load.
function parseIcon(value: unknown): Result<Shape['icon']> {
  if (value === null || value === undefined) return ok(null);
  return andThen(listOf(value, parseIconPath), (paths) =>
    paths.length > MOST_ICON_PATHS
      ? fail(`An icon can have at most ${MOST_ICON_PATHS} parts.`)
      : ok(paths),
  );
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
    const clip = at('clip', boolean(get(source, 'clip')));
    const icon = at('icon', parseIcon(get(source, 'icon')));
    const transform = at('transform', optional(get(source, 'transform'), parseMatrix));
    const shadow = at('shadow', optional(get(source, 'shadow'), parseShadow));
    const clipPath = at('clipPath', optional(get(source, 'clipPath'), text));
    const filter = at('filter', optional(get(source, 'filter'), text));
    const inSvg = at('inSvg', optional(get(source, 'inSvg'), parseMatrix));
    const gradient = at('gradient', optional(get(source, 'gradient'), parseGradient));
    const words = at('words', optional(get(source, 'words'), parseWords));
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
      !clip.ok ||
      !icon.ok ||
      !transform.ok ||
      !shadow.ok ||
      !clipPath.ok ||
      !filter.ok ||
      !inSvg.ok ||
      !gradient.ok ||
      !words.ok ||
      !children.ok
    ) {
      return failAll(
        [
          id,
          label,
          kind,
          box,
          radius,
          fill,
          stroke,
          opacity,
          transformOrigin,
          clip,
          icon,
          transform,
          shadow,
          clipPath,
          filter,
          inSvg,
          gradient,
          words,
          children,
        ].flatMap(errorsOf),
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
      clip: clip.value,
      transform: transform.value,
      shadow: shadow.value,
      clipPath: clipPath.value,
      filter: filter.value,
      inSvg: inSvg.value,
      gradient: gradient.value,
      words: words.value,
      icon: icon.value,
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

export const MOST_MEASURED_FRAMES = 400;

function parseFrame(value: unknown): Result<Measured['frames'][number]> {
  return andThen(fields(value), (source) => {
    const t = at('t', number(get(source, 't')));
    const matrix = at('matrix', parseMatrix(get(source, 'matrix')));
    const opacity = at('opacity', number(get(source, 'opacity')));
    const taper = at(
      'taper',
      optional(get(source, 'taper'), (value) =>
        andThen(listOf(value, number), (list) => {
          const [g, h] = list;
          return list.length === 2 && g !== undefined && h !== undefined
            ? ok<[number, number]>([g, h])
            : fail('Must be two numbers.');
        }),
      ),
    );
    if (!t.ok || !matrix.ok || !opacity.ok || !taper.ok) {
      return failAll([t, matrix, opacity, taper].flatMap(errorsOf));
    }
    return ok({ t: t.value, matrix: matrix.value, taper: taper.value, opacity: opacity.value });
  });
}

function parseMeasured(value: unknown): Result<Measured> {
  return andThen(fields(value), (source) => {
    const id = at('shapeId', andThen(text(get(source, 'shapeId')), shapeId));
    const frames = at(
      'frames',
      andThen(listOf(get(source, 'frames'), parseFrame), (list) =>
        list.length > MOST_MEASURED_FRAMES
          ? fail(`At most ${MOST_MEASURED_FRAMES} frames.`)
          : ok(list),
      ),
    );
    if (!id.ok || !frames.ok) return failAll([id, frames].flatMap(errorsOf));
    return ok({ shapeId: id.value, frames: frames.value });
  });
}

function parseMeasuredList(value: unknown): Result<Measured[]> {
  return listOf(value, parseMeasured);
}

export const MOST_POINTER_SAMPLES = 600;
const FOLLOW_CHANNEL_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'opacity'] as const;

function parsePointerSample(value: unknown): Result<PointerSample> {
  return andThen(fields(value), (source) => {
    const t = at('t', number(get(source, 't')));
    const x = at('x', number(get(source, 'x')));
    const y = at('y', number(get(source, 'y')));
    const inside = at('inside', boolean(get(source, 'inside')));
    if (!t.ok || !x.ok || !y.ok || !inside.ok) return failAll([t, x, y, inside].flatMap(errorsOf));
    return ok({ t: t.value, x: x.value, y: y.value, inside: inside.value });
  });
}

function parseFollowChannel(value: unknown): Result<FollowChannel> {
  return andThen(fields(value), (source) => {
    const name = at('name', oneOf(get(source, 'name'), FOLLOW_CHANNEL_NAMES));
    const rest = at('rest', number(get(source, 'rest')));
    const base = at('base', number(get(source, 'base')));
    const perX = at('perX', number(get(source, 'perX')));
    const perY = at('perY', number(get(source, 'perY')));
    if (!name.ok || !rest.ok || !base.ok || !perX.ok || !perY.ok) {
      return failAll([name, rest, base, perX, perY].flatMap(errorsOf));
    }
    return ok({
      name: name.value,
      rest: rest.value,
      base: base.value,
      perX: perX.value,
      perY: perY.value,
    });
  });
}

function parseFollow(value: unknown): Result<Follow> {
  return andThen(fields(value), (source) => {
    const id = at('shapeId', andThen(text(get(source, 'shapeId')), shapeId));
    const lag = (key: string): Result<number> =>
      at(
        key,
        andThen(number(get(source, key)), (value) =>
          value < 0 ? fail('Must be 0 or more.') : ok(value),
        ),
      );
    const onLagMs = lag('onLagMs');
    const lagMs = lag('lagMs');
    const channels = at(
      'channels',
      andThen(listOf(get(source, 'channels'), parseFollowChannel), (list) =>
        list.map((channel) => channel.name).join(' ') === FOLLOW_CHANNEL_NAMES.join(' ')
          ? ok(list)
          : fail(`Must be ${FOLLOW_CHANNEL_NAMES.join(', ')}, in that order.`),
      ),
    );
    const pointer = at(
      'pointer',
      andThen(listOf(get(source, 'pointer'), parsePointerSample), (list) =>
        list.length > MOST_POINTER_SAMPLES
          ? fail(`At most ${MOST_POINTER_SAMPLES} samples.`)
          : ok(list),
      ),
    );
    if (!id.ok || !onLagMs.ok || !lagMs.ok || !channels.ok || !pointer.ok) {
      return failAll([id, onLagMs, lagMs, channels, pointer].flatMap(errorsOf));
    }
    return ok({
      shapeId: id.value,
      onLagMs: onLagMs.value,
      lagMs: lagMs.value,
      channels: channels.value,
      pointer: pointer.value,
    });
  });
}

function parseFollowList(value: unknown): Result<Follow[]> {
  return listOf(value, parseFollow);
}

// Rules that involve more than one part of the capture.
function checkReferences(capture: Capture): Result<Capture> {
  const ids = flattenShapes(capture.root).map((shape) => shape.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unknownIn = (where: string, list: { shapeId: string }[]): string[] =>
    list.flatMap((item, index) =>
      ids.includes(item.shapeId as ShapeId)
        ? []
        : [`${where}[${index}].shapeId: No shape has the id "${item.shapeId}".`],
    );
  const unknown = [
    ...unknownIn('tracks', capture.tracks),
    ...unknownIn('measured', capture.measured ?? []),
    ...unknownIn('follows', capture.follows ?? []),
  ];
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
    // Takes saved before the backdrop was read have none. They still load.
    const rawBackdrop = get(source, 'backdrop');
    const backdrop = at('backdrop', rawBackdrop === undefined ? ok(null) : parseFill(rawBackdrop));
    const frame = at('frame', optional(get(source, 'frame'), parseBox));
    const measured = at('measured', optional(get(source, 'measured'), parseMeasuredList));
    const follows = at('follows', optional(get(source, 'follows'), parseFollowList));
    const trigger = at(
      'trigger',
      optional(get(source, 'trigger'), (value) => oneOf(value, TRIGGERS)),
    );
    if (
      !captureSource.ok ||
      !root.ok ||
      !tracks.ok ||
      !notShown.ok ||
      !backdrop.ok ||
      !frame.ok ||
      !trigger.ok ||
      !measured.ok ||
      !follows.ok
    ) {
      return failAll(
        [
          captureSource,
          root,
          tracks,
          notShown,
          backdrop,
          frame,
          trigger,
          measured,
          follows,
        ].flatMap(errorsOf),
      );
    }
    return checkReferences({
      source: captureSource.value,
      root: root.value,
      tracks: tracks.value,
      backdrop: backdrop.value,
      frame: frame.value,
      trigger: trigger.value,
      measured: measured.value,
      follows: follows.value,
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
