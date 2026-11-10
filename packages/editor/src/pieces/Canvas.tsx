// The one place that touches a <canvas> element. It sizes the canvas to its
// box, handles devicePixelRatio so lines stay sharp, and calls a pure draw
// function. It holds no drawing state: the same `draw` gives the same pixels.

import { useEffect, useRef, useState } from 'react';

export type Size = { width: number; height: number };

export type Draw = (context: CanvasRenderingContext2D, size: Size) => void;

type Props = {
  // What the canvas shows, for screen readers.
  label: string;
  // Height in CSS px. The width follows the container.
  height: number;
  draw: Draw;
};

export function Canvas({ label, height, draw }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  // Follow the container's width.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) setWidth(Math.round(box.width));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Redraw only when the size or the draw function changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    if (canvas === null || context === null || width === 0) return;
    const ratio = window.devicePixelRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    draw(context, { width, height });
  }, [draw, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas"
      role="img"
      aria-label={label}
      style={{ height }}
    />
  );
}
