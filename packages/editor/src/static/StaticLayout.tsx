// The whole editor laid out with fake data. Nothing here is wired up: no
// state, no playback, no dragging. It exists to agree on the look before
// the real pieces are built on top of it.

import type { ShapeId, Track } from '@motion-inspector/core';
import type { Pose } from '../draw/stage';
import { CurveEditor } from '../pieces/CurveEditor';
import { Button } from '../pieces/controls';
import { Playback } from '../pieces/Playback';
import { SpeedGraph } from '../pieces/SpeedGraph';
import { Stage, type Compare } from '../pieces/Stage';
import { Timeline, type TimelineTrack } from '../pieces/Timeline';
import { fakeEdited, fakeOriginal } from './fakeCapture';

const PREVIEWED = ['transform', 'opacity', 'box-shadow', 'border-top-color'];
const SHOWN_TRACKS = 5;
const PLAYHEAD_MS = 150;
const TOTAL_MS = 500;

function bar(track: Track) {
  return {
    startMs: track.startOffset,
    delayMs: track.timing.delay,
    durationMs: track.timing.duration,
  };
}

const tracks: TimelineTrack[] = fakeEdited.tracks.map((track, index) => {
  const original = fakeOriginal.tracks[index] ?? track;
  const shapeLabel =
    [fakeEdited.root, ...fakeEdited.root.children].find((shape) => shape.id === track.shapeId)
      ?.label ?? '';
  return {
    id: String(index),
    shapeLabel,
    property: track.property,
    mine: bar(track),
    original: bar(original),
    previewed: PREVIEWED.includes(track.property),
  };
});

// Hand-set poses, standing in for what the probe will compute.
const cardId = fakeEdited.root.id as ShapeId;
const minePose: Pose[] = [{ shapeId: cardId, matrix: [1.034, 0, 0, 1.034, 0, -6.6], opacity: 1 }];
const originalPose: Pose[] = [{ shapeId: cardId, matrix: [1.05, 0, 0, 1.05, 0, -9], opacity: 1 }];

type Props = { compare?: Compare };

export function StaticLayout({ compare = 'overlay' }: Props) {
  const selectedMine = fakeEdited.tracks[0];
  const selectedOriginal = fakeOriginal.tracks[0];
  if (selectedMine === undefined || selectedOriginal === undefined) return null;
  const playhead = PLAYHEAD_MS / selectedMine.timing.duration;

  return (
    <div className="mi">
      <div className="mi__inner">
        <header className="mi__top">
          <div>
            <p className="mi__description">
              The element moves up 6 px and scales to 1.03 over 340 ms. It starts fast, overshoots
              by 2%, then settles.
            </p>
            <p className="mi__source">
              <code>{fakeEdited.source.selector}</code> on example.com · 7 tracks · 1 not shown
            </p>
          </div>
          <div className="mi__actions">
            <Button>Reset all</Button>
            <Button>Copy CSS</Button>
            <Button primary>Copy for AI</Button>
          </div>
        </header>

        <div className="mi__grid">
          <div className="mi__column">
            <div>
              <Stage
                root={fakeEdited.root}
                mine={minePose}
                original={originalPose}
                compare={compare}
                ghostTrail={false}
                selectedShapeId={cardId}
              />
              <Playback playing={false} loop speed="1" timeMs={PLAYHEAD_MS} totalMs={TOTAL_MS} />
            </div>
            <Timeline
              tracks={tracks.slice(0, SHOWN_TRACKS)}
              hiddenCount={tracks.length - SHOWN_TRACKS}
              selectedId="0"
              totalMs={TOTAL_MS}
              playheadMs={PLAYHEAD_MS}
              delayTerm="transition-delay"
              durationTerm="transition-duration"
            />
          </div>

          <div className="mi__column">
            <CurveEditor
              original={selectedOriginal.timing.easing}
              mine={selectedMine.timing.easing}
              playhead={playhead}
              term="transition-timing-function"
            />
            <SpeedGraph
              original={selectedOriginal.timing.easing}
              mine={selectedMine.timing.easing}
              playhead={playhead}
            />
            <section className="panel">
              <header className="panel__head">
                <h2 className="panel__title">Not shown</h2>
              </header>
              <ul className="notes">
                {fakeEdited.notShown.map((note) => (
                  <li key={note}>{note}</li>
                ))}
                <li>
                  <code>filter</code> is not previewed on the stage. Its timing and curve can still
                  be edited.
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
