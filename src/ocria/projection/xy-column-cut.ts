// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): column-start histogram cut.

import { asUsize, f32, totalCmp } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import type { ProjectedTextItem } from "./types.js";
import type { LineStarts, Peak } from "./xy-column-peaks.js";
import {
  bandEnd,
  buildStartHistogram,
  clusterPeaks,
  collectLineStarts,
  xyPeakFillStats,
} from "./xy-column-peaks.js";
import type { CutCandidate } from "./xy-consts.js";
import {
  XY_COLUMN_BUCKET_PT,
  XY_COLUMN_MIN_FILL,
  XY_COLUMN_MIN_GAP_FRACTION,
  XY_COLUMN_MIN_LINES_PER_PEAK,
  XY_COLUMN_PEAK_BALANCE_RATIO,
  XY_COLUMN_PEAK_DOMINANCE,
  XY_COLUMN_PHANTOM_BAND_FRACTION,
  XY_HISTOGRAM_CUT_SCORE,
  isEquationNumber,
  isFormulaFragment,
} from "./xy-consts.js";

/** `tabular: &mut bool` of `xy_find_column_cut`: set when the fill gate classifies the region as a table. */
export type TabularFlag = { tabular: boolean };

/** Hard floor on the least-filled column of a 3+ column layout. */
const MIN_FILL_HARD_FLOOR: number = f32(0.38);

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/**
 * Keep only the two most common peaks when they dominate, or the peaks
 * balanced against the largest, or give up (`null`) when fewer than two remain.
 * Tabular layouts produce 3+ strong peaks with comparable counts, but a real
 * 2-column page can also produce 3+ peaks when a centered float (caption,
 * sub-heading stack, pull-quote) sits between the columns.
 */
function reducePeaks(peaks: Peak[]): Peak[] | null {
  if (peaks.length <= 2) return peaks;
  const byCount = [...peaks];
  byCount.sort((a, b) => b[1] - a[1]);
  const third = byCount[2][1];
  const second = byCount[1][1];
  const largest = byCount[0][1];
  if (second <= 0 || f32(third / second) >= XY_COLUMN_PEAK_BALANCE_RATIO) {
    // 3+ comparable peaks: a genuine N-column prose layout or a data table.
    // Keep every peak balanced against the largest and let the gap logic cut
    // the leftmost gutter; recursion peels the remaining columns one at a time.
    // The downstream dominance + min-gap guards still reject tables.
    const kept = peaks.filter(
      ([, c]) => largest <= 0 || f32(c / largest) >= XY_COLUMN_PEAK_BALANCE_RATIO
    );
    return kept.length < 2 ? null : kept;
  }
  // Top-2 dominate: assume real columns + weak floats. Keep top-2 (re-sorted left to right).
  const top2: Peak[] = [byCount[0], byCount[1]];
  top2.sort((a, b) => totalCmp(a[0], b[0]));
  return top2;
}

/** Fewer than two strong peaks: classify sparse raw peaks as tabular, never cut. */
function classifyRawPeaks(
  items: readonly ProjectedTextItem[],
  starts: LineStarts,
  rawCounts: readonly Peak[],
  nStarts: number,
  maxX: number,
  flag: TabularFlag
): void {
  // A table with a sparse row drops most peaks just under `adaptive_min`, so
  // the fill gate never runs and density V-cuts are free to slice the table's
  // cell gutters (transposing it column-major). 3+ balanced, dominant,
  // low-fill raw peaks are still tabular evidence.
  if (rawCounts.length < 3) return;
  const counts = rawCounts.map((p) => p[1]);
  const rawSum = counts.reduce((a, b) => a + b, 0);
  const rawMin = Math.min(...counts);
  const rawMax = Math.max(...counts);
  const balanced =
    rawMax > 0 && rawMin >= 2 && f32(rawMin / rawMax) >= XY_COLUMN_PEAK_BALANCE_RATIO;
  const dominance = f32(rawSum / Math.max(nStarts, 1));
  if (!(balanced && dominance >= XY_COLUMN_PEAK_DOMINANCE)) return;
  // The low-fill requirement matters: N-column prose whose short columns fell
  // under `adaptive_min` (newspaper pages, multi-column TOCs) matches the peak
  // shape but fills its slots nearly edge-to-edge.
  const rawPeaks = [...rawCounts];
  rawPeaks.sort((a, b) => totalCmp(a[0], b[0]));
  const [minFill, avgFill] = xyPeakFillStats(
    items,
    starts.sorted,
    rawPeaks,
    starts.bandTol,
    XY_COLUMN_BUCKET_PT,
    maxX
  );
  const sparse =
    (Number.isFinite(minFill) && minFill < MIN_FILL_HARD_FLOOR) ||
    (Number.isFinite(avgFill) && avgFill < XY_COLUMN_MIN_FILL);
  if (sparse) flag.tabular = true;
}

type BandStats = {
  coveredSum: number[];
  bandCount: number[];
  /** Bands where everything in the column is display math or an equation number. */
  mathBands: number[];
  /** `mathBands` plus formula fragments the math pass left as text. */
  formulaBands: number[];
};

function measureBands(
  items: readonly ProjectedTextItem[],
  starts: LineStarts,
  peaks: readonly Peak[],
  maxX: number
): BandStats {
  const n = peaks.length;
  const bucketPt = XY_COLUMN_BUCKET_PT;
  const { sorted, bandTol } = starts;
  const stats: BandStats = {
    coveredSum: zeros(n),
    bandCount: zeros(n),
    mathBands: zeros(n),
    formulaBands: zeros(n),
  };
  let kk = 0;
  while (kk < sorted.length) {
    const jj = bandEnd(items, sorted, kk, bandTol);
    const loX = Array.from({ length: n }, () => Infinity);
    const hiX = Array.from({ length: n }, () => -Infinity);
    const allMath = Array.from({ length: n }, () => true);
    const allFormula = Array.from({ length: n }, () => true);
    for (let q = kk; q < jj; q++) {
      const it = items[sorted[q]].item;
      if (!Number.isFinite(it.x)) continue;
      // Peak centers are bucket-quantized, so a column's items can start up to
      // a bucket left of its peak center; without the slack they all bin into
      // the previous slot and that column reads as empty.
      let c = 0;
      while (c + 1 < n && it.x >= f32(peaks[c + 1][0] - bucketPt)) c += 1;
      loX[c] = Math.min(loX[c], it.x);
      hiX[c] = Math.max(hiX[c], f32(it.x + Math.max(it.width, 0.0)));
      const math = it.math || isEquationNumber(it.text);
      allMath[c] = allMath[c] && math;
      allFormula[c] = allFormula[c] && (math || isFormulaFragment(it.text));
    }
    for (let c = 0; c < n; c++) {
      if (hiX[c] > loX[c]) {
        const colW = c + 1 < n ? f32(peaks[c + 1][0] - peaks[c][0]) : f32(maxX - peaks[c][0]);
        if (colW > 1.0) {
          stats.coveredSum[c] = f32(
            stats.coveredSum[c] + Math.min(f32(f32(hiX[c] - loX[c]) / colW), 1.0)
          );
          stats.bandCount[c] += 1;
          if (allMath[c]) stats.mathBands[c] += 1;
          if (allFormula[c]) stats.formulaBands[c] += 1;
        }
      }
    }
    kk = jj;
  }
  return stats;
}

/** `[min_fill, band-count-weighted avg_fill]` over the columns in `cols`, using `fillOf` per column. */
function fillOver(
  cols: readonly number[],
  bandCount: readonly number[],
  fillOf: (c: number) => number
): [number, number] {
  let minFill = Infinity;
  let weightedSum = 0.0;
  let weightedN = 0.0;
  for (const c of cols) {
    if (bandCount[c] > 0) {
      const f = fillOf(c);
      minFill = Math.min(minFill, f);
      weightedSum = f32(weightedSum + f32(f * bandCount[c]));
      weightedN = f32(weightedN + bandCount[c]);
    }
  }
  return [minFill, weightedN > 0.0 ? f32(weightedSum / weightedN) : Infinity];
}

/**
 * Fill-density gate: prose columns fill each inter-peak slot nearly
 * edge-to-edge; table cells leave wide whitespace. Applies to ALL peak counts
 * including 2: a 2-col label/value table produces the same two left-edge peaks
 * as 2-col prose, and slicing it strands each half in its own leaf where no
 * table detector can see the rows whole. Returns the surviving peaks, or null
 * (with the flag set) when the region reads as a table.
 *
 * Two-part gate: (1) a min_fill floor rejects pages where any column has
 * narrow text in many bands; (2) the band-count-weighted avg_fill must reach
 * `XY_COLUMN_MIN_FILL`, which catches tables whose columns are all uniformly
 * narrow. Both must pass.
 */
function fillGate(
  items: readonly ProjectedTextItem[],
  starts: LineStarts,
  peaksIn: readonly Peak[],
  maxX: number,
  flag: TabularFlag
): Peak[] | null {
  let peaks = [...peaksIn];
  let n = peaks.length;
  const { coveredSum, bandCount, mathBands, formulaBands } = measureBands(
    items,
    starts,
    peaks,
    maxX
  );
  const colFill = (c: number): number =>
    bandCount[c] > 0 ? f32(coveredSum[c] / bandCount[c]) : 0.0;
  const all = Array.from({ length: n }, (_, c) => c);
  let [minFill, avgFill] = fillOver(all, bandCount, colFill);
  // Figure-scatter phantom column: on a 2-column page with an embedded plot,
  // the plot's x-spread items form a third peak that is both sparsely-banded
  // and low-fill. Left in, it drags min_fill under the floor and flips the
  // whole region to `tabular`. A real narrow table column has a band count
  // comparable to its siblings, so the band-count ratio separates the two.
  // Drop phantom peaks when 2 or more well-filled columns survive, then
  // re-run the gate on them. (Upstream's LITEPARSE_DISABLE_PHANTOM_COL_DROP
  // env switch is a debug override; it is never set here.)
  if (n > 2) {
    const maxBands = Math.max(...bandCount);
    if (maxBands > 0) {
      const bandFloor = asUsize(Math.ceil(f32(maxBands * XY_COLUMN_PHANTOM_BAND_FRACTION)));
      // Display equations and their numbers inside a prose column line up into
      // the same sparse, low-fill peak; a column made mostly of math bands is a
      // phantom at any band count. Dropping still needs the surviving columns
      // to read as prose, so a numeric table column keeps the region tabular.
      const displayMath = (c: number): boolean =>
        mathBands[c] * 3 >= bandCount[c] && formulaBands[c] * 3 >= bandCount[c] * 2;
      const phantom = (c: number): boolean =>
        colFill(c) < MIN_FILL_HARD_FLOOR && (bandCount[c] < bandFloor || displayMath(c));
      const survivors = all.filter((c) => !phantom(c));
      const survivorsFilled = survivors.every((c) => colFill(c) >= MIN_FILL_HARD_FLOOR);
      if (survivors.length >= 2 && survivors.length < n && survivorsFilled) {
        peaks = survivors.map((c) => peaks[c]);
        n = peaks.length;
        [minFill, avgFill] = fillOver(survivors, bandCount, colFill);
      }
    }
  }
  // The min-floor catches 3+ column tables whose narrow numeric column is
  // diluted out of the weighted average by wide neighbors. With only 2 columns
  // no dilution is possible, and a short second prose column (a page-bottom
  // column with a few bands) would false-positive here.
  if (n > 2 && Number.isFinite(minFill) && minFill < MIN_FILL_HARD_FLOOR) {
    flag.tabular = true;
    return null;
  }
  if (Number.isFinite(avgFill) && avgFill < XY_COLUMN_MIN_FILL) {
    flag.tabular = true;
    return null;
  }
  return peaks;
}

/**
 * Place the cut at the actual gutter of the leftmost peak pair that clears
 * `XY_COLUMN_MIN_GAP_FRACTION x total_w` (list-item / block-quote indents
 * produce closely spaced peaks). For N columns, peeling the leftmost column
 * first and letting the recursion re-run on the remainder splits the rest one
 * gutter at a time.
 */
function gutterCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  peaks: readonly Peak[],
  countedStarts: readonly number[],
  minX: number,
  maxX: number
): CutCandidate | null {
  const totalW = f32(maxX - minX);
  const minGap = f32(totalW * XY_COLUMN_MIN_GAP_FRACTION);
  let li = -1;
  for (let w = 0; w < peaks.length - 1; w++) {
    if (f32(peaks[w + 1][0] - peaks[w][0]) >= minGap) {
      li = w;
      break;
    }
  }
  if (li < 0) return null;
  // Place the cut at the actual gutter, not midway between peak centers.
  // Peaks mark column LEFT edges, so the center midpoint lands inside the
  // left column's text span and misroutes its mid-line items under
  // partition_by_item. The gutter spans from the rightmost left-side item
  // extent to the right column's leftmost counted start, NOT the peak center:
  // a right-aligned numeric column scatters its starts left of the
  // bucket-quantized center.
  const midCenters = f32(f32(peaks[li][0] + peaks[li + 1][0]) * 0.5);
  let rightMinStart = Infinity;
  for (const x of countedStarts) if (x > midCenters) rightMinStart = Math.min(rightMinStart, x);
  const boundary = Number.isFinite(rightMinStart) ? rightMinStart : peaks[li + 1][0];
  let gutterLeft = -Infinity;
  for (const i of idxs) {
    const it = items[i].item;
    if (Number.isFinite(it.x)) {
      const r = f32(it.x + Math.max(it.width, 0.0));
      if (r <= f32(boundary - 1.0) && r > gutterLeft) gutterLeft = r;
    }
  }
  const cutX =
    Number.isFinite(gutterLeft) && gutterLeft > peaks[li][0]
      ? f32(f32(gutterLeft + boundary) * 0.5)
      : midCenters;
  // Validate cut lands inside the bbox; if bbox-clamping moved the bbox off
  // the items (some PDFs have content with negative x), fall back to an
  // item-relative midpoint check.
  if (cutX <= f32(minX + 1.0) || cutX >= f32(maxX - 1.0)) return null;
  // High finite score so this beats every density cut but stays below banner's infinity.
  return { axis: "Vertical", position: cutX, score: XY_HISTOGRAM_CUT_SCORE };
}

/**
 * Fallback column-gutter detector for cases where the density-based V-cut
 * search finds no valley, typically because a column-spanning element (wide
 * heading, figure, table) fills the gutter at one y-band and inflates the
 * projection at the gutter's x. Detects 2+ column structure by clustering the
 * left edges of "narrow" lines. When two clusters with enough lines each are
 * separated by at least `XY_COLUMN_MIN_GAP_FRACTION x bbox.width`, returns a
 * V-cut at the gutter with a high score so it beats any density-based cut
 * except banner.
 */
export function xyFindColumnCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  bbox: Rect,
  medianH: number,
  flag: TabularFlag
): CutCandidate | null {
  if (bbox.width <= 1.0 || idxs.length < 8) return null;
  const starts = collectLineStarts(items, idxs, medianH);
  if (starts.line_starts.length < 8) return null;

  // Histogram extent uses full item bounds so `XY_COLUMN_MIN_GAP_FRACTION`
  // calibration (fraction of layout width) is preserved. Only line-starts
  // contribute to the bucket counts and the dominance denominator.
  let minX = Infinity;
  let maxX = -Infinity;
  for (const i of idxs) {
    const it = items[i].item;
    if (Number.isFinite(it.x)) {
      minX = Math.min(minX, it.x);
      maxX = Math.max(maxX, f32(it.x + Math.max(it.width, 0.0)));
    }
  }
  if (!Number.isFinite(minX) || maxX <= f32(minX + 1.0)) return null;
  const totalW = f32(maxX - minX);
  const nBuckets = Math.max(asUsize(Math.ceil(f32(totalW / XY_COLUMN_BUCKET_PT))), 1);
  const {
    hist,
    counted_starts: countedStarts,
    rescued,
  } = buildStartHistogram(starts, minX, nBuckets);
  const nStarts = starts.line_starts.length + rescued;

  // Keep only "strong" peaks. A real column edge is stacked by many lines at
  // the same left x; spurious peaks (a stray indented quote, a numbered
  // marker) carry only a few lines.
  const rawCounts = clusterPeaks(hist, minX);
  // Adaptive minimum: scale with how many line-starts the band actually has.
  // The static `XY_COLUMN_MIN_LINES_PER_PEAK = 10` floor drops indented-paragraph
  // false peaks on a large region, but on smaller regions it can drop legitimate
  // column peaks too. Use `clamp(n_starts / 6, 4, 10)`: usize division truncates.
  const adaptiveMin = Math.min(Math.max(Math.floor(nStarts / 6), 4), XY_COLUMN_MIN_LINES_PER_PEAK);
  let peaks = rawCounts.filter(([, c]) => c >= adaptiveMin);
  if (peaks.length < 2) {
    classifyRawPeaks(items, starts, rawCounts, nStarts, maxX, flag);
    return null;
  }
  peaks.sort((a, b) => totalCmp(a[0], b[0]));

  // Tabular layouts produce 3+ strong peaks (one per cell column). Real page
  // columns have exactly 2 dominant peaks (left edge of col 1, left edge of
  // col 2): even multi-paragraph indents are sub-peaks weak enough to drop out.
  const reduced = reducePeaks(peaks);
  if (reduced === null) return null;
  const gated = fillGate(items, starts, reduced, maxX, flag);
  if (gated === null) return null;
  peaks = gated;

  // Require the peaks to together dominate the histogram: a real 2-column
  // layout has the great majority of items starting at one of the
  // column-left edges. Tables, lists, and prose with scattered indents
  // distribute their item-starts across many x's and won't pass.
  const peakSum = peaks.reduce((a, [, c]) => a + c, 0);
  const dominance = f32(peakSum / nStarts);
  if (dominance < XY_COLUMN_PEAK_DOMINANCE) return null;
  // Require the peaks to be roughly balanced in size. A tall + tiny peak pair
  // (a long single column with one bullet stack at a different x) must not
  // trigger a column split. Check the global min/max across all kept peaks.
  const smallest = Math.min(...peaks.map((p) => p[1]));
  const largest = Math.max(...peaks.map((p) => p[1]));
  const balance = largest > 0 ? f32(smallest / largest) : 0.0;
  if (balance < XY_COLUMN_PEAK_BALANCE_RATIO) return null;

  return gutterCut(items, idxs, peaks, countedStarts, minX, maxX);
}
