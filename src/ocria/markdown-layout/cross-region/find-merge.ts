// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/cross_region.rs (crates-v2.21.2, Apache-2.0): the cross-region table re-merge.

// When the XY-cut commits a V-cut *through* a table (the column gutter of the
// table looks like a layout gutter), the table's lines land in two or more
// sibling leaves and no per-region detector ever sees the rows whole. This
// pass runs before region grouping: it finds side-by-side leaf groups whose
// baselines align across the cut, fuses the same-baseline lines back into
// single rows, and validates that the fused zone actually classifies as a
// table. Only on successful validation are the original lines replaced: a
// failed candidate leaves the page untouched, so the V-cut's wins on
// multi-column prose are preserved.

import { f32, charCount, trim } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";
import type { TableRun } from "../tables/types.js";
import { clusterRows, fuseCluster } from "./clusters.js";
import {
  CR_MIN_ALIGNED_FRAC,
  CR_MIN_ALIGNED_ROWS,
  CR_MIN_COL_GAP_PT,
  CR_MIN_Y_OVERLAP_FRAC,
  CR_PROSE_LEAF_MIN_CHARS,
  CR_ROW_TOL_FACTOR,
  CR_SIBLING_MAX_X_OVERLAP_FRAC,
} from "./constants.js";
import {
  buildLeaves,
  commonPathPrefix,
  median,
  sideLooksLikeProse,
  siblingVCutPair,
} from "./leaves.js";
import type { Leaf } from "./leaves.js";
import { tryTwoColDirect, validateViaDetectors } from "./validate.js";

/**
 * A validated cross-region merge: replace `lines[start..end]` with `merged`
 * (all sharing one synthetic region path) and hand `runs` (indices local to
 * `merged`) to the region classifier so the table emission is guaranteed.
 */
export type CrossRegionMerge = {
  start: number;
  end: number;
  merged: ProjectedLine[];
  runs: TableRun[];
};

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** The leaf pair's `[left, right]` order, or null when the two cannot be sliced halves of one table. */
function orderPair(a: Leaf, b: Leaf, lines: ProjectedLine[]): [Leaf, Leaf] | null {
  if (a.x1 <= f32(b.x0 - CR_MIN_COL_GAP_PT)) return [a, b];
  if (b.x1 <= f32(a.x0 - CR_MIN_COL_GAP_PT)) return [b, a];
  // Direct siblings of one region-tree node that overlap in y can only come
  // from a V-cut. Their bbox x-extents may overlap (table rows straddling the
  // cut widen the leaf), so the disjointness test above misses them.
  if (siblingVCutPair(a, b, lines)) return a.x0 <= b.x0 ? [a, b] : [b, a];
  return null;
}

/**
 * Grow the pair's leaf set to every leaf inside the overlap band that sits on
 * one side of the cut, then close over interleaved leaves inside the selected
 * line range. Returns the leaves and their line range, or null when the leaves
 * do not tile it.
 */
function leafSetAround(
  leaves: Leaf[],
  left: Leaf,
  right: Leaf,
  cutX: number
): { setLeaves: number[]; lo: number; hi: number } | null {
  // Union band: a tall side may pair with the first of several stacked leaves
  // on the other side; the extension below pulls the rest in, so the band must
  // cover both sides fully.
  const bandLo = f32(Math.min(left.y0, right.y0) - 2.0);
  const bandHi = f32(Math.max(left.y1, right.y1) + 2.0);
  const staysOnOneSide = (leaf: Leaf): boolean => {
    const width = Math.max(f32(leaf.x1 - leaf.x0), 1.0);
    const center = f32(f32(leaf.x0 + leaf.x1) * 0.5);
    const overhang =
      center < cutX ? Math.max(f32(leaf.x1 - cutX), 0.0) : Math.max(f32(cutX - leaf.x0), 0.0);
    return overhang <= f32(CR_SIBLING_MAX_X_OVERLAP_FRAC * width);
  };

  // Extend the pair to every leaf living inside the overlap band and entirely
  // on one side of the cut (a side may itself be H-cut into multiple leaves).
  const setLeaves: number[] = [];
  leaves.forEach((leaf, k) => {
    const leafH = Math.max(f32(leaf.y1 - leaf.y0), 1.0);
    const leafOv = f32(Math.min(leaf.y1, bandHi) - Math.max(leaf.y0, bandLo));
    if (leafOv < f32(0.5 * leafH)) return;
    // The leaf must sit predominantly on one side of the cut: its overhang
    // across the cut stays within the straddle allowance (widened slices),
    // measured against its own width.
    if (staysOnOneSide(leaf)) setLeaves.push(k);
  });
  if (setLeaves.length < 2) return null;

  // Close over interleaved leaves inside the selected line range. Do not
  // extend the y-band here: only the original candidate set uses that test,
  // while closure admits intervening leaves that remain predominantly on one
  // side of the same cut.
  const range = (): [number, number] => [
    Math.min(...setLeaves.map((k) => leaves[k].start)),
    Math.max(...setLeaves.map((k) => leaves[k].end)),
  ];
  let [lo, hi] = range();
  for (;;) {
    const covered = sum(setLeaves.map((k) => leaves[k].end - leaves[k].start));
    if (covered === hi - lo) break;
    const additions: number[] = [];
    leaves.forEach((leaf, k) => {
      if (!setLeaves.includes(k) && leaf.start >= lo && leaf.end <= hi && staysOnOneSide(leaf)) {
        additions.push(k);
      }
    });
    if (additions.length === 0) break;
    setLeaves.push(...additions);
    [lo, hi] = range();
  }
  const covered = sum(setLeaves.map((k) => leaves[k].end - leaves[k].start));
  if (covered !== hi - lo) return null;
  return { setLeaves, lo, hi };
}

/** Whether the cut separates flowing prose: either side, or any one leaf of a 3+ leaf side. */
function cutSeparatesProse(
  lines: ProjectedLine[],
  leaves: Leaf[],
  setLeaves: number[],
  leftLines: ProjectedLine[],
  rightLines: ProjectedLine[]
): boolean {
  const extent = (ls: ProjectedLine[]): [number, number] => [
    Math.min(Infinity, ...ls.map((l) => l.bbox.x)),
    Math.max(-Infinity, ...ls.map((l) => f32(l.bbox.x + l.bbox.width))),
  ];
  const [lx0, lx1] = extent(leftLines);
  const [rx0, rx1] = extent(rightLines);
  // Either side reading as flowing prose means the V-cut was right: a body
  // column next to a sidebar / second column must stay split. A side made of
  // several leaves (two columns left of a third) is judged leaf by leaf as
  // well: lumped together its lines fill only part of the side's width. A leaf
  // holding one table column fills its own width too, so a prose leaf must also
  // run to sentence-length lines.
  const leafIsProse = (): boolean =>
    setLeaves.length > 2 &&
    setLeaves.some((k) => {
      const leaf = leaves[k];
      const ls = lines.slice(leaf.start, leaf.end);
      const chars = median(ls.map((l) => f32(charCount(trim(l.text)))));
      return chars >= CR_PROSE_LEAF_MIN_CHARS && sideLooksLikeProse(ls, leaf.x0, leaf.x1);
    });
  return (
    sideLooksLikeProse(leftLines, lx0, lx1) ||
    sideLooksLikeProse(rightLines, rx0, rx1) ||
    leafIsProse()
  );
}

/**
 * Find one validated cross-region table merge on this page, or null. Callers
 * may re-invoke on the spliced result to catch multiple sliced tables per page.
 */
export function findCrossRegionTableMerge(lines: ProjectedLine[]): CrossRegionMerge | null {
  const leaves = buildLeaves(lines);
  if (leaves.length < 2) return null;

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const pair = orderPair(leaves[i], leaves[j], lines);
      if (pair == null) continue;
      const [left, right] = pair;
      const ov = f32(Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
      const minH = Math.max(Math.min(f32(left.y1 - left.y0), f32(right.y1 - right.y0)), 1.0);
      if (ov < f32(CR_MIN_Y_OVERLAP_FRAC * minH)) continue;
      // For disjoint sides this is the gutter midpoint; for overlapping sibling
      // slices it's the midpoint of the contested band.
      const cutX = f32(f32(Math.min(left.x1, right.x1) + Math.max(right.x0, left.x0)) * 0.5);
      const around = leafSetAround(leaves, left, right, cutX);
      if (around == null) continue;
      const { setLeaves, lo, hi } = around;

      // Split the set's lines into sides of the cut.
      const set: Array<[ProjectedLine, boolean]> = [];
      for (const k of setLeaves) {
        const leaf = leaves[k];
        const isLeft = f32(f32(leaf.x0 + leaf.x1) * 0.5) < cutX;
        for (const l of lines.slice(leaf.start, leaf.end)) set.push([l, isLeft]);
      }
      const leftLines = set.filter(([, s]) => s).map(([l]) => l);
      const rightLines = set.filter(([, s]) => !s).map(([l]) => l);
      if (leftLines.length === 0 || rightLines.length === 0) continue;

      // Anti-prose gate: two side-by-side prose columns must stay split.
      if (cutSeparatesProse(lines, leaves, setLeaves, leftLines, rightLines)) continue;

      // Row alignment across the cut.
      const tol = f32(CR_ROW_TOL_FACTOR * Math.max(median(set.map(([l]) => l.bbox.height)), 1.0));
      const clusters = clusterRows(set, tol);
      const aligned = clusters.filter((c) => c.left.length > 0 && c.right.length > 0).length;
      const minSide = Math.min(leftLines.length, rightLines.length);
      if (aligned < CR_MIN_ALIGNED_ROWS || aligned < f32(CR_MIN_ALIGNED_FRAC * f32(minSide))) {
        continue;
      }

      // Fuse and validate.
      const path = commonPathPrefix(set.map(([l]) => l));
      const merged = clusters.map((c) => fuseCluster(c, path));
      const runs = validateViaDetectors(merged) ?? tryTwoColDirect(clusters, merged.length, tol);
      if (runs == null) continue;
      return { start: lo, end: hi, merged, runs };
    }
  }
  return null;
}
