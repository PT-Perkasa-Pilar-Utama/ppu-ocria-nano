// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): banner and crossing-line cuts.

import { f32, totalCmp } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import type { ProjectedTextItem } from "./types.js";
import type { CutCandidate } from "./xy-consts.js";
import { XY_BANNER_CLEARANCE_FACTOR, XY_BANNER_WIDTH_FRACTION } from "./xy-consts.js";

/** Item indices sorted by y (stable, like Rust's `sort_by`). */
function sortedByY(items: readonly ProjectedTextItem[], idxs: readonly number[]): number[] {
  const sorted = [...idxs];
  sorted.sort((a, b) => totalCmp(items[a].item.y, items[b].item.y));
  return sorted;
}

/** `[y_min, y_max, crosses]` */
type CrossBand = [number, number, boolean];

/**
 * Horizontal cut that isolates lines crossing a vertical gutter at `gutterX`
 * (see `xyCutRec`). A band crosses when one of its items reaches at least three
 * line heights past the gutter on both sides (a heading or float spanning the
 * columns, not a line of the left column overhanging a misplaced gutter), and
 * at most a third of the bands cross. Cuts above the first crossing band that
 * has non-crossing bands above it; when the crossing bands only open the
 * region, cuts below them.
 */
export function xyFindCrossingLineCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  gutterX: number,
  medianH: number
): CutCandidate | null {
  const sorted = sortedByY(items, idxs);
  const bandTol = Math.max(f32(medianH * 0.5), 2.0);
  const reach = f32(3.0 * Math.max(medianH, 4.0));
  const bands: CrossBand[] = [];
  for (const i of sorted) {
    const it = items[i].item;
    const y0 = it.y;
    const y1 = f32(it.y + Math.max(it.height, 0.0));
    const crosses = it.x < f32(gutterX - reach) && f32(it.x + it.width) > f32(gutterX + reach);
    const last = bands[bands.length - 1];
    if (
      last &&
      (y0 <= f32(last[1] - bandTol) ||
        Math.abs(f32(y0 - f32(f32(last[0] + last[1]) * 0.5))) <= bandTol)
    ) {
      last[0] = Math.min(last[0], y0);
      last[1] = Math.max(last[1], y1);
      last[2] = last[2] || crosses;
    } else {
      bands.push([y0, y1, crosses]);
    }
  }
  // Spanning lines are a minority of a region's lines; when most lines cross, the gutter is
  // misplaced (inside a column), not crossed.
  const crossing = bands.filter((b) => b[2]).length;
  if (bands.length < 3 || crossing === 0 || crossing * 3 > bands.length) return null;
  const between = (a: number): CutCandidate => ({
    axis: "Horizontal",
    position: f32(f32(bands[a][1] + bands[a + 1][0]) * 0.5),
    score: Infinity,
  });
  const first = bands.findIndex((b) => b[2]);
  if (first < 0) return null;
  if (first > 0) return between(first - 1);
  const firstOpen = bands.findIndex((b) => !b[2]);
  if (firstOpen < 0) return null;
  return between(firstOpen - 1);
}

/** `[y_min, y_max, x_min, x_max]` */
type BannerBand = [number, number, number, number];

/**
 * Detect a "banner" y-band: one or more vertically-adjacent wide text bands
 * (at least `XY_BANNER_WIDTH_FRACTION` of bbox width) flanked by a clear
 * vertical gap from the rest of the content. Returns an H-cut that isolates
 * the banner from neighboring content.
 *
 * Motivating case: a full-width centered title + authors block above a
 * 2-column body where a figure straddles both columns. Density-based XY-cut
 * can't separate them because the figure prevents any clean V-cut and there's
 * no obvious H-valley between the banner and the body. The banner detector
 * runs first and force-cuts just below the banner stack, freeing the
 * recursion to find normal column gutters in the lower region.
 *
 * Also helps mid-document section headings that span the full content width.
 */
export function xyFindBannerCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  bbox: Rect,
  medianH: number
): CutCandidate | null {
  if (bbox.width <= 1.0 || idxs.length < 2) return null;
  const sorted = sortedByY(items, idxs);
  const bandTol = Math.max(f32(medianH * 0.5), 2.0);
  const minClearance = Math.max(f32(medianH * XY_BANNER_CLEARANCE_FACTOR), 8.0);
  const widthThreshold = f32(XY_BANNER_WIDTH_FRACTION * bbox.width);

  // Group items into y-bands. A new item joins the current band when its top
  // is within `band_tol` of either the band's center or its existing bottom
  // (handles slight baseline variation).
  const bands: BannerBand[] = [];
  for (const i of sorted) {
    const it = items[i].item;
    const y0 = it.y;
    const y1 = f32(it.y + Math.max(it.height, 0.0));
    const x0 = it.x;
    const x1 = f32(it.x + Math.max(it.width, 0.0));
    const last = bands[bands.length - 1];
    if (last) {
      const center = f32(f32(last[0] + last[1]) * 0.5);
      if (Math.abs(f32(y0 - center)) <= bandTol || y0 <= f32(last[1] + bandTol)) {
        last[0] = Math.min(last[0], y0);
        last[1] = Math.max(last[1], y1);
        last[2] = Math.min(last[2], x0);
        last[3] = Math.max(last[3], x1);
        continue;
      }
    }
    bands.push([y0, y1, x0, x1]);
  }
  if (bands.length === 0) return null;
  const isWide = (b: BannerBand): boolean => f32(b[3] - b[2]) >= widthThreshold;

  // Walk top to bottom. For each run of consecutive wide bands (close enough
  // to each other to count as a single banner stack), check above/below
  // clearance and emit a cut if isolated.
  let i = 0;
  while (i < bands.length) {
    if (!isWide(bands[i])) {
      i += 1;
      continue;
    }
    const start = i;
    let end = i;
    // Extend through consecutive wide bands separated by less than the
    // clearance threshold: multi-line title + authors counts as one banner stack.
    while (
      end + 1 < bands.length &&
      isWide(bands[end + 1]) &&
      f32(bands[end + 1][0] - bands[end][1]) < minClearance
    ) {
      end += 1;
    }
    const bannerTop = bands[start][0];
    const bannerBot = bands[end][1];
    const aboveY = start > 0 ? bands[start - 1][1] : null;
    const belowY = end + 1 < bands.length ? bands[end + 1][0] : null;
    const aboveClear = aboveY === null || f32(bannerTop - aboveY) >= minClearance;
    const belowClear = belowY === null || f32(belowY - bannerBot) >= minClearance;

    if (aboveClear && belowClear) {
      // Prefer cutting BELOW the banner so it becomes the top region of the
      // split (matches natural reading order). Fall back to cutting above only
      // when there's nothing below to cut against.
      let cutY: number;
      if (belowY !== null) {
        cutY = f32(f32(bannerBot + belowY) * 0.5);
      } else if (aboveY !== null) {
        cutY = f32(f32(aboveY + bannerTop) * 0.5);
      } else {
        // Banner spans the whole region: no productive cut.
        i = end + 1;
        continue;
      }
      // Skip degenerate cuts that would leave one side empty.
      if (cutY > f32(bbox.y + 1.0) && cutY < f32(f32(bbox.y + bbox.height) - 1.0)) {
        return { axis: "Horizontal", position: cutY, score: Infinity };
      }
    }
    i = end + 1;
  }
  return null;
}
