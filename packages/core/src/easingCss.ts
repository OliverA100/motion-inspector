// Easings as CSS text: parse "cubic-bezier(0.2, 0, 0, 1)" into an Easing,
// and write an Easing back out. Chrome reports easings as these strings.

import { cubicBezier, linear, linearPoints, NAMED_EASINGS, steps } from './easing';
import { formatNumber } from './format';
import { fail, ok, type Result } from './result';
import type { Easing, StepPosition } from './types';

// ---------- Parse ----------

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/;
const WHOLE_NUMBER = /^\d+$/;
const FUNCTION_CALL = /^([a-z-]+)\((.*)\)$/s;

function parseNumber(text: string): Result<number> {
  if (!NUMBER.test(text)) return fail(`"${text}" is not a number.`);
  return ok(Number(text));
}

function parsePercent(text: string): Result<number> {
  if (!text.endsWith('%')) return fail(`"${text}" is not a percentage.`);
  const value = parseNumber(text.slice(0, -1));
  return value.ok ? ok(value.value / 100) : fail(`"${text}" is not a percentage.`);
}

function splitArguments(text: string): string[] {
  return text.split(',').map((part) => part.trim());
}

function parseCubicBezier(argumentText: string): Result<Easing> {
  const parts = splitArguments(argumentText);
  if (parts.length !== 4) return fail('cubic-bezier() takes 4 numbers.');
  const [x1, y1, x2, y2] = parts.map(parseNumber);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return fail('cubic-bezier() takes 4 numbers.');
  }
  if (!x1.ok || !y1.ok || !x2.ok || !y2.ok) return fail('cubic-bezier() takes 4 numbers.');
  return cubicBezier(x1.value, y1.value, x2.value, y2.value);
}

function parseStepPosition(text: string): Result<StepPosition> {
  switch (text) {
    case 'start':
    case 'jump-start':
      return ok('start');
    case 'end':
    case 'jump-end':
      return ok('end');
    case 'jump-none':
      return ok('jump-none');
    case 'jump-both':
      return ok('jump-both');
    default:
      return fail(`"${text}" is not a step position.`);
  }
}

function parseSteps(argumentText: string): Result<Easing> {
  const parts = splitArguments(argumentText);
  const countText = parts[0];
  if (countText === undefined || parts.length > 2 || !WHOLE_NUMBER.test(countText)) {
    return fail('steps() takes a whole number and an optional position.');
  }
  const position = parts[1] === undefined ? ok<StepPosition>('end') : parseStepPosition(parts[1]);
  if (!position.ok) return position;
  return steps(Number(countText), position.value);
}

// A stop in linear(): an output, and an input that may be left out.
type Stop = { output: number; input: number | null };

// "0.5 20% 40%" is one output with two inputs. It becomes two stops.
function parseStop(text: string): Result<Stop[]> {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  const outputText = tokens[0];
  if (outputText === undefined || tokens.length > 3)
    return fail(`"${text}" is not a linear() stop.`);
  const output = parseNumber(outputText);
  if (!output.ok) return output;
  const inputs = tokens.slice(1).map(parsePercent);
  const values = inputs.flatMap((input) => (input.ok ? [input.value] : []));
  if (values.length !== inputs.length) return fail(`"${text}" is not a linear() stop.`);
  if (values.length === 0) return ok([{ output: output.value, input: null }]);
  return ok(values.map((input) => ({ output: output.value, input })));
}

// The CSS rules for inputs that were left out or are out of order:
// 1. The first defaults to 0 and the last to 1.
// 2. An input smaller than one before it is raised to match.
// 3. Missing inputs in between are spread evenly between their neighbors.
function fillInputs(stops: Stop[]): { input: number; output: number }[] {
  const withEnds = stops.map((stop, index) => {
    if (stop.input !== null) return stop;
    if (index === 0) return { output: stop.output, input: 0 };
    if (index === stops.length - 1) return { output: stop.output, input: 1 };
    return stop;
  });

  const neverDecreasing = withEnds.map((stop, index) => {
    if (stop.input === null) return stop;
    const largestBefore = withEnds
      .slice(0, index)
      .reduce((largest, earlier) => Math.max(largest, earlier.input ?? -Infinity), -Infinity);
    return { output: stop.output, input: Math.max(stop.input, largestBefore) };
  });

  return neverDecreasing.map((stop, index) => {
    if (stop.input !== null) return { output: stop.output, input: stop.input };
    const beforeIndex = neverDecreasing.findLastIndex(
      (other, otherIndex) => otherIndex < index && other.input !== null,
    );
    const afterIndex = neverDecreasing.findIndex(
      (other, otherIndex) => otherIndex > index && other.input !== null,
    );
    const before = neverDecreasing[beforeIndex]?.input ?? 0;
    const after = neverDecreasing[afterIndex]?.input ?? 1;
    const along = (index - beforeIndex) / (afterIndex - beforeIndex);
    return { output: stop.output, input: before + (after - before) * along };
  });
}

function parseLinearPoints(argumentText: string): Result<Easing> {
  const parsed = splitArguments(argumentText).map(parseStop);
  const stops = parsed.flatMap((stop) => (stop.ok ? stop.value : []));
  if (parsed.some((stop) => !stop.ok)) return fail('linear() takes a list of stops.');
  if (stops.length < 2) return fail('linear() needs at least 2 stops.');
  return linearPoints(fillInputs(stops));
}

function parseKeyword(text: string): Result<Easing> {
  if (text === 'step-start') return steps(1, 'start');
  if (text === 'step-end') return steps(1, 'end');
  const named = NAMED_EASINGS.find((candidate) => candidate.name === text);
  return named === undefined ? fail(`"${text}" is not an easing.`) : ok(named.easing);
}

export function parseEasing(text: string): Result<Easing> {
  const trimmed = text.trim().toLowerCase();
  const call = FUNCTION_CALL.exec(trimmed);
  if (call === null) return parseKeyword(trimmed);
  const name = call[1];
  const argumentText = call[2] ?? '';
  switch (name) {
    case 'cubic-bezier':
      return parseCubicBezier(argumentText);
    case 'steps':
      return parseSteps(argumentText);
    case 'linear':
      return parseLinearPoints(argumentText);
    default:
      return fail(`"${text}" is not an easing.`);
  }
}

// ---------- Write ----------

function sameEasing(first: Easing, second: Easing): boolean {
  if (first.kind === 'linear' && second.kind === 'linear') return true;
  if (first.kind === 'cubic-bezier' && second.kind === 'cubic-bezier') {
    return (
      first.x1 === second.x1 &&
      first.y1 === second.y1 &&
      first.x2 === second.x2 &&
      first.y2 === second.y2
    );
  }
  return false;
}

// Writes the keyword when the easing is exactly a named one ("ease-out"),
// because that is what a person would write.
export function easingToCss(easing: Easing): string {
  const named = NAMED_EASINGS.find((candidate) => sameEasing(candidate.easing, easing));
  if (named !== undefined) return named.name;
  switch (easing.kind) {
    case 'linear':
      return 'linear';
    case 'cubic-bezier':
      return `cubic-bezier(${[easing.x1, easing.y1, easing.x2, easing.y2].map(formatNumber).join(', ')})`;
    case 'steps':
      return easing.position === 'end'
        ? `steps(${easing.count})`
        : `steps(${easing.count}, ${easing.position})`;
    case 'linear-points':
      return `linear(${easing.points
        .map((point) => `${formatNumber(point.output)} ${formatNumber(point.input * 100)}%`)
        .join(', ')})`;
  }
}
