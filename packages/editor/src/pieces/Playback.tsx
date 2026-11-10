// Playback controls: play, loop, speed, the current time, and a scrubber.

import { formatNumber } from '@motion-inspector/core';
import type { Speed } from '../state/model';
import { Button, Segmented, Toggle } from './controls';

type Props = {
  playing: boolean;
  loop: boolean;
  speed: Speed;
  timeMs: number;
  totalMs: number;
  onPlayToggle: () => void;
  onLoopChange: (loop: boolean) => void;
  onSpeedChange: (speed: Speed) => void;
  onScrub: (timeMs: number) => void;
};

const SPEEDS: { value: Speed; text: string }[] = [
  { value: 1, text: '1x' },
  { value: 0.5, text: '0.5x' },
  { value: 0.25, text: '0.25x' },
  { value: 0.1, text: '0.1x' },
];

const FRAME_MS = 1000 / 60;

export function Playback(props: Props) {
  return (
    <div className="playback">
      <div className="playback__row">
        <Button primary onClick={props.onPlayToggle}>
          {props.playing ? 'Pause' : 'Play'}
        </Button>
        <Toggle label="Loop" checked={props.loop} onChange={props.onLoopChange} />
        <Segmented
          label="Playback speed"
          options={SPEEDS}
          value={props.speed}
          onChange={props.onSpeedChange}
        />
        <output className="playback__time">
          {formatNumber(Math.round(props.timeMs))} ms
          <span> of {formatNumber(Math.round(props.totalMs))} ms</span>
        </output>
      </div>
      {/* A native slider: it follows the pointer with no lag, and the arrow
          keys step one frame without any code here. */}
      <input
        className="scrubber"
        type="range"
        aria-label="Scrub through the animation"
        min={0}
        max={props.totalMs}
        step={FRAME_MS}
        value={props.timeMs}
        onChange={(event) => props.onScrub(event.target.valueAsNumber)}
      />
    </div>
  );
}
