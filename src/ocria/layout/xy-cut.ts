// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): xy_cut_order, find_gap and xy_cut.

import { f32, totalCmp } from "../rust.js";
import type { LayoutBlock } from "./types.js";

/** `[x0, y0, x1, y1]`. */
type Box = [number, number, number, number];

/** `f32::max`: a NaN operand yields the other. */
function max(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.max(a, b);
}

/**
 * A gap of at least `min` between the intervals `[lo, hi)` of `ids` along one axis (`a` = 0 for
 * x, 1 for y): the widest, or with `first` the lowest; its cut position and width.
 */
function findGap(
  boxes: readonly Box[],
  ids: readonly number[],
  a: 0 | 1,
  min: number,
  first: boolean
): [number, number] | null {
  const iv: Array<[number, number]> = ids.map((i) => [boxes[i][a], boxes[i][a + 2]]);
  iv.sort((p, q) => totalCmp(p[0], q[0]));
  let best: [number, number] | null = null;
  let reach = Number.NEGATIVE_INFINITY;
  for (const [lo, hi] of iv) {
    const gap = f32(lo - reach);
    if (reach > Number.NEGATIVE_INFINITY && gap >= min && (best === null || gap > best[1])) {
      best = [f32(f32(lo + reach) / 2), gap];
      if (first) break;
    }
    reach = max(reach, hi);
  }
  return best;
}

function xyCut(boxes: readonly Box[], ids: number[], out: number[]): void {
  if (ids.length <= 1) {
    out.push(...ids);
    return;
  }
  let axis: 0 | 1;
  let cut: number;
  const vertical = findGap(boxes, ids, 0, 4, false);
  const horizontal = vertical === null ? findGap(boxes, ids, 1, 1, true) : null;
  if (vertical !== null) {
    axis = 0;
    cut = vertical[0];
  } else if (horizontal !== null) {
    axis = 1;
    cut = horizontal[0];
  } else {
    ids.sort((a, b) => totalCmp(boxes[a][1], boxes[b][1]) || totalCmp(boxes[a][0], boxes[b][0]));
    out.push(...ids);
    return;
  }
  const first: number[] = [];
  const second: number[] = [];
  for (const i of ids) {
    const centre = f32(f32(boxes[i][axis] + boxes[i][axis + 2]) / 2);
    (centre < cut ? first : second).push(i);
  }
  xyCut(boxes, first, out);
  xyCut(boxes, second, out);
}

/**
 * Block indices in reading order by recursive XY-cut over the block boxes: a region splits at a
 * vertical gutter clear of every block top to bottom (columns, read left to right) when there
 * is one (the widest), else at its topmost horizontal gap (the band above it first); a region with neither
 * reads top to bottom, then left to right. Blocks covering half the page or more (full-bleed
 * backgrounds) would hide every gutter, so they come first and take no part in the cuts.
 */
export function xyCutOrder(blocks: readonly LayoutBlock[], pageArea: number): number[] {
  const rect = (i: number): { x: number; y: number; width: number; height: number } =>
    blocks[i].bbox ?? { x: 0, y: 0, width: 0, height: 0 };
  const order: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const r = rect(i);
    const full = pageArea > 0 && f32(r.width * r.height) >= f32(0.5 * pageArea);
    (full ? order : rest).push(i);
  }
  const boxes: Box[] = blocks.map((_, i) => {
    const r = rect(i);
    return [r.x, r.y, f32(r.x + r.width), f32(r.y + r.height)];
  });
  xyCut(boxes, rest, order);
  return order;
}
