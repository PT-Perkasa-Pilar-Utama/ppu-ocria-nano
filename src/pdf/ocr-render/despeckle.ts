// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): despeckle and is_bilevel_scan.

import { f32 } from "../../ocria/rust.js";
import { roundAway } from "../util.js";
import { PageObject } from "../pdfium/page-object.js";
import { imageBitsPerPixel } from "../pdfium/page-scan.js";
import type { Page } from "../pdfium/page.js";
import { MAX_IMAGE_PAGE_COVERAGE } from "./complexity.js";

/** The dpi a despeckle area and side limit are given at. */
const DESPECKLE_REF_DPI = 300;
const DESPECKLE_MAX_AREA_PX = 10;
const DESPECKLE_MAX_SIDE_PX = 5;
/** Below this dpi a speck cannot be told from a glyph dot. */
export const DESPECKLE_MIN_DPI = 200;
/** A page needs at least this many specks per square inch before any is removed. */
const DESPECKLE_MIN_DENSITY_PER_SQ_IN = 50;

/** One run of dark pixels in a row: `[y, x0, x1]`, inclusive. */
type Run = [number, number, number];
/** Per-blob `[area, minX, maxX, minY, maxY]`. */
type BlobStats = [number, number, number, number, number];

function find(parent: number[], start: number): number {
  let i = start;
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/**
 * `despeckle`: remove the isolated specks of a dotted or dithered scan background from an
 * interleaved 8-bit raster rendered at `dpi`, in place. A speck is an 8-connected blob of dark
 * (mean < 128) pixels within the area and side limits scaled to `dpi`. Specks are painted white
 * only when the page holds enough of them, so a clean page and its punctuation are never touched.
 * Returns how many specks were removed.
 */
export function despeckle(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  dpi: number
): number {
  if (width === 0 || height === 0 || dpi < DESPECKLE_MIN_DPI) return 0;
  const scale = f32(dpi / DESPECKLE_REF_DPI);
  const maxArea = roundAway(f32(f32(DESPECKLE_MAX_AREA_PX * scale) * scale));
  const maxSide = roundAway(f32(DESPECKLE_MAX_SIDE_PX * scale));
  const row = width * channels;
  const dark = (y: number, x: number): boolean => {
    let sum = 0;
    const base = y * row + x * channels;
    for (let c = 0; c < channels; c++) sum += pixels[base + c];
    return sum < 128 * channels;
  };

  // Runs of dark pixels, row by row.
  const runs: Run[] = [];
  const rowStart: number[] = [];
  for (let y = 0; y < height; y++) {
    rowStart.push(runs.length);
    let x = 0;
    while (x < width) {
      if (dark(y, x)) {
        const x0 = x;
        while (x < width && dark(y, x)) x += 1;
        runs.push([y, x0, x - 1]);
      } else {
        x += 1;
      }
    }
  }
  rowStart.push(runs.length);

  // Union runs that touch a run on the row above, diagonals included.
  const parent = runs.map((_, i) => i);
  for (let y = 1; y < height; y++) {
    const aboveEnd = rowStart[y];
    let j = rowStart[y - 1];
    for (let i = rowStart[y]; i < rowStart[y + 1]; i++) {
      const [, x0, x1] = runs[i];
      while (j < aboveEnd && runs[j][2] + 1 < x0) j += 1;
      let k = j;
      while (k < aboveEnd && runs[k][1] <= x1 + 1) {
        const a = find(parent, i);
        const b = find(parent, k);
        if (a !== b) parent[a] = b;
        k += 1;
      }
    }
  }

  // Area and bounds per blob.
  const stats: BlobStats[] = runs.map(() => [0, Infinity, 0, Infinity, 0]);
  for (let i = 0; i < runs.length; i++) {
    const [y, x0, x1] = runs[i];
    const s = stats[find(parent, i)];
    s[0] += x1 - x0 + 1;
    s[1] = Math.min(s[1], x0);
    s[2] = Math.max(s[2], x1);
    s[3] = Math.min(s[3], y);
    s[4] = Math.max(s[4], y);
  }
  const speck = (s: BlobStats): boolean =>
    s[0] > 0 && s[0] <= maxArea && s[2] - s[1] < maxSide && s[4] - s[3] < maxSide;
  const specks = stats.filter(speck).length;
  const sqIn = f32(f32(width / dpi) * f32(height / dpi));
  if (specks < f32(DESPECKLE_MIN_DENSITY_PER_SQ_IN * sqIn)) return 0;
  for (let i = 0; i < runs.length; i++) {
    if (!speck(stats[find(parent, i)])) continue;
    const [y, x0, x1] = runs[i];
    pixels.fill(255, y * row + x0 * channels, y * row + (x1 + 1) * channels);
  }
  return specks;
}

/** `is_bilevel_scan`: a full-page image object with one bit per pixel. */
export function isBilevelScan(page: Page): boolean {
  const pw = page.width();
  const ph = page.height();
  const covers = (w: number, h: number): boolean =>
    (w > f32(pw * MAX_IMAGE_PAGE_COVERAGE) && h > f32(ph * MAX_IMAGE_PAGE_COVERAGE)) ||
    (w > f32(ph * MAX_IMAGE_PAGE_COVERAGE) && h > f32(pw * MAX_IMAGE_PAGE_COVERAGE));
  const count = PageObject.count(page);
  for (let i = 0; i < count; i++) {
    const obj = PageObject.at(page, i);
    if (obj === null || obj.kind() !== "Image") continue;
    const b = obj.bounds();
    if (b === null) continue;
    if (
      covers(f32(b.right - b.left), Math.abs(f32(b.top - b.bottom))) &&
      imageBitsPerPixel(page, obj.handle) === 1
    )
      return true;
  }
  return false;
}
