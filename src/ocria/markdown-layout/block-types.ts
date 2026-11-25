// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the types in liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import type { Rect } from "../types/geometry.js";

/** A table cell. Equality is by text only (geometry is derived metadata). */
export type Cell = { text: string; bbox: Rect | null; text_item_indices: number[] };

/** A table cell with explicit spans (each at least 1). Equality is by text and spans. */
export type SpanCell = {
  text: string;
  colspan: number;
  rowspan: number;
  bbox: Rect | null;
  text_item_indices: number[];
};

/** `Cell::sourced` / `Cell::located`. */
export function cell(text: string, bbox: Rect | null = null, textItemIndices: number[] = []): Cell {
  return { text, bbox, text_item_indices: textItemIndices };
}

/** `SpanCell::new` / `SpanCell::spanning` (spans clamped to at least 1). */
export function spanCell(text: string, colspan = 1, rowspan = 1): SpanCell {
  return {
    text,
    colspan: Math.max(colspan, 1),
    rowspan: Math.max(rowspan, 1),
    bbox: null,
    text_item_indices: [],
  };
}

/** The output of page classification, rendered to markdown by `render_blocks`. */
export type Block =
  | { Heading: { level: number; text: string } }
  | { Paragraph: { text: string; bold: boolean; italic: boolean } }
  | {
      ListItem: {
        ordered: boolean;
        marker: string;
        level: number;
        text: string;
        bold: boolean;
        italic: boolean;
      };
    }
  | { CodeBlock: { lines: string[]; lang: string | null } }
  | { Table: { header: Cell[] | null; rows: Cell[][] } }
  | { MergedTable: { rows: SpanCell[][]; header_rows: number } }
  | { GridFallback: { lines: string[] } }
  | "HorizontalRule"
  | { Figure: { id: string; format: string } };

/** A classified block plus the region of the page it was read from. */
export type PositionedBlock = {
  block: Block;
  bbox: Rect | null;
  /** Indices into the page's `text_items` the block was read from; unordered, may repeat. */
  text_item_indices: number[];
};
