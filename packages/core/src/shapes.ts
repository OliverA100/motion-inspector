// Small helpers for the shape tree.

import type { Shape, ShapeId } from './types';

// Every shape in the tree, parents before children.
export function flattenShapes(root: Shape): Shape[] {
  return [root, ...root.children.flatMap(flattenShapes)];
}

export function findShape(root: Shape, id: ShapeId): Shape | null {
  return flattenShapes(root).find((shape) => shape.id === id) ?? null;
}
