// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): column and row boundary helpers.

import { clamp, f32, trim } from "../../../rust.js";
import type { TextItem } from "../../../types/text-item.js";
import { verifiedWords } from "../borderless/index.js";

/**
 * Single-link cluster a sorted list of boundary coordinates, replacing each
 * chain of entries (adjacent gap <= `tol`) with its mean. Unlike
 * `dedupClose` (keep-first), the mean centers the boundary between the paired
 * edges that cell-border rects produce (left border strip + right border strip
 * of adjacent cells, typically 4-6pt apart), so the split target lands between
 * cells rather than inside one. Mutates `v`.
 */
export function clusterBoundaries(v: number[], tol: number): void {
  if (v.length < 2) return;
  const out: number[] = [];
  let clusterSum = v[0];
  let clusterN = 1;
  let last = v[0];
  for (let i = 1; i < v.length; i++) {
    const x = v[i];
    if (f32(x - last) <= tol) {
      clusterSum = f32(clusterSum + x);
      clusterN += 1;
    } else {
      out.push(f32(clusterSum / clusterN));
      clusterSum = x;
      clusterN = 1;
    }
    last = x;
  }
  out.push(f32(clusterSum / clusterN));
  v.splice(0, v.length, ...out);
}

/** In-place dedup of a sorted list, collapsing entries within `tol` to the first of each cluster. */
export function dedupClose(v: number[], tol: number): void {
  if (v.length < 2) return;
  const out: number[] = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(f32(x - last)) <= tol) continue;
    out.push(x);
  }
  v.splice(0, v.length, ...out);
}

/**
 * Distribute a multi-column run's words into ruled columns by each word's own
 * centre, returning `[column, text]` pairs in column order.
 *
 * This replaces guessing a split point from a character index: with word boxes
 * the answer is simply which cell each word sits in. Returns null when the run
 * has no verified word geometry, or when every word lands in one column; in
 * that case the caller's whole-span fallbacks are the honest answer, since the
 * run only *overlaps* the neighbouring cell (padding, an overhanging
 * descender) rather than genuinely spanning it.
 */
export function bucketWordsIntoColumns(
  span: TextItem,
  xs: readonly number[]
): Array<[number, string]> | null {
  const words = verifiedWords(span);
  if (words == null) return null;
  const out: Array<[number, string]> = [];
  for (const w of words) {
    const last = xs[xs.length - 1];
    if (last === undefined) return null;
    const cx = clamp(f32(w.x + f32(Math.max(w.width, 0) * 0.5)), xs[0], last);
    const col = findBucket(xs, cx);
    if (col == null) return null;
    const tail = out[out.length - 1];
    if (tail !== undefined && tail[0] === col) {
      tail[1] = `${tail[1]} ${trim(w.text)}`;
    } else {
      out.push([col, trim(w.text)]);
    }
  }
  // Words must not zig-zag back into an earlier column, and the run must
  // really occupy more than one.
  if (out.length < 2) return null;
  for (let i = 0; i + 1 < out.length; i++) if (out[i + 1][0] <= out[i][0]) return null;
  return out;
}

/** The bucket index `i` such that `boundaries[i] <= val <= boundaries[i+1]` (first match), or null when `val` is outside the boundaries. */
export function findBucket(boundaries: readonly number[], val: number): number | null {
  if (boundaries.length < 2 || val < boundaries[0] || val > boundaries[boundaries.length - 1]) {
    return null;
  }
  for (let i = 0; i + 1 < boundaries.length; i++) {
    if (val >= boundaries[i] && val <= boundaries[i + 1]) return i;
  }
  return null;
}
