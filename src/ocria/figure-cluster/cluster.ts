// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/figure_cluster.rs (crates-v2.21.2, Apache-2.0): spatial clustering of primitive boxes.

import { asUsize, f32 } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import { FIG_CLUSTER_GAP_PT, FIG_GRID_CELL_PT } from "./constants.js";

/** Union-find root with path compression. */
export function ufFind(parent: number[], x0: number): number {
  let x = x0;
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}

export function ufUnion(parent: number[], a: number, b: number): void {
  const ra = ufFind(parent, a);
  const rb = ufFind(parent, b);
  if (ra !== rb) parent[ra] = rb;
}

export function closeEnough(a: Rect, b: Rect, gap: number): boolean {
  const xGap = Math.max(f32(a.x - f32(b.x + b.width)), f32(b.x - f32(a.x + a.width)));
  const yGap = Math.max(f32(a.y - f32(b.y + b.height)), f32(b.y - f32(a.y + a.height)));
  return xGap <= gap && yGap <= gap;
}

/**
 * Cluster boxes with a uniform grid: only boxes sharing a grid cell (after
 * expanding each by half the gap) are compared. Returns the union-find parent array.
 */
export function clusterBboxesSpatial(
  bboxes: readonly Rect[],
  pageWidth: number,
  pageHeight: number
): number[] {
  const parent: number[] = bboxes.map((_, i) => i);
  if (bboxes.length === 0) return parent;

  const halfGap = f32(FIG_CLUSTER_GAP_PT / 2.0);
  const expandedBounds = (bbox: Rect): [number, number, number, number] => {
    const right = f32(bbox.x + bbox.width);
    const bottom = f32(bbox.y + bbox.height);
    return [
      f32(Math.min(bbox.x, right) - halfGap),
      f32(Math.min(bbox.y, bottom) - halfGap),
      f32(Math.max(bbox.x, right) + halfGap),
      f32(Math.max(bbox.y, bottom) + halfGap),
    ];
  };
  const columns = asUsize(Math.floor(f32(pageWidth / FIG_GRID_CELL_PT))) + 1;
  const rows = asUsize(Math.floor(f32(pageHeight / FIG_GRID_CELL_PT))) + 1;
  const cells: number[][] = Array.from({ length: columns * rows }, () => []);

  const cellIndex = (coord: number, count: number): number =>
    Math.min(asUsize(Math.floor(f32(coord / FIG_GRID_CELL_PT))), count - 1);
  bboxes.forEach((bbox, i) => {
    const [left, top, right, bottom] = expandedBounds(bbox);
    const firstCol = cellIndex(left, columns);
    const lastCol = cellIndex(right, columns);
    const firstRow = cellIndex(top, rows);
    const lastRow = cellIndex(bottom, rows);
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) cells[row * columns + col].push(i);
    }
  });

  for (const cell of cells) {
    for (let first = 0; first < cell.length; first++) {
      const i = cell[first];
      for (let k = first + 1; k < cell.length; k++) {
        const j = cell[k];
        if (ufFind(parent, i) === ufFind(parent, j)) continue;
        if (closeEnough(bboxes[i], bboxes[j], FIG_CLUSTER_GAP_PT)) ufUnion(parent, i, j);
      }
    }
  }
  return parent;
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(f32(a.x + a.width), f32(b.x + b.width));
  const y2 = Math.max(f32(a.y + a.height), f32(b.y + b.height));
  return { x, y, width: f32(x2 - x), height: f32(y2 - y) };
}
