// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): block types.

import type { Rect } from "../types/geometry.js";

/** One table cell of a LayoutBlock. */
export type LayoutCell = {
  text: string;
  bbox?: Rect;
  /** Merge spans, on `merged_table` cells only and only when > 1. */
  colspan?: number;
  rowspan?: number;
  /** Indices into the page's `text_items` the cell's text was read from. */
  text_item_indices: number[];
};

/** One classified layout block, in the order the markdown emits them. */
export type LayoutBlock = {
  /** heading, paragraph, list_item, code, table, merged_table, grid_fallback, rule or figure. */
  kind: string;
  text?: string;
  /** Heading level (1-6), or list nesting depth for `list_item`. */
  level?: number;
  bold: boolean;
  italic: boolean;
  ordered?: boolean;
  marker?: string;
  lines?: string[];
  lang?: string;
  header?: LayoutCell[];
  rows?: LayoutCell[][];
  header_rows?: number;
  id?: string;
  format?: string;
  bbox?: Rect;
  text_item_indices: number[];
};
