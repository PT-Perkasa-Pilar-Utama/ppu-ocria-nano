// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): XY-cut recursion.

import { f32, totalCmp } from "../rust.js";
import type { Rect, Region } from "../types/geometry.js";
import type { ProjectedTextItem } from "./types.js";
import { xyFindBannerCut, xyFindCrossingLineCut } from "./xy-banner-cut.js";
import { xExtent, xyDistinctLines, xySplitBbox } from "./xy-bbox.js";
import { xyFindColumnCut } from "./xy-column-cut.js";
import { bandEnd } from "./xy-column-peaks.js";
import type { CutCandidate } from "./xy-consts.js";
import {
  XY_HISTOGRAM_CUT_SCORE,
  XY_MAX_DEPTH,
  XY_MIN_ITEMS_TO_CUT,
  XY_MIN_LINES_PER_H_SIDE,
  XY_V_PREFERENCE_MARGIN,
} from "./xy-consts.js";
import { xyFindBestCut } from "./xy-find-cut.js";

/** Fraction of rows that must straddle a histogram cut for it to partition item by item. */
const STRADDLE_PARTITION_FRACTION: number = f32(0.25);

/** A cut is a column-histogram V-cut when it carries that cut's score. */
function isHistogramVCut(cut: CutCandidate): boolean {
  return cut.axis === "Vertical" && Math.abs(f32(cut.score - XY_HISTOGRAM_CUT_SCORE)) < 1.0;
}

/**
 * X position of the vertical gutter that splits `idxs` (within `bbox`) into
 * columns, from the density V-cut or the column-start histogram fallback.
 * `null` when the region is single-column. Used to decide whether peeling a
 * wide spanning line above this region is productive.
 */
function columnCutX(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  bbox: Rect,
  medianH: number,
  figures: readonly Rect[]
): number | null {
  const cut =
    xyFindBestCut(items, idxs, bbox, "Vertical", medianH, figures) ??
    xyFindColumnCut(items, idxs, bbox, medianH, { tabular: false });
  return cut === null ? null : cut.position;
}

/**
 * Column-histogram V-cuts split between two column left-edge clusters. The cut
 * sits at the midpoint between the two peak x's, which is typically far inside
 * the left column. PDFium routinely emits a single visual line as multiple
 * items; an item-by-item partition by `it.x` would split one logical line
 * across both sides whenever a continuation fragment starts past the cut.
 *
 * So first measure how many y-bands have items on both sides of the cut
 * ("straddling rows"). A real column boundary has every body row straddling:
 * partition by `it.x`. An intra-column histogram split has almost no
 * straddling rows: partition by row leftmost-x so a wrapped line stays whole.
 */
export function partitionHistogramVCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  cut: CutCandidate,
  medianH: number
): [number[], number[]] {
  const left: number[] = [];
  const right: number[] = [];
  // Sort by y then x so items on one baseline cluster together.
  const sortedIdxs = [...idxs];
  sortedIdxs.sort(
    (a, b) =>
      totalCmp(items[a].item.y, items[b].item.y) || totalCmp(items[a].item.x, items[b].item.x)
  );
  const bandTol = Math.max(f32(medianH * 0.5), 2.0);

  // First pass: count rows with items on both sides of the cut.
  let rowsTotal = 0;
  let rowsStraddle = 0;
  let k = 0;
  while (k < sortedIdxs.length) {
    const j = bandEnd(items, sortedIdxs, k, bandTol);
    let hasLeft = false;
    let hasRight = false;
    for (let q = k; q < j; q++) {
      const ix = items[sortedIdxs[q]].item.x;
      if (Number.isFinite(ix)) {
        if (ix < cut.position) hasLeft = true;
        else hasRight = true;
      }
    }
    if (hasLeft || hasRight) {
      rowsTotal += 1;
      if (hasLeft && hasRight) rowsStraddle += 1;
    }
    k = j;
  }
  // 25% threshold: when a quarter or more of rows have content on both sides
  // of the cut, it's a real column boundary. Below that, the cut sits inside a
  // single column and the rare straddler is an intra-column wrapped line that
  // must not be torn apart.
  const partitionByItem =
    rowsTotal > 0 && f32(rowsStraddle / rowsTotal) >= STRADDLE_PARTITION_FRACTION;

  if (partitionByItem) {
    for (const i of idxs) {
      if (items[i].item.x < cut.position) left.push(i);
      else right.push(i);
    }
    return [left, right];
  }
  k = 0;
  while (k < sortedIdxs.length) {
    const j = bandEnd(items, sortedIdxs, k, bandTol);
    let minX = Infinity;
    for (let q = k; q < j; q++) {
      const ix = items[sortedIdxs[q]].item.x;
      if (Number.isFinite(ix) && ix < minX) minX = ix;
    }
    const sideLeft = minX < cut.position;
    for (let q = k; q < j; q++) (sideLeft ? left : right).push(sortedIdxs[q]);
    k = j;
  }
  return [left, right];
}

/** Partition by item centre. Density V-cuts only fire where a text-free band exists, so a crossing item is genuinely wider than the column. */
function partitionByCentroid(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  cut: CutCandidate
): [number[], number[]] {
  const left: number[] = [];
  const right: number[] = [];
  for (const i of idxs) {
    const it = items[i].item;
    const splitAt =
      cut.axis === "Horizontal"
        ? f32(it.y + f32(Math.max(it.height, 0.0) * 0.5))
        : f32(it.x + f32(Math.max(it.width, 0.0) * 0.5));
    if (splitAt < cut.position) left.push(i);
    else right.push(i);
  }
  return [left, right];
}

/**
 * A single wide spanning line (e.g. a centered authors / affiliation line
 * above a two-column body) is worth isolating even mid-recursion when peeling
 * it reveals the column gutter underneath. Otherwise the spanning line
 * straddles the gutter, the V-cut can never fire, and the whole body
 * interleaves column-by-column. The thin side must be one line whose x-extent
 * crosses the gutter revealed on the other (multi-line) side.
 */
function spanningRescue(
  items: readonly ProjectedTextItem[],
  left: readonly number[],
  right: readonly number[],
  leftBbox: Rect,
  rightBbox: Rect,
  lc: number,
  rc: number,
  medianH: number,
  figures: readonly Rect[]
): boolean {
  let thin: readonly number[];
  let thinLines: number;
  let wide: readonly number[];
  let wideBbox: Rect;
  if (lc < XY_MIN_LINES_PER_H_SIDE && rc >= XY_MIN_LINES_PER_H_SIDE) {
    [thin, thinLines, wide, wideBbox] = [left, lc, right, rightBbox];
  } else if (rc < XY_MIN_LINES_PER_H_SIDE && lc >= XY_MIN_LINES_PER_H_SIDE) {
    [thin, thinLines, wide, wideBbox] = [right, rc, left, leftBbox];
  } else {
    return false;
  }
  if (thinLines > 1) return false;
  const gx = columnCutX(items, wide, wideBbox, medianH, figures);
  if (gx === null) return false;
  const [tx0, tx1] = xExtent(items, thin);
  return tx0 < f32(gx - 1.0) && tx1 > f32(gx + 1.0);
}

type CandidateCuts = { candidates: CutCandidate[]; effectiveTabular: boolean };

/**
 * The cuts to try, in priority order: banner, crossing line, histogram
 * column, density H/V by score margin, then the histogram column as a last
 * resort.
 */
function candidateCuts(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  bbox: Rect,
  inheritedTabular: boolean,
  medianH: number,
  figures: readonly Rect[]
): CandidateCuts {
  // Banner cut wins over density-based valleys. Score is Infinity so the
  // existing comparison logic naturally selects it.
  const banner = xyFindBannerCut(items, idxs, bbox, medianH);
  const h = xyFindBestCut(items, idxs, bbox, "Horizontal", medianH, figures);
  const v = xyFindBestCut(items, idxs, bbox, "Vertical", medianH, figures);

  // Fallback column-start histogram. Only used as a cut when BOTH density cuts
  // returned None: those are the cases (wide-heading filled gutter,
  // figure-straddle layouts) where the column structure is real but the
  // density projection can't see it. Run the probe unconditionally: its fill
  // gate is also the region-level table detector. When it rejects with
  // "tabular", density V-cuts must not slice the table's inter-column gutters.
  const flag = { tabular: false };
  const columnFull = xyFindColumnCut(items, idxs, bbox, medianH, flag);
  const effectiveTabular = flag.tabular || (inheritedTabular && columnFull === null);
  const column = v === null && h === null ? columnFull : null;
  // Upstream's LITEPARSE_DISABLE_VCUT_MINLINES env switch is a debug override; it is never set here.
  const preferHOverV =
    h !== null && v !== null ? v.score <= f32(h.score * XY_V_PREFERENCE_MARGIN) : true;
  const candidates: CutCandidate[] = [];
  if (banner !== null) candidates.push(banner);
  // A line that crosses the would-be gutter (a section heading, a spanning
  // float) separates column runs; the gutter is the density valley's when
  // there is one, else the column histogram's, which crossing lines don't
  // block. Cut above it before cutting columns, or the columns of every
  // section join into one page-long column and a heading is sliced in two.
  const gutter = v ?? columnFull;
  if (!effectiveTabular && gutter !== null) {
    const hc = xyFindCrossingLineCut(items, idxs, gutter.position, medianH);
    if (hc !== null) candidates.push(hc);
  }
  if (column !== null) candidates.push(column);
  // Primary density cut, then the other axis as fallback. When the histogram
  // fill gate classified this region as tabular, a density V valley here is a
  // table gutter, not a column boundary: suppress it so the table reaches the
  // table detectors row-major.
  const vUsed = effectiveTabular ? null : v;
  const ordered = preferHOverV ? [h, vUsed] : [vUsed, h];
  for (const c of ordered) if (c !== null) candidates.push(c);
  // Final fallback: re-use the unconditional column-histogram probe. Skipped
  // when an existing candidate is already a histogram-derived column cut.
  if (!candidates.some(isHistogramVCut) && columnFull !== null) candidates.push(columnFull);
  return { candidates, effectiveTabular };
}

export function xyCutRec(
  items: readonly ProjectedTextItem[],
  idxs: number[],
  bbox: Rect,
  depth: number,
  inheritedTabular: boolean,
  medianH: number,
  figures: readonly Rect[]
): Region {
  if (idxs.length <= XY_MIN_ITEMS_TO_CUT || depth >= XY_MAX_DEPTH) {
    return { bbox, kind: { Leaf: { item_indices: idxs } } };
  }
  const { candidates, effectiveTabular } = candidateCuts(
    items,
    idxs,
    bbox,
    inheritedTabular,
    medianH,
    figures
  );

  for (const cut of candidates) {
    const [left, right] = isHistogramVCut(cut)
      ? partitionHistogramVCut(items, idxs, cut, medianH)
      : partitionByCentroid(items, idxs, cut);
    if (left.length === 0 || right.length === 0) continue;
    const [leftBbox, rightBbox] = xySplitBbox(bbox, cut);

    // Banner cuts (score = Infinity) at the page root are explicitly meant to
    // isolate single-line wide headers like titles, so skip the min-lines
    // guard for them. At deeper recursion levels we keep the guard: an
    // aggressive single-line banner cut mid-recursion fragments paragraphs
    // around emphasized lines.
    const allowSingleLine = cut.axis === "Horizontal" && !Number.isFinite(cut.score) && depth === 0;
    if (cut.axis === "Horizontal" && !allowSingleLine) {
      const lc = xyDistinctLines(items, left, medianH);
      const rc = xyDistinctLines(items, right, medianH);
      const rescue = spanningRescue(
        items,
        left,
        right,
        leftBbox,
        rightBbox,
        lc,
        rc,
        medianH,
        figures
      );
      if ((lc < XY_MIN_LINES_PER_H_SIDE || rc < XY_MIN_LINES_PER_H_SIDE) && !rescue) continue;
    }
    // Vertical (column) min-lines guard. A real column gutter is sustained
    // across multiple stacked lines on both sides. A vertical cut that isolates
    // a single-line "column" is a false gutter: in single-column justified
    // prose, a short final line plus a wide inter-word gap in the line above
    // align an empty vertical band that is not a column boundary.
    if (cut.axis === "Vertical") {
      const lc = xyDistinctLines(items, left, medianH);
      const rc = xyDistinctLines(items, right, medianH);
      if (lc < XY_MIN_LINES_PER_H_SIDE || rc < XY_MIN_LINES_PER_H_SIDE) continue;
    }

    const childInheritedTabular = effectiveTabular && cut.axis === "Horizontal";
    const leftRegion = xyCutRec(
      items,
      left,
      leftBbox,
      depth + 1,
      childInheritedTabular,
      medianH,
      figures
    );
    const rightRegion = xyCutRec(
      items,
      right,
      rightBbox,
      depth + 1,
      childInheritedTabular,
      medianH,
      figures
    );
    return { bbox, kind: { Split: { axis: cut.axis, children: [leftRegion, rightRegion] } } };
  }
  return { bbox, kind: { Leaf: { item_indices: idxs } } };
}
