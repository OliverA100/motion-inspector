// Notes a capture lists under "not shown", and which of them say that motion
// is left out of the preview.

// Whether a "not shown" note is about motion the preview leaves out. Four
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
    note.endsWith('Its motion is measured from the page instead.')
  );
}
