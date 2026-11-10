// Playback controls: play, loop, speed, and the current time.
// Moving through time by hand is done on the timeline itself.

import { formatNumber } from '@motion-inspector/core';
import type { Speed } from '../state/model';
import { Button, Toggle } from './controls';

type Props = {
  playing: boolean;
  loop: boolean;
  speed: Speed;
  timeMs: number;
  totalMs: number;
  onPlayToggle: () => void;
  onLoopChange: (loop: boolean) => void;
  onSpeedChange: (speed: Speed) => void;
};

const SPEEDS: { value: Speed; text: string }[] = [
  { value: 1, text: '1x' },
  { value: 0.5, text: '0.5x' },
  { value: 0.25, text: '0.25x' },
  { value: 0.1, text: '0.1x' },
];

export function Playback(props: Props) {
  return (
    <div className="playback">
      {/* The same width for "Play" and "Pause", so nothing beside it moves. */}
      <span className="playback__play">
        <Button primary onClick={props.onPlayToggle}>
          {props.playing ? 'Pause' : 'Play'}
        </Button>
      </span>
      <output className="playback__time">
        {formatNumber(Math.round(props.timeMs))}
        <span> of {formatNumber(Math.round(props.totalMs))} ms</span>
      </output>
      <span className="playback__end">
        <Toggle label="Loop" checked={props.loop} onChange={props.onLoopChange} />
        {/* A small menu: four buttons took a row of their own. */}
        <select
          className="playback__speed"
          aria-label="Playback speed"
          value={props.speed}
          onChange={(event) => props.onSpeedChange(Number(event.target.value) as Speed)}
        >
          {SPEEDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
