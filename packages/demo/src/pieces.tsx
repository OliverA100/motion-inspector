// The pieces page: each editor piece shown alone, with sample data and only
// the state it needs. It shows that every piece works without the others.

import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NAMED_EASINGS, type Easing } from '@motion-inspector/core';
import { bounce, cardLift, staggerList } from '@motion-inspector/core/src/samples';
import {
  createProbe,
  CurveEditor,
  isPreviewed,
  plainName,
  Playback,
  SpeedGraph,
  Stage,
  takeLengthMs,
  Timeline,
  timelineRows,
  type Compare,
  type Probe,
  type Speed,
} from '@motion-inspector/editor';
import { DemoBar } from './DemoBar';
import './demo.css';

function Piece({ name, about, children }: { name: string; about: string; children: ReactNode }) {
  return (
    <section className="piece" data-piece={name}>
      <h2>{name}</h2>
      <p>{about}</p>
      <div className="mi">{children}</div>
    </section>
  );
}

const overshoot = cardLift.tracks[0]?.timing.easing ?? { kind: 'linear' };
const easeOut = NAMED_EASINGS.find((named) => named.name === 'ease-out')?.easing ?? overshoot;

function StagePiece() {
  const [compare, setCompare] = useState<Compare>('overlay');
  const [timeMs, setTimeMs] = useState(120);
  const [probe, setProbe] = useState<Probe | null>(null);
  useEffect(() => {
    const created = createProbe();
    setProbe(created);
    return () => created.dispose();
  }, []);
  const mine = useMemo(() => probe?.poses(cardLift, timeMs) ?? [], [probe, timeMs]);
  const original = useMemo(() => probe?.poses(cardLift, 400) ?? [], [probe]);
  return (
    <>
      <Stage
        root={cardLift.root}
        mine={mine}
        original={original}
        showOriginal
        compare={compare}
        selectedShapeId={cardLift.root.id}
        onCompareChange={setCompare}
      />
      <input
        style={{ width: '100%' }}
        type="range"
        aria-label="Time"
        min={0}
        max={400}
        value={timeMs}
        onChange={(event) => setTimeMs(event.target.valueAsNumber)}
      />
    </>
  );
}

function CurvePiece() {
  const [mine, setMine] = useState<Easing>(overshoot);
  return (
    <CurveEditor
      original={overshoot}
      mine={mine}
      showOriginal
      playhead={0.3}
      durationMs={400}
      term="transition-timing-function"
      segments={null}
      onSegmentChange={() => {}}
      onChange={setMine}
      onCommit={() => {}}
      onDragChange={() => {}}
    />
  );
}

function TimelinePiece() {
  const [selected, setSelected] = useState<number | null>(0);
  const [hidden, setHidden] = useState<number[]>([]);
  const [timeMs, setTimeMs] = useState(200);
  const rows = timelineRows(staggerList, staggerList).map((row, index) => ({
    ...row,
    name: plainName(row.property),
    previewed: isPreviewed(row.property),
    shown: !hidden.includes(index),
  }));
  return (
    <Timeline
      tracks={rows}
      selectedIndex={selected}
      totalMs={takeLengthMs(staggerList)}
      playheadMs={timeMs}
      showOriginal
      controls={null}
      onSelect={setSelected}
      onToggle={(index) =>
        setHidden(hidden.includes(index) ? hidden.filter((item) => item !== index) : [...hidden, index])
      }
      onScrub={setTimeMs}
      onDragChange={() => {}}
    />
  );
}

function PlaybackPiece() {
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  return (
    <Playback
      playing={playing}
      loop={loop}
      speed={speed}
      timeMs={300}
      totalMs={takeLengthMs(bounce)}
      onPlayToggle={() => setPlaying(!playing)}
      onLoopChange={setLoop}
      onSpeedChange={setSpeed}
    />
  );
}

function Pieces() {
  return (
    <>
      <DemoBar current="pieces" />
      <main className="pieces">
        <h1>Pieces</h1>
        <p>
          Each part of the editor, shown alone. Every piece takes plain data and callbacks, and
          knows nothing about the others.
        </p>
        <Piece name="Stage" about="Draws the simplified component from a list of poses.">
          <StagePiece />
        </Piece>
        <Piece
          name="CurveEditor"
          about="Drag the two handles, or focus one and use the arrow keys. Double-click resets a handle."
        >
          <CurvePiece />
        </Piece>
        <Piece name="SpeedGraph" about="Speed over time for two easings.">
          <SpeedGraph original={overshoot} mine={easeOut} playhead={0.3} showOriginal />
        </Piece>
        <Piece name="Timeline" about="One row per shape and property. Click a row to select it, untick it to leave it out, and drag on the bars to move through time.">
          <TimelinePiece />
        </Piece>
        <Piece name="Playback" about="Play, loop, speed and the current time. Here it only holds its own state.">
          <PlaybackPiece />
        </Piece>
      </main>
    </>
  );
}

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app');
createRoot(container).render(
  <StrictMode>
    <Pieces />
  </StrictMode>,
);
