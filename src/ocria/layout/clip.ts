// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): clip_to_page, clip_rect and the page-frame remap.

import { clamp, f32 } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import { rectExtend } from "../types/geometry.js";
import type { TextItem } from "../types/text-item.js";
import type { LayoutBlock } from "./types.js";

/** Every box of a block: its own, then its header cells', then its body cells'. */
function boxHolders(block: LayoutBlock): Array<{ bbox?: Rect }> {
  return [block, ...(block.header ?? []), ...(block.rows ?? []).flat()];
}

/** Leaves a non-finite rect as-is (`f32::clamp` panics on NaN, and `inf - inf` is NaN). */
function clipRect(r: Rect, width: number, height: number): void {
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return;
  const x1 = clamp(f32(r.x + r.width), 0, width);
  const y1 = clamp(f32(r.y + r.height), 0, height);
  r.x = clamp(r.x, 0, x1);
  r.y = clamp(r.y, 0, y1);
  r.width = f32(x1 - r.x);
  r.height = f32(y1 - r.y);
}

/**
 * Clip block and cell boxes to the page. Ruled-grid boundaries come from
 * vector paths, whose bounds PDFium reports unclipped, so a path drawn past
 * the page edge would otherwise stretch a column (and the table) off the page;
 * a full-bleed image's bounds and text set past the edge overhang it too. A
 * box outside the page is no region of it (and a consumer normalizing by the
 * page size gets coordinates outside [0, 1]).
 */
export function clipToPage(blocks: LayoutBlock[], width: number, height: number): void {
  if (!(width > 0 && Number.isFinite(width) && height > 0 && Number.isFinite(height))) return;
  for (const block of blocks) {
    for (const holder of boxHolders(block)) {
      if (holder.bbox !== undefined) clipRect(holder.bbox, width, height);
    }
  }
}

/** The union of the rects of `items[indices]`, or `undefined` for no indices. */
function unionOfItems(indices: readonly number[], items: readonly TextItem[]): Rect | undefined {
  let acc: Rect | undefined;
  for (const i of indices) {
    const item = items[i];
    acc = rectExtend(acc, { x: item.x, y: item.y, width: item.width, height: item.height });
  }
  return acc;
}

function remapOpt(
  holder: { bbox?: Rect },
  indices: readonly number[],
  items: readonly TextItem[]
): void {
  if (holder.bbox === undefined) return;
  const acc = unionOfItems(indices, items);
  if (acc !== undefined) holder.bbox = acc;
}

/**
 * Map text-derived block and cell boxes from the projection frame back to
 * the page frame: a box is the union of the items it was built from, so its
 * page-frame counterpart is the union of those items' rects. `figure` and
 * `rule` boxes come from graphics, already in page coordinates, and are
 * left alone; so is any box with no items behind it.
 */
export function remapToPageFrame(blocks: LayoutBlock[], items: readonly TextItem[]): void {
  for (const block of blocks) {
    if (block.kind === "figure" || block.kind === "rule") continue;
    remapOpt(block, block.text_item_indices, items);
    for (const cell of [...(block.header ?? []), ...(block.rows ?? []).flat()]) {
      remapOpt(cell, cell.text_item_indices, items);
    }
  }
}
