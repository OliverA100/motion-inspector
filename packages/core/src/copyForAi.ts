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
import type { Capture } from './types';

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
function captureJson(capture: Capture): string {
  return JSON.stringify(capture, null, 2).replaceAll('`', '\\u0060');
}

export function copyForAiText(capture: Capture): string {
  return [
    '# Motion spec',
    '',
    describeCapture(capture),
    '',
    `Source: ${capture.source.url} (\`${capture.source.selector}\`)`,
    '',
    '## Tracks',
    '',
    ...trackTable(capture),
    '',
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
