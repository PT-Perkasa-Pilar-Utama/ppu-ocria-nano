// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/cross_region.rs (crates-v2.21.2, Apache-2.0): region-tree leaves and prose gates.

import { f32, totalCmp } from "../../rust.js";
import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import { lineItemsInReadingOrder, splitCells } from "../tables/borderless/index.js";
import {
  CR_PROSE_MAX_MULTI_CELL_FRAC,
  CR_PROSE_MIN_LINES,
  CR_PROSE_VFILL,
  CR_PROSE_WIDTH_FRAC,
  CR_SIBLING_MAX_X_OVERLAP_FRAC,
} from "./constants.js";

/** Source items of every line in `lines`, in reading order. */
export function unionLineItems(lines: readonly ProjectedLine[]): number[] {
  return lines.flatMap((l) => lineItemsInReadingOrder(l));
}

/** Union of the boxes of every line in `lines`, or null when empty. */
export function unionLineRects(lines: readonly ProjectedLine[]): Rect | null {
  let out: Rect | undefined;
  for (const l of lines) out = rectExtend(out, l.bbox);
  return out ?? null;
}

/** A run of consecutive lines sharing one region path, with its extent. */
export type Leaf = {
  start: number;
  end: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

function sameArray(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * True when two leaves are direct children of the same region-tree node and
 * overlap only modestly in x: the signature of a V-cut whose slices were
 * widened by straddling rows.
 */
export function siblingVCutPair(a: Leaf, b: Leaf, lines: ProjectedLine[]): boolean {
  const pa = lines[a.start].region_path;
  const pb = lines[b.start].region_path;
  if (
    pa.length !== pb.length ||
    pa.length === 0 ||
    !sameArray(pa.slice(0, pa.length - 1), pb.slice(0, pb.length - 1))
  ) {
    return false;
  }
  const xOverlap = f32(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const narrow = Math.max(Math.min(f32(a.x1 - a.x0), f32(b.x1 - b.x0)), 1.0);
  return xOverlap < f32(CR_SIBLING_MAX_X_OVERLAP_FRAC * narrow);
}

export function buildLeaves(lines: ProjectedLine[]): Leaf[] {
  const leaves: Leaf[] = [];
  let s = 0;
  while (s < lines.length) {
    const path = lines[s].region_path;
    let e = s + 1;
    while (e < lines.length && sameArray(lines[e].region_path, path)) e++;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const l of lines.slice(s, e)) {
      x0 = Math.min(x0, l.bbox.x);
      x1 = Math.max(x1, f32(l.bbox.x + l.bbox.width));
      y0 = Math.min(y0, l.bbox.y);
      y1 = Math.max(y1, f32(l.bbox.y + l.bbox.height));
    }
    leaves.push({ start: s, end: e, x0, x1, y0, y1 });
    s = e;
  }
  return leaves;
}

export function median(v: number[]): number {
  if (v.length === 0) return 0.0;
  const sorted = [...v].sort(totalCmp);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Longest common prefix of the region paths of all lines in the set. */
export function commonPathPrefix(lines: readonly ProjectedLine[]): number[] {
  let prefix = [...lines[0].region_path];
  for (const l of lines.slice(1)) {
    let n = 0;
    while (n < prefix.length && n < l.region_path.length && prefix[n] === l.region_path[n]) n++;
    prefix = prefix.slice(0, n);
  }
  return prefix;
}

/** `[width_fill, vertical_fill]` of a side's line set. */
export function sideProseMetrics(
  side: readonly ProjectedLine[],
  sideX0: number,
  sideX1: number
): [number, number] {
  const sideWidth = Math.max(f32(sideX1 - sideX0), 1.0);
  const medWidth = median(side.map((l) => l.bbox.width));
  let y0 = Infinity;
  let y1 = -Infinity;
  let sumH = 0.0;
  for (const l of side) {
    y0 = Math.min(y0, l.bbox.y);
    y1 = Math.max(y1, f32(l.bbox.y + l.bbox.height));
    sumH = f32(sumH + l.bbox.height);
  }
  return [f32(medWidth / sideWidth), f32(sumH / Math.max(f32(y1 - y0), 1.0))];
}

/**
 * Does this side's line set look like a column of flowing prose? Dense
 * vertical fill + lines that fill the column width. A table fragment has
 * short, sparse lines on at least one side.
 */
export function sideLooksLikeProse(
  side: readonly ProjectedLine[],
  sideX0: number,
  sideX1: number
): boolean {
  if (side.length < CR_PROSE_MIN_LINES) return false;
  const [widthFill, vfill] = sideProseMetrics(side, sideX0, sideX1);
  if (widthFill < CR_PROSE_WIDTH_FRAC || vfill < CR_PROSE_VFILL) return false;
  // A sliced *wide* table's row-halves also fill their side's width and
  // y-band, but they carry internal cell gaps; flowing prose doesn't.
  const multiCell = side.filter((l) => splitCells(l).length >= 2).length;
  return multiCell < f32(CR_PROSE_MAX_MULTI_CELL_FRAC * f32(side.length));
}
