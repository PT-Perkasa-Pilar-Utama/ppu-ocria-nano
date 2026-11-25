// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the serde defaults of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0): PositionedBlock, Cell and SpanCell.

import type { Cell, PositionedBlock, SpanCell } from "../block-types.js";
import type { Rect } from "../../types/geometry.js";

type CellJson = Partial<Cell> & { text: string };
type SpanCellJson = Partial<SpanCell> & { text: string };

function cellFromJson(c: CellJson): Cell {
  return { text: c.text, bbox: c.bbox ?? null, text_item_indices: c.text_item_indices ?? [] };
}

function spanCellFromJson(c: SpanCellJson): SpanCell {
  return {
    text: c.text,
    colspan: c.colspan ?? 1,
    rowspan: c.rowspan ?? 1,
    bbox: c.bbox ?? null,
    text_item_indices: c.text_item_indices ?? [],
  };
}

/** `PositionedBlock` from serde JSON: `text_item_indices` and the cells' default to empty. */
export function positionedBlockFromJson(v: unknown): PositionedBlock {
  // SAFETY: the recorder writes PositionedBlock as serde does: {block, bbox, text_item_indices?}.
  const o = v as { block: unknown; bbox?: Rect | null; text_item_indices?: number[] };
  const block = o.block;
  const base = { bbox: o.bbox ?? null, text_item_indices: o.text_item_indices ?? [] };
  if (block === "HorizontalRule") return { block, ...base };
  // SAFETY: a non-unit Block is an externally tagged object, as serde writes it.
  const tagged = block as Record<string, Record<string, unknown>>;
  if (tagged["Table"]) {
    // SAFETY: Block::Table is {header: Option<Vec<Cell>>, rows: Vec<Vec<Cell>>}.
    const t = tagged["Table"] as { header: CellJson[] | null; rows: CellJson[][] };
    return {
      block: {
        Table: {
          header: t.header === null ? null : t.header.map(cellFromJson),
          rows: t.rows.map((r) => r.map(cellFromJson)),
        },
      },
      ...base,
    };
  }
  if (tagged["MergedTable"]) {
    // SAFETY: Block::MergedTable is {rows: Vec<Vec<SpanCell>>, header_rows}.
    const t = tagged["MergedTable"] as { rows: SpanCellJson[][]; header_rows: number };
    return {
      block: {
        MergedTable: {
          rows: t.rows.map((r) => r.map(spanCellFromJson)),
          header_rows: t.header_rows,
        },
      },
      ...base,
    };
  }
  // SAFETY: every other variant has no defaulted field, so it matches the TS Block as is.
  return { block: block as PositionedBlock["block"], ...base };
}
