// Playback controls: play, loop, speed, and the current time.

import { formatNumber } from '@motion-inspector/core';
import { Button, Segmented, Toggle } from './controls';

export type Speed = '1' | '0.5' | '0.25' | '0.1';

type Props = {
  playing: boolean;
  loop: boolean;
  speed: Speed;
  timeMs: number;
  totalMs: number;
  onPlayToggle?: () => void;
  onLoopChange?: (loop: boolean) => void;
  onSpeedChange?: (speed: Speed) => void;
};

const SPEEDS: { value: Speed; text: string }[] = [
  { value: '1', text: '1x' },
  { value: '0.5', text: '0.5x' },
  { value: '0.25', text: '0.25x' },
  { value: '0.1', text: '0.1x' },
];

export function Playback(props: Props) {
  return (
    <div className="playback">
      <Button primary {...(props.onPlayToggle ? { onClick: props.onPlayToggle } : {})}>
        {props.playing ? 'Pause' : 'Play'}
      </Button>
      <Toggle
        label="Loop"
        checked={props.loop}
        {...(props.onLoopChange ? { onChange: props.onLoopChange } : {})}
      />
      <Segmented
        label="Playback speed"
        options={SPEEDS}
        value={props.speed}
        {...(props.onSpeedChange ? { onChange: props.onSpeedChange } : {})}
      />
      <output className="playback__time">
        {formatNumber(Math.round(props.timeMs))} ms
        <span> of {formatNumber(Math.round(props.totalMs))} ms</span>
      </output>
    </div>
  );
}
