// M1 spike. Each test triggers one fixture with real pointer input, saves
// Chrome's raw animation data to spike-output/, and asserts one finding
// about how Chrome reports it. If a Chrome update changes any of this, a
// test here fails and docs/chrome-findings.md needs another look.

import { expect, test } from '@playwright/test';
import type { SpikeDump, SpikeKeyframe, SpikeRecord } from '../packages/capture/src/spike';
import { clickTrigger, record, type Scenario } from './spike-helpers';

// ---------- Small readers for the dump ----------

type Numeric = { value: number; unit: string };
type Component = { type: string; angle?: Numeric; x?: Numeric; y?: Numeric };
type Typed = { type: string; components?: Component[] };

function propertyOf(spikeRecord: SpikeRecord): string {
  return spikeRecord.keyframes[0]?.properties[0]?.cssName ?? '';
}

function byProperty(dump: SpikeDump, cssName: string): SpikeRecord[] {
  return dump.records.filter((item) => propertyOf(item) === cssName);
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

function first(spikeRecord: SpikeRecord): SpikeKeyframe {
  return spikeRecord.keyframes[0] as SpikeKeyframe;
}

function last(spikeRecord: SpikeRecord): SpikeKeyframe {
  return spikeRecord.keyframes[spikeRecord.keyframes.length - 1] as SpikeKeyframe;
}

function valueOf(keyframe: SpikeKeyframe, cssName: string): string | undefined {
  return keyframe.properties.find((property) => property.cssName === cssName)?.value;
}

function typedTransform(keyframe: SpikeKeyframe): Typed {
  const entry = keyframe.typedOm.find((item) => item.cssName === 'transform');
  return entry?.parsed as Typed;
}

function timing(spikeRecord: SpikeRecord): Record<string, unknown> {
  return spikeRecord.timing as Record<string, unknown>;
}

function computedTiming(spikeRecord: SpikeRecord): Record<string, unknown> {
  return spikeRecord.computedTiming as Record<string, unknown>;
}

function keyframeEasings(spikeRecord: SpikeRecord): string[] {
  return spikeRecord.keyframes.map((keyframe) => keyframe.easing);
}

function read(reads: SpikeRecord['restingAtPick'] | null, cssName: string) {
  return reads?.find((item) => item.cssName === cssName)?.read;
}

// ---------- Triggers ----------

const hover: Scenario['trigger'] = async (page, selector) => {
  await page.hover(selector);
};

const click =
  (fixture: string, trigger: string): Scenario['trigger'] =>
  async (page) => {
    await clickTrigger(page, fixture, trigger);
  };

// ---------- Findings ----------

test('transition: easing is on the effect, keyframes say linear, names are camelCase', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'button-hover',
    fixture: 'button-hover',
    trigger: hover,
    recordMs: 400,
  });

  // One CSSTransition object per property.
  expect(dump.records).toHaveLength(2);
  for (const item of dump.records) {
    expect(item.constructorName).toBe('CSSTransition');
    expect(item.timelineType).toBe('DocumentTimeline');
    expect(timing(item).easing).toBe('ease-out');
    expect(timing(item).duration).toBe(180);
    expect(timing(item).fill).toBe('backwards');
    expect(keyframeEasings(item)).toEqual(['linear', 'linear']);
  }

  const shadow = only(byProperty(dump, 'box-shadow'));
  expect(shadow.transitionProperty).toBe('box-shadow');
  expect(first(shadow).properties[0]?.name).toBe('boxShadow');
  // Values come back in computed form: color first, spread added.
  expect(valueOf(last(shadow), 'box-shadow')).toBe('rgba(0, 0, 0, 0.25) 0px 6px 16px 0px');
});

test('transition: transform keyframes keep their function list, readable with Typed OM', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'card-lift',
    fixture: 'card-lift',
    trigger: hover,
    recordMs: 600,
  });

  const transform = only(dump.records);
  expect(timing(transform).easing).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
  expect(valueOf(first(transform), 'transform')).toBe('none');
  expect(valueOf(last(transform), 'transform')).toBe('translateY(-6px) scale(1.03)');

  // "none" is a keyword, not an empty list.
  expect(typedTransform(first(transform)).type).toBe('CSSKeywordValue');

  const typed = typedTransform(last(transform));
  expect(typed.type).toBe('CSSTransformValue');
  expect(typed.components?.map((component) => component.type)).toEqual([
    'CSSTranslate',
    'CSSScale',
  ]);
  expect(typed.components?.[0]?.y).toEqual({ value: -6, unit: 'px' });
  expect(typed.components?.[1]?.x).toEqual({ value: 1.03, unit: 'number' });
});

test('transition-delay arrives as timing.delay, all transitions appear in one frame', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'stagger-list',
    fixture: 'stagger-list',
    trigger: click('stagger-list', 'toggle'),
    recordMs: 800,
  });

  // 4 items x 2 properties.
  expect(dump.records).toHaveLength(8);
  const delays = dump.records.map((item) => timing(item).delay).sort();
  expect(delays).toEqual([0, 0, 120, 120, 180, 180, 60, 60]);

  const seen = dump.records.map((item) => item.firstSeenAtMs);
  expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(20);
});

test('CSS animation: infinite iterations, generated start keyframe, rotation is 360 degrees', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'loader',
    fixture: 'loader',
    trigger: async () => {},
    recordMs: 200,
  });

  const spin = only(dump.records);
  expect(spin.constructorName).toBe('CSSAnimation');
  expect(spin.animationName).toBe('fx-spin');
  // Infinity cannot be written as JSON. The spike writes it as a string.
  expect(timing(spin).iterations).toBe('Infinity');
  expect(computedTiming(spin).endTime).toBe('Infinity');
  // Already on the page when recording began, so it is seen in the first
  // frame. startTime is not asserted: it is usually a number here, but it can
  // still be null (pending) right after page load. currentTime is reliable.
  expect(spin.firstSeenAtMs).toBeLessThan(50);
  expect(typeof spin.currentTime).toBe('number');

  // The CSS has only a "to" keyframe. Chrome adds the start keyframe itself
  // and marks it with composite "replace".
  expect(spin.keyframes).toHaveLength(2);
  expect(valueOf(first(spin), 'transform')).toBe('none');
  expect(first(spin).composite).toBe('replace');
  expect(last(spin).composite).toBe('auto');

  // A full turn stays a full turn. A matrix would say "no rotation".
  const typed = typedTransform(last(spin));
  expect(typed.components).toHaveLength(1);
  expect(typed.components?.[0]?.type).toBe('CSSRotate');
  expect(typed.components?.[0]?.angle).toEqual({ value: 360, unit: 'deg' });

  // The style read at pick time is mid-spin, so it is not a resting value.
  expect(read(spin.restingAtPick, 'transform')?.computed).toMatch(/^rotate\(/);
});

test('CSS animation: easing is on each keyframe, the effect says linear', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'bounce',
    fixture: 'bounce',
    trigger: click('bounce', 'play'),
    recordMs: 1100,
  });

  const bounce = only(dump.records);
  expect(timing(bounce).easing).toBe('linear');
  expect(bounce.keyframes.map((keyframe) => keyframe.computedOffset)).toEqual([
    0, 0.4, 0.6, 0.8, 0.9, 1,
  ]);
  // The last keyframe has no segment after it. It reports the element's own
  // animation-timing-function, which is "linear" here.
  expect(keyframeEasings(bounce)).toEqual([
    'ease-in',
    'ease-out',
    'ease-in',
    'ease-out',
    'ease-in',
    'linear',
  ]);
  // "0" in the CSS comes back as "0px".
  expect(valueOf(last(bounce), 'transform')).toBe('translateY(0px)');
});

test('CSS animation: steps() from the element is copied onto every keyframe', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'steps',
    fixture: 'steps',
    trigger: click('steps', 'play'),
    recordMs: 1200,
  });

  const steps = only(dump.records);
  expect(timing(steps).easing).toBe('linear');
  // Written as steps(5, end) in the CSS. Chrome drops the default position.
  expect(keyframeEasings(steps)).toEqual(['steps(5)', 'steps(5)']);
});

test('transition: linear() easing is on the effect, with a percentage on every stop', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'linear-easing',
    fixture: 'linear-easing',
    trigger: hover,
    recordMs: 900,
  });

  const move = only(dump.records);
  expect(timing(move).easing).toBe(
    'linear(0 0%, 0.22 9%, 0.86 27%, 1.11 36%, 1.16 42%, 1.04 60%, 0.98 72%, 1 100%)',
  );
  expect(keyframeEasings(move)).toEqual(['linear', 'linear']);
});

test('element.animate(): easing on both levels, several properties in one keyframe', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'web-animation-both-ends',
    fixture: 'web-animation',
    trigger: click('web-animation', 'both-ends'),
    recordMs: 1400,
  });

  const animation = only(dump.records);
  expect(animation.constructorName).toBe('Animation');
  expect(timing(animation).easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
  expect(keyframeEasings(animation)).toEqual(['ease-in', 'linear']);
  expect(timing(animation).iterations).toBe(2);
  expect(timing(animation).direction).toBe('alternate');

  // offset is null unless the author set it. computedOffset is always there.
  expect(animation.keyframes.map((keyframe) => keyframe.offset)).toEqual([null, null]);
  expect(animation.keyframes.map((keyframe) => keyframe.computedOffset)).toEqual([0, 1]);

  // getTiming() says "auto". Only getComputedTiming() gives the real fill.
  expect(timing(animation).fill).toBe('auto');
  expect(computedTiming(animation).fill).toBe('none');

  expect(first(animation).properties.map((property) => property.cssName)).toEqual([
    'transform',
    'opacity',
  ]);

  // composite is "auto" unless the author sets it. The only other value seen
  // in any fixture is "replace", on the start keyframe Chrome adds itself
  // (see the loader test).
  expect(animation.keyframes.map((keyframe) => keyframe.composite)).toEqual(['auto', 'auto']);
});

test('element.animate() with no start keyframe: Chrome does not add one', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'web-animation-start-missing',
    fixture: 'web-animation',
    trigger: click('web-animation', 'start-missing'),
    recordMs: 800,
  });

  const animation = only(dump.records);
  expect(animation.keyframes).toHaveLength(1);
  expect(first(animation).computedOffset).toBe(1);

  // Pick-time read equals the true resting value (read after it finished).
  expect(read(animation.restingAtPick, 'transform')?.computed).toBe('none');
  expect(read(animation.readAfterFinish, 'transform')?.computed).toBe('none');
});

test('element.animate() with no end keyframe: only the pick-time read is the resting value', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'web-animation-end-missing',
    fixture: 'web-animation',
    trigger: click('web-animation', 'end-missing'),
    recordMs: 800,
  });

  const animation = only(dump.records);
  expect(animation.keyframes).toHaveLength(1);
  expect(first(animation).computedOffset).toBe(0);

  // The CSS says opacity 0.9. Reading computed style when the animation is
  // first seen gives the animated value, which is wrong as a resting value.
  expect(read(animation.readAtFirstSight, 'opacity')?.resolved).toBe('0.2');
  // Reading at pick time, before the trigger, is right.
  expect(read(animation.restingAtPick, 'opacity')?.resolved).toBe('0.9');
  expect(read(animation.readAfterFinish, 'opacity')?.resolved).toBe('0.9');
});

test('transition on a shorthand arrives as one transition per longhand', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'morph',
    fixture: 'morph',
    trigger: hover,
    recordMs: 700,
  });

  expect(dump.records.map(propertyOf).sort()).toEqual([
    'background-color',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
    'border-top-left-radius',
    'border-top-right-radius',
  ]);

  const corner = only(byProperty(dump, 'border-top-left-radius'));
  expect(valueOf(first(corner), 'border-top-left-radius')).toBe('8px');
  expect(valueOf(last(corner), 'border-top-left-radius')).toBe('50%');

  // Colors come back as rgb(), with var() already resolved.
  const color = only(byProperty(dump, 'background-color'));
  expect(valueOf(first(color), 'background-color')).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
});

test('interrupted transition: cancelled, replaced by a shorter one that starts mid-way', async ({
  page,
}, testInfo) => {
  const dump = await record(page, testInfo, {
    name: 'button-hover-interrupted',
    fixture: 'button-hover',
    // Hover in, then leave before the 180 ms transition is done.
    trigger: async (page, selector) => {
      await page.hover(selector);
      // Wait on the animation's own progress, not on the clock, so the test
      // does not depend on how busy the machine is.
      await page.waitForFunction(
        (sel) => {
          const running = document.querySelector(sel)?.getAnimations()[0];
          const progress = running?.effect?.getComputedTiming().progress ?? 0;
          return progress > 0.2;
        },
        selector,
        { polling: 'raf' },
      );
      await page.mouse.move(0, 0);
    },
    recordMs: 500,
  });

  // Two Animation objects per property: the hover-in and its replacement.
  const [hoverIn, hoverOut] = byProperty(dump, 'transform');
  expect(byProperty(dump, 'transform')).toHaveLength(2);
  if (hoverIn === undefined || hoverOut === undefined) return;

  expect(timing(hoverIn).duration).toBe(180);
  // The browser shortened the way back.
  expect(timing(hoverOut).duration as number).toBeGreaterThan(0);
  expect(timing(hoverOut).duration as number).toBeLessThan(180);

  // It starts from where the first one had got to, still as a function list.
  expect(valueOf(first(hoverOut), 'transform')).toMatch(/^translateY\(-[\d.]+px\)$/);
  // The rule we will use to mark "shortened": it ends where the first began.
  expect(valueOf(last(hoverOut), 'transform')).toBe(valueOf(first(hoverIn), 'transform'));

  // The first transition never finished. Chrome fires transitioncancel
  // before the replacement runs.
  const types = dump.events.filter((event) => event.name === 'transform').map((e) => e.type);
  expect(types).toEqual([
    'transitionrun',
    'transitionstart',
    'transitioncancel',
    'transitionrun',
    'transitionstart',
    'transitionend',
  ]);
  expect(hoverIn.readAfterFinish).toBeNull();
});

