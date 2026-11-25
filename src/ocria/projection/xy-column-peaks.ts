// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): column-start histogram and peaks.

import { asUsize, f32, totalCmp } from "../rust.js";
import type { ProjectedTextItem } from "./types.js";
import { XY_COLUMN_BUCKET_PT } from "./xy-consts.js";

/** A histogram peak: `[x_center, line_count]`. */
export type Peak = [number, number];

/** The y-banded line starts of a region (see `collectLineStarts`). */
export type LineStarts = {
  /** Item indices sorted by y, then x. */
  sorted: number[];
  bandTol: number;
  line_starts: number[];
  near_starts: number[];
};

/** End (exclusive) of the y-band that starts at `sorted[start]`. */
export function bandEnd(
  items: readonly ProjectedTextItem[],
  sorted: readonly number[],
  start: number,
  bandTol: number
): number {
  const by = items[sorted[start]].item.y;
  let j = start;
  while (j < sorted.length && Math.abs(f32(items[sorted[j]].item.y - by)) <= bandTol) j++;
  return j;
}

/**
 * Identify "line-start" items: within each y-band, the first item of each
 * horizontal run is a line-start. PDFium routinely emits mid-line word-cluster
 * fragments as separate items; counting all of them in the histogram
 * denominator dilutes the column-dominance ratio. A 2-column line at the same
 * baseline contributes TWO line-starts (one per column) because the
 * inter-column gutter exceeds `gutter_gap`.
 */
export function collectLineStarts(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  medianH: number
): LineStarts {
  const bandTol = Math.max(f32(medianH * 0.5), 2.0);
  // OCR items are whole detected lines, not PDF word fragments: two of them in one band
  // are split at a column gutter (or a cell boundary, which the fill gate handles),
  // never at a word space. Scans' tight gutters (~0.6-0.8 line heights on newspaper pages)
  // fail the native one-line-height test, and the near-start rescue needs sub-point edge
  // alignment that OCR boxes don't have, so N-column scans were read row by row.
  const ocrItems = idxs.filter((i) => items[i].item.confidence != null).length;
  const gutterGap =
    ocrItems * 2 > idxs.length ? Math.max(f32(medianH * 0.5), 4.0) : Math.max(medianH, 4.0);

  const sorted = [...idxs];
  sorted.sort(
    (a, b) =>
      totalCmp(items[a].item.y, items[b].item.y) || totalCmp(items[a].item.x, items[b].item.x)
  );

  const lineStarts: number[] = [];
  // Items whose gap to the previous item falls just under `gutter_gap` but
  // clearly above word-gap range. A tight column gutter fails the strict test
  // on justified lines whose left column runs right up to the gutter; these
  // get a second chance if their x aligns with a column peak that has strict
  // evidence.
  const nearStarts: number[] = [];
  const nearGapFloor = f32(gutterGap * 0.6);
  let k = 0;
  while (k < sorted.length) {
    const j = bandEnd(items, sorted, k, bandTol);
    const bandItems = sorted.slice(k, j);
    bandItems.sort((a, b) => totalCmp(items[a].item.x, items[b].item.x));
    let prevRight = -Infinity;
    for (const idx of bandItems) {
      const it = items[idx].item;
      if (Number.isFinite(it.x)) {
        const gap = f32(it.x - prevRight);
        if (gap > gutterGap) lineStarts.push(it.x);
        else if (gap > nearGapFloor) nearStarts.push(it.x);
      }
      const right = f32(it.x + Math.max(it.width, 0.0));
      if (right > prevRight) prevRight = right;
    }
    k = j;
  }
  return { sorted, bandTol, line_starts: lineStarts, near_starts: nearStarts };
}

/** Bucket index of `x` in a histogram starting at `minX` (`floor(...).max(0) as usize`). */
function bucketOf(x: number, minX: number, bucketPt: number): number {
  return asUsize(Math.max(Math.floor(f32(f32(x - minX) / bucketPt)), 0.0));
}

export type StartHistogram = {
  hist: number[];
  /** Line starts plus the rescued near starts. */
  counted_starts: number[];
  rescued: number;
};

/**
 * Histogram of line-start x's. Peak-aligned rescue for tight gutters: a
 * near-gap start only counts when it lands at (nearly) the same x as existing
 * strict-evidence starts. A column left edge aligns to sub-point precision
 * across bands; word-gap "rivers" in justified text jitter by several points.
 * Require near-exact agreement with at least 2 strict starts.
 */
export function buildStartHistogram(
  starts: LineStarts,
  minX: number,
  nBuckets: number
): StartHistogram {
  const bucketPt = XY_COLUMN_BUCKET_PT;
  const hist: number[] = Array.from({ length: nBuckets }, () => 0);
  for (const x of starts.line_starts) {
    const b = bucketOf(x, minX, bucketPt);
    if (b < nBuckets) hist[b] += 1;
  }
  let rescued = 0;
  const countedStarts = [...starts.line_starts];
  const RESCUE_ALIGN_TOL_PT = 1.5;
  for (const x of starts.near_starts) {
    const support = starts.line_starts.filter(
      (s) => Math.abs(f32(s - x)) <= RESCUE_ALIGN_TOL_PT
    ).length;
    if (support >= 2) {
      const b = bucketOf(x, minX, bucketPt);
      if (b < nBuckets) {
        hist[b] += 1;
        rescued += 1;
        countedStarts.push(x);
      }
    }
  }
  return { hist, counted_starts: countedStarts, rescued };
}

/**
 * Cluster adjacent occupied buckets into peaks. A peak is a contiguous run of
 * buckets with 1 or more counts, merged through gaps of at most 2 zero buckets
 * (~10pt) to absorb slight intra-column drift.
 */
export function clusterPeaks(hist: readonly number[], minX: number): Peak[] {
  const nBuckets = hist.length;
  const peaks: Peak[] = [];
  let i = 0;
  while (i < nBuckets) {
    if (hist[i] === 0) {
      i += 1;
      continue;
    }
    const s = i;
    let total = 0;
    let lastNonzero = i;
    let j = i;
    while (j < nBuckets) {
      if (hist[j] > 0) {
        total += hist[j];
        lastNonzero = j;
        j += 1;
      } else if (j - lastNonzero <= 2) {
        j += 1;
      } else {
        break;
      }
    }
    const xCenter = f32(
      minX + f32(f32(XY_COLUMN_BUCKET_PT * f32(f32(s + lastNonzero) + 1.0)) * 0.5)
    );
    peaks.push([xCenter, total]);
    i = j;
  }
  return peaks;
}

/**
 * Per-column fill for a candidate peak set: per y-band covered x-span / slot
 * width, averaged per column. Returns `[min_fill, band-count-weighted
 * avg_fill]`, the same statistics as `xyFindColumnCut`'s main fill gate.
 * `sorted` must be y-then-x sorted item indices; `peaks` left to right.
 */
export function xyPeakFillStats(
  items: readonly ProjectedTextItem[],
  sorted: readonly number[],
  peaks: readonly Peak[],
  bandTol: number,
  bucketPt: number,
  maxX: number
): [number, number] {
  const n = peaks.length;
  const coveredSum: number[] = Array.from({ length: n }, () => 0);
  const bandCount: number[] = Array.from({ length: n }, () => 0);
  let kk = 0;
  while (kk < sorted.length) {
    const jj = bandEnd(items, sorted, kk, bandTol);
    const loX: number[] = Array.from({ length: n }, () => Infinity);
    const hiX: number[] = Array.from({ length: n }, () => -Infinity);
    for (let q = kk; q < jj; q++) {
      const it = items[sorted[q]].item;
      if (!Number.isFinite(it.x)) continue;
      let c = 0;
      while (c + 1 < n && it.x >= f32(peaks[c + 1][0] - bucketPt)) c += 1;
      loX[c] = Math.min(loX[c], it.x);
      hiX[c] = Math.max(hiX[c], f32(it.x + Math.max(it.width, 0.0)));
    }
    for (let c = 0; c < n; c++) {
      if (hiX[c] > loX[c]) {
        const colW = c + 1 < n ? f32(peaks[c + 1][0] - peaks[c][0]) : f32(maxX - peaks[c][0]);
        if (colW > 1.0) {
          coveredSum[c] = f32(coveredSum[c] + Math.min(f32(f32(hiX[c] - loX[c]) / colW), 1.0));
          bandCount[c] += 1;
        }
      }
    }
    kk = jj;
  }
  let minFill = Infinity;
  let weightedSum = 0.0;
  let weightedN = 0.0;
  for (let c = 0; c < n; c++) {
    if (bandCount[c] > 0) {
      const f = f32(coveredSum[c] / bandCount[c]);
      minFill = Math.min(minFill, f);
      weightedSum = f32(weightedSum + f32(f * bandCount[c]));
      weightedN = f32(weightedN + bandCount[c]);
    }
  }
  const avgFill = weightedN > 0.0 ? f32(weightedSum / weightedN) : Infinity;
  return [minFill, avgFill];
}
