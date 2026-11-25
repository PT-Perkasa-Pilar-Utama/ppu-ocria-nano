// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): blocks_for_page.

import type { PositionedBlock } from "../markdown-layout/block-types.js";
import type { ParsedPage } from "../types/page.js";
import { clipToPage, remapToPageFrame } from "./clip.js";
import { layoutBlockFromPositioned } from "./from-block.js";
import type { LayoutBlock } from "./types.js";

/**
 * Public block list for one page: the classifier's blocks converted to the
 * flat serializable shape, with geometry in the page's viewport frame.
 *
 * Block and cell boxes are unioned from `ProjectedLine.bbox`, which lives in
 * the *projection* frame. On pages where rotation handling moved text (see
 * `ParsedPage::projected_item_frames`) that frame is a virtual canvas
 * (unrotated sidebars, body text pushed a page-height down), so those boxes
 * are mapped back here through the items they were read from. Pages
 * without rotated text pass through unchanged.
 */
export function blocksForPage(page: ParsedPage, blocks: readonly PositionedBlock[]): LayoutBlock[] {
  const out = blocks.map(layoutBlockFromPositioned);
  const nItems = page.text_items.length;
  for (const block of out) {
    block.text_item_indices = block.text_item_indices.filter((i) => i < nItems);
    for (const cell of [...(block.header ?? []), ...(block.rows ?? []).flat()]) {
      cell.text_item_indices = cell.text_item_indices.filter((i) => i < nItems);
    }
  }
  if (page.projected_item_frames.length > 0) remapToPageFrame(out, page.text_items);
  clipToPage(out, page.page_width, page.page_height);
  return out;
}
