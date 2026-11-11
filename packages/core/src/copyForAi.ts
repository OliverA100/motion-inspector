// "Copy for AI": a short Markdown spec to paste into a coding assistant.
// It holds the description, a table of tracks, the CSS, and the full
// Capture as JSON, so the assistant (or this tool) can read it back.

import { describeCapture } from './describe';
import { captureToCss, trackEasingCss } from './exportCss';
import { formatNumber } from './format';
import { effectiveDelay, groupByShorthand } from './groups';
import { parseCaptureJson } from './parse';
import { fail, ok, type Result } from './result';
import { flattenShapes } from './shapes';
import type { Capture, Follow } from './types';

const JSON_FENCE_START = '```json\n';
const FENCE_END = '\n```';

// A table cell cannot hold a "|" or a line break.
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll(/\s+/g, ' ');
}

function trackTable(capture: Capture): string[] {
  const rows = flattenShapes(capture.root).flatMap((shape) => {
    const tracks = capture.tracks.filter((track) => track.shapeId === shape.id);
    return groupByShorthand(tracks).flatMap((group) => {
      const track = group.tracks[0];
      const from = track?.keyframes[0];
      const to = track?.keyframes[track.keyframes.length - 1];
      if (track === undefined || from === undefined || to === undefined) return [];
      const cells = [
        shape.label,
        group.property,
        from.value,
        to.value,
        `${formatNumber(effectiveDelay(track))} ms`,
        `${formatNumber(track.timing.duration)} ms`,
        trackEasingCss(track),
      ];
      return [`| ${cells.map(cell).join(' | ')} |`];
    });
  });
  return [
    '| Shape | Property | From | To | Delay | Duration | Easing |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ];
}

// The JSON block must survive any text in the capture. A backtick is the
// one character that could end the code fence early, and JSON only ever has
// backticks inside strings, where "`" means the same thing.
//
// The film of the page (measured) and the pointer's path are left out:
// they are evidence for the self-check, hundreds of numbers each, not part
// of the motion to build. Read back, the capture has no self-check.
function captureJson(capture: Capture): string {
  const spec: Capture = {
    ...capture,
    measured: null,
    follows:
      capture.follows === null
        ? null
        : capture.follows.map((follow) => ({ ...follow, pointer: [] })),
  };
  return JSON.stringify(spec, null, 2).replaceAll('`', '\\u0060');
}

// A part that follows the pointer, as a rule a script can follow: where
// its transform heads for, and how fast it gets there.
function followSection(capture: Capture, follow: Follow): string[] {
  const label =
    flattenShapes(capture.root).find((shape) => shape.id === follow.shapeId)?.label ?? 'A part';
  const number = (value: number | undefined): string =>
    value === undefined ? '0' : String(Math.round(value * 1e9) / 1e9);
  const rows = follow.channels.map(
    (channel) =>
      `| ${channel.name} | ${number(channel.base)} | ${number(channel.perX)} | ${number(channel.perY)} | ${number(channel.rest)} |`,
  );
  return [
    `\`${label}\`: three values drive it, each moving 1 - exp(-dt / lag) of the way to its aim every frame (dt in ms). on aims for 1 while the pointer is on the part and 0 off it (lag ${formatNumber(follow.onLagMs)} ms). x and y aim for where the pointer is on it, from -1 at the left or top edge to 1 at the right or bottom (lag ${formatNumber(follow.lagMs)} ms; held while the pointer is off it; when the pointer arrives at a part at rest, they start there). Each number below is rest + on × (base − rest + perX × x + perY × y), and they make its transform, about its transform origin:`,
    '',
    `\`transform: matrix3d(a, b, 0, g, c, d, 0, h, 0, 0, 1, 0, e, f, 0, 1)\`; and \`opacity\`.`,
    '',
    '| Number | Base | Per x | Per y | Rest |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ];
}

// What set the motion off, for a reader rebuilding it. null when unknown.
const SET_OFF_BY: Record<string, string> = {
  hover: 'the pointer coming onto the element (a hover)',
  leave: 'the pointer leaving the element',
  'hover-and-leave': 'a hover, then the pointer leaving',
  click: 'a click',
  focus: 'the element getting focus',
  blur: 'the element losing focus',
  key: 'a key press',
  loop: 'nothing: it loops',
  running: 'already running when recording began',
  scroll: 'the page scrolling',
  load: 'the page loading',
};

// What the capture says it does not hold, so it is not mistaken for all.
function gapsSection(capture: Capture): string[] {
  const missed = (capture.missed ?? []).map(
    (item) =>
      `- \`${item.label}\` changed on the page (${item.what === 'moved' ? 'its place, size or opacity' : 'its look'}) and is not in this capture.`,
  );
  const notes = capture.notShown.map((note) => `- ${note}`);
  return missed.length + notes.length === 0
    ? []
    : ['## Not in this capture', '', ...missed, ...notes, ''];
}

export function copyForAiText(capture: Capture): string {
  return [
    '# Motion spec',
    '',
    describeCapture(capture),
    '',
    `Source: ${capture.source.url} (\`${capture.source.selector}\`)`,
    ...(capture.trigger === null || SET_OFF_BY[capture.trigger] === undefined
      ? []
      : [`Set off by: ${SET_OFF_BY[capture.trigger]}.`]),
    '',
    '## Tracks',
    '',
    ...trackTable(capture),
    '',
    ...((capture.follows ?? []).length === 0
      ? []
      : [
          '## Following the pointer',
          '',
          'CSS cannot do this alone: a script sets the transform each frame.',
          '',
          ...(capture.follows ?? []).flatMap((follow) => followSection(capture, follow)),
          '',
        ]),
    ...gapsSection(capture),
    '## CSS',
    '',
    '```css',
    captureToCss(capture),
    '```',
    '',
    '## Capture JSON',
    '',
    `${JSON_FENCE_START}${captureJson(capture)}${FENCE_END}`,
    '',
  ].join('\n');
}

// Reads the Capture back out of a "Copy for AI" text.
export function captureFromAiText(text: string): Result<Capture> {
  // The JSON block is the last one, and it contains no backticks, so the
  // last "```json" in the text is always its start.
  const start = text.lastIndexOf(JSON_FENCE_START);
  if (start === -1) return fail('No Capture JSON block was found.');
  const jsonStart = start + JSON_FENCE_START.length;
  const end = text.indexOf(FENCE_END, jsonStart);
  if (end === -1) return fail('The Capture JSON block is not closed.');
  const parsed = parseCaptureJson(text.slice(jsonStart, end));
  return parsed.ok ? ok(parsed.value) : parsed;
}
