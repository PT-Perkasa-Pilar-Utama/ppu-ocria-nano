// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): ruled-grid segment helpers.

import { f32, totalCmp } from "../../rust.js";
import type { GraphicPrimitive } from "../../types/geometry.js";

// A ruled table is found by extracting the page's horizontal and vertical
// rules, clustering rules that share a coordinate, and grouping the rules that
// cross each other with a union-find into one component per table.

/**
 * Horizontal segment in viewport coords (top-left origin). `y` is the rule's
 * y-position; `x_min..x_max` is its horizontal span. Endpoints of multiple
 * short segments sharing a y get unioned into one wider segment during
 * clustering.
 */
export type HSeg = { x_min: number; x_max: number; y: number };

export type VSeg = { y_min: number; y_max: number; x: number };

/**
 * Strokes are considered "axis-aligned" when the perpendicular delta is at
 * most this many points. Generous to absorb antialiased near-pixel strokes.
 */
export const TABLE_AXIS_TOLERANCE_PT = 1.0;

/**
 * Two H lines (or two V lines) are merged into one grid line when their
 * perpendicular coords are within this many points. Slightly looser than the
 * axis tolerance because rules drawn at the same row can have +-1pt jitter
 * from different stroke widths.
 */
export const TABLE_GRID_CLUSTER_PT = 2.0;

/**
 * Slack added when checking whether a V line "crosses" an H line. Helps
 * when rules don't quite reach the corner because the PDF drew them as
 * individual segments with small gaps.
 */
export const TABLE_CROSS_TOLERANCE_PT = 3.0;

/** Reject candidates whose grid covers nearly the whole page: almost always a page border. */
export const TABLE_MAX_PAGE_COVERAGE: number = f32(0.95);

/**
 * Extract horizontal and vertical line segments from a page's graphics. Each
 * `Stroke` becomes one HSeg or VSeg depending on orientation; each stroked
 * `Rect` contributes its four edges (cell-border rects, table frames).
 */
export function extractHVSegments(graphics: readonly GraphicPrimitive[]): [HSeg[], VSeg[]] {
  const hs: HSeg[] = [];
  const vs: VSeg[] = [];
  for (const g of graphics) {
    if ("Stroke" in g) {
      const { x1, y1, x2, y2 } = g.Stroke;
      const dy = Math.abs(f32(y1 - y2));
      const dx = Math.abs(f32(x1 - x2));
      if (dy <= TABLE_AXIS_TOLERANCE_PT && dx > 1.0) {
        hs.push({ x_min: Math.min(x1, x2), x_max: Math.max(x1, x2), y: f32(f32(y1 + y2) * 0.5) });
      } else if (dx <= TABLE_AXIS_TOLERANCE_PT && dy > 1.0) {
        vs.push({ y_min: Math.min(y1, y2), y_max: Math.max(y1, y2), x: f32(f32(x1 + x2) * 0.5) });
      }
    } else {
      const { bbox, stroke } = g.Rect;
      if (stroke == null) continue;
      const top = bbox.y;
      const bottom = f32(bbox.y + bbox.height);
      const left = bbox.x;
      const right = f32(bbox.x + bbox.width);
      if (bbox.width > 1.0) {
        hs.push({ x_min: left, x_max: right, y: top });
        hs.push({ x_min: left, x_max: right, y: bottom });
      }
      if (bbox.height > 1.0) {
        vs.push({ y_min: top, y_max: bottom, x: left });
        vs.push({ y_min: top, y_max: bottom, x: right });
      }
    }
  }
  return [hs, vs];
}

/**
 * Cluster H segments sharing a y-coordinate (within `TABLE_GRID_CLUSTER_PT`)
 * into a single wider grid line whose x-extent is the union of the inputs.
 * Works on copies: the Rust takes `Copy` structs by value, so the caller's segments stay as extracted.
 */
export function clusterHSegments(input: readonly HSeg[]): HSeg[] {
  if (input.length === 0) return [];
  const segs = input.map((s) => ({ ...s }));
  segs.sort((a, b) => totalCmp(a.y, b.y));
  const out: HSeg[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && Math.abs(f32(last.y - seg.y)) <= TABLE_GRID_CLUSTER_PT) {
      last.x_min = Math.min(last.x_min, seg.x_min);
      last.x_max = Math.max(last.x_max, seg.x_max);
      continue;
    }
    out.push(seg);
  }
  return out;
}

export function clusterVSegments(input: readonly VSeg[]): VSeg[] {
  if (input.length === 0) return [];
  const segs = input.map((s) => ({ ...s }));
  segs.sort((a, b) => totalCmp(a.x, b.x));
  const out: VSeg[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && Math.abs(f32(last.x - seg.x)) <= TABLE_GRID_CLUSTER_PT) {
      last.y_min = Math.min(last.y_min, seg.y_min);
      last.y_max = Math.max(last.y_max, seg.y_max);
      continue;
    }
    out.push(seg);
  }
  return out;
}

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

/**
 * Group H/V grid lines that cross each other into connected components.
 * Each component is a candidate ruled table, typically one per distinct table
 * on the page. Returns `[h_indices, v_indices]` per component, dropping
 * components without 2 or more H and 2 or more V lines (a single L-shape
 * doesn't make a table).
 */
export function findGridComponents(
  hs: readonly HSeg[],
  vs: readonly VSeg[]
): Array<[number[], number[]]> {
  const nH = hs.length;
  const nV = vs.length;
  if (nH < 2 || nV < 2) return [];
  const n = nH + nV;
  const parent: number[] = Array.from({ length: n }, (_, i) => i);
  const connected: boolean[] = Array.from({ length: n }, () => false);

  const tol = TABLE_CROSS_TOLERANCE_PT;
  for (let i = 0; i < nH; i++) {
    const h = hs[i];
    for (let j = 0; j < nV; j++) {
      const v = vs[j];
      const vCrossesHx = v.x >= f32(h.x_min - tol) && v.x <= f32(h.x_max + tol);
      const hCrossesVy = h.y >= f32(v.y_min - tol) && h.y <= f32(v.y_max + tol);
      if (vCrossesHx && hCrossesVy) {
        ufUnion(parent, i, nH + j);
        connected[i] = true;
        connected[nH + j] = true;
      }
    }
  }

  // Rust collects into a HashMap and sorts the components afterwards; a Map
  // plus the same sort gives the same result because the sort key (the first
  // H index of a component) is unique per component.
  const groups = new Map<number, [number[], number[]]>();
  const group = (r: number): [number[], number[]] => {
    let g = groups.get(r);
    if (!g) {
      g = [[], []];
      groups.set(r, g);
    }
    return g;
  };
  for (let i = 0; i < nH; i++) {
    if (!connected[i]) continue;
    group(ufFind(parent, i))[0].push(i);
  }
  for (let j = 0; j < nV; j++) {
    if (!connected[nH + j]) continue;
    group(ufFind(parent, nH + j))[1].push(j);
  }
  const comps = [...groups.values()].filter(([h, v]) => h.length >= 2 && v.length >= 2);
  // Rust: `HashMap::into_values` order is random; sorting by the topmost
  // horizontal-segment index keeps table emission order stable.
  comps.sort((a, b) => a[0][0] - b[0][0]);
  return comps;
}
