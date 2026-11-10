import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseCapture, parseCaptureJson } from '../src/parse';
import { capture, rawCapture } from './arbitraries';
import { allSamples, cardLift } from '../src/samples';

describe('parseCapture', () => {
  test('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = parseCapture(value);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
      }),
    );
  });

  test('never throws on JSON text either', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        expect(typeof parseCaptureJson(text).ok).toBe('boolean');
      }),
    );
  });

  test('accepts every capture that follows the rules', () => {
    fc.assert(
      fc.property(rawCapture, (raw) => {
        expect(parseCapture(raw)).toMatchObject({ ok: true });
      }),
    );
  });

  test('a valid capture comes back unchanged from JSON', () => {
    fc.assert(
      fc.property(capture, (value) => {
        expect(parseCaptureJson(JSON.stringify(value))).toEqual({ ok: true, value });
      }),
    );
  });

  test('still never throws when a valid capture is damaged', () => {
    // Replace one value somewhere inside a valid capture with anything.
    fc.assert(
      fc.property(rawCapture, fc.anything(), fc.nat(), (raw, junk, seed) => {
        const text = JSON.stringify(raw);
        const keys = [...text.matchAll(/"(\w+)":/g)].map((match) => match[1] ?? '');
        const target = keys[seed % keys.length];
        const damaged: unknown = JSON.parse(text, (key, item: unknown) =>
          key === target ? junk : item,
        );
        expect(typeof parseCapture(damaged).ok).toBe('boolean');
      }),
    );
  });
});

describe('parseCapture errors', () => {
  const valid = JSON.parse(JSON.stringify(cardLift)) as Record<string, unknown>;
  const track = (valid.tracks as Record<string, unknown>[])[0] as Record<string, unknown>;

  function errorsFor(changed: unknown): string[] {
    const result = parseCapture(changed);
    return result.ok ? [] : result.errors;
  }

  test('says where the problem is, in plain words', () => {
    const badDuration = {
      ...valid,
      tracks: [{ ...track, timing: { ...(track.timing as object), duration: -5 } }],
    };
    expect(errorsFor(badDuration)).toEqual([
      'tracks: [0]: timing: duration: A duration is a finite number of ms, zero or more. Got -5.',
    ]);
  });

  test('reports every problem, not only the first', () => {
    const broken = { ...valid, source: { url: 3 }, notShown: 'none' };
    expect(errorsFor(broken)).toEqual([
      'source: url: Expected text.',
      'source: selector: Expected text.',
      'source: capturedAt: Expected text.',
      'notShown: Expected a list.',
    ]);
  });

  test('rejects a track that points at a shape that does not exist', () => {
    const lost = { ...valid, tracks: [{ ...track, shapeId: 'nowhere' }] };
    expect(errorsFor(lost)).toEqual(['tracks[0].shapeId: No shape has the id "nowhere".']);
  });

  test('rejects keyframes that break the order rules', () => {
    const keyframes = track.keyframes as Record<string, unknown>[];
    const oneKeyframe = { ...valid, tracks: [{ ...track, keyframes: [keyframes[0]] }] };
    expect(errorsFor(oneKeyframe)).toEqual([
      'tracks: [0]: keyframes: A track needs at least 2 keyframes.',
    ]);
    const lateStart = {
      ...valid,
      tracks: [{ ...track, keyframes: [{ ...keyframes[0], offset: 0.2 }, keyframes[1]] }],
    };
    expect(errorsFor(lateStart)).toEqual([
      'tracks: [0]: keyframes: The first keyframe must be at offset 0.',
    ]);
  });

  test('accepts a negative delay', () => {
    const early = {
      ...valid,
      tracks: [{ ...track, timing: { ...(track.timing as object), delay: -320 } }],
    };
    expect(parseCapture(early).ok).toBe(true);
  });

  test('drops fields it does not know', () => {
    const result = parseCapture({ ...valid, extra: 'ignored' });
    expect(result).toEqual({ ok: true, value: cardLift });
  });

  test('the sample captures are all valid', () => {
    for (const sample of allSamples) {
      expect(parseCaptureJson(JSON.stringify(sample))).toEqual({ ok: true, value: sample });
    }
  });
});
