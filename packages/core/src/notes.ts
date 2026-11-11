// Notes a capture lists under "not shown", and which of them say that motion
// is left out of the preview.

// A hover whose way back has no animation: the transition is only in the
// :hover rule, so the page snaps back as the pointer leaves (found on
// Mercury and Dub). Said, so a hover recorded alone does not read as a
// leave that was missed.
export const SNAPS_BACK_NOTE =
  'When the pointer leaves, the page goes back at once: there is no animation on the way back.';

// Whether a "not shown" note is about motion the preview leaves out. Some
// are not: parts that do not move, left out to keep the drawing simple (a
// part that moves is in the take, or in what it missed); a gradient drawn
// as its average color; a take whose motion ends where it starts; and a
// part turned in 3D, drawn flat as it looks (the check measures that). They
// are still listed; the badge does not count them.
export function aboutMotion(note: string): boolean {
  return !(
    note.endsWith('left out of the drawing, to keep it simple.') ||
    note.startsWith('A gradient is drawn as the average') ||
    note.endsWith('so there is nothing to see.') ||
    note.endsWith('It is shown flat, as it looks on the page.') ||
    // Restarts shown as measured motion: nothing is left out.
    note.endsWith('Its motion is measured from the page instead.') ||
    // A way back with no animation: there is none to leave out.
    note === SNAPS_BACK_NOTE
  );
}
