// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): median text-box size and line metrics.

import { charCount, f32, totalCmp } from "../rust.js";
import type { ProjectedTextItem } from "./types.js";

/** Median text-box width (average character width) and height of a page's items. */
export function computeMedianTextboxSize(items: readonly ProjectedTextItem[]): [number, number] {
  if (items.length === 0) return [0, 0];

  // Match TS behavior: median width is computed as average character width.
  const widths: number[] = [];
  for (const p of items) {
    if (p.item.width <= 0) continue;
    const n = charCount(p.item.text);
    if (n === 0) continue;
    widths.push(f32(p.item.width / n));
  }
  const heights: number[] = [];
  for (const p of items) if (p.item.height > 0) heights.push(p.item.height);

  if (widths.length === 0) widths.push(1);
  if (heights.length === 0) heights.push(1);

  widths.sort(totalCmp);
  heights.sort(totalCmp);

  const widthMid = Math.floor(widths.length / 2);
  const heightMid = Math.floor(heights.length / 2);

  const medianWidth =
    widths.length % 2 === 0
      ? f32(f32(widths[widthMid - 1] + widths[widthMid]) / 2)
      : widths[widthMid];
  const medianHeight =
    heights.length % 2 === 0
      ? f32(f32(heights[heightMid - 1] + heights[heightMid]) / 2)
      : heights[heightMid];
  return [medianWidth, medianHeight];
}

/**
 * `(top, bottom, height)` for the representative items in a line, filtering
 * out items much shorter than median height.
 */
export function representativeLineMetrics(
  line: readonly ProjectedTextItem[],
  globalMedianHeight: number
): [number, number, number] {
  if (line.length === 0) return [0, 0, 0];

  const minRepresentative = f32(globalMedianHeight * 0.5);
  const hasRepresentative = line.some((b) => b.item.height >= minRepresentative);

  let top = Infinity;
  let bottom = -Infinity;
  for (const b of line) {
    if (hasRepresentative && b.item.height < minRepresentative) continue;
    top = Math.min(top, b.item.y);
    bottom = Math.max(bottom, f32(b.item.y + b.item.height));
  }
  return [top, bottom, f32(bottom - top)];
}
