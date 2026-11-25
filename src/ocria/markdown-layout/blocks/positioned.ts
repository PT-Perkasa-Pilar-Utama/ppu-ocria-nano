// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0): constructors and mutators of Cell, SpanCell and PositionedBlock.

import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { Block, Cell, PositionedBlock, SpanCell } from "../block-types.js";
import { cell } from "../block-types.js";

/** `Cell::located`: text and the region it was read from, no source items. */
export function cellLocated(text: string, bbox: Rect): Cell {
  return cell(text, { ...bbox }, []);
}

/** `Cell::sourced`: text, region and the items it was read from. */
export function cellSourced(text: string, bbox: Rect, textItemIndices: number[]): Cell {
  return cell(text, { ...bbox }, textItemIndices);
}

/** `SpanCell::with_bbox`. */
export function spanCellWithBbox(c: SpanCell, bbox: Rect): SpanCell {
  return { ...c, bbox: { ...bbox } };
}

// The constructors copy the box and the index list they are given. Rust moves or clones what a
// caller passes in, so no later in-place edit of a block (`absorbBlock`, the deskew rotate-back) can
// reach the line, image reference or sibling block it was built from.

/** `PositionedBlock::new`. */
export function positionedBlock(block: Block, bbox: Rect | null): PositionedBlock {
  return { block, bbox: bbox == null ? null : { ...bbox }, text_item_indices: [] };
}

/** `PositionedBlock::sourced`. */
export function sourcedBlock(
  block: Block,
  bbox: Rect | null,
  textItemIndices: number[]
): PositionedBlock {
  return {
    block,
    bbox: bbox == null ? null : { ...bbox },
    text_item_indices: [...textItemIndices],
  };
}

/** `PositionedBlock::unlocated`. */
export function unlocatedBlock(block: Block): PositionedBlock {
  return positionedBlock(block, null);
}

/** `PositionedBlock::clear_text_items`: drop every text-item index, the block's and its cells'. */
export function clearTextItems(pb: PositionedBlock): void {
  pb.text_item_indices = [];
  const b = pb.block;
  if (typeof b === "string") return;
  if ("Table" in b) {
    for (const c of [...(b.Table.header ?? []), ...b.Table.rows.flat()]) c.text_item_indices = [];
  } else if ("MergedTable" in b) {
    for (const c of b.MergedTable.rows.flat()) c.text_item_indices = [];
  }
}

/** `PositionedBlock::absorb`: grow this block's box and source items to also cover `other`. */
export function absorbBlock(pb: PositionedBlock, other: PositionedBlock): void {
  if (other.bbox != null) pb.bbox = rectExtend(pb.bbox ?? undefined, other.bbox);
  pb.text_item_indices.push(...other.text_item_indices);
}
