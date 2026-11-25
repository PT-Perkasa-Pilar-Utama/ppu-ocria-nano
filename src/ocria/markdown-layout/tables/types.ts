// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): shared table-detection types.

import type { Rect } from "../../types/geometry.js";
import type { TextItem, WordBox } from "../../types/text-item.js";
import type { Block, Cell } from "../block-types.js";

/**
 * One horizontal piece of a PDFium text run: the run split at its internal
 * column gutters. Most runs yield a single piece.
 */
export type SpanPiece = {
  x: number;
  end_x: number;
  text: string;
  /** The run this piece came from, for bold/font lookups. */
  span: TextItem;
  /** The piece's own word boxes, in reading order, only when verified to reconstruct `text`. */
  words: WordBox[];
  /** Index of `span` in the page's `text_items`; null when built without its line. */
  item_index: number | null;
};

/** One cell within a tabular row: contributing spans aggregated to text and its leftmost x. */
export type TableCell = {
  start_x: number;
  /** Right edge of the cell (x of the last span's right). */
  end_x: number;
  text: string;
  bold: boolean;
  /** Source items of the spans aggregated into the cell, in reading order. */
  text_item_indices: number[];
  /** Left and right edge of each source item, aligned with `text_item_indices`; empty when unknown. */
  item_x_ranges: Array<[number, number]>;
};

/** A contiguous tabular run: line indices `[start, end)` plus the detected rows. */
export type TableRun = {
  start: number;
  end: number;
  /** First line index of the table's body rows. */
  body_start: number;
  block: Block;
  /** Free-standing prose lines the run stepped over between its absorbed header and body rows. */
  interstitials: Cell[];
  /** Region the whole table occupies; null when built without geometry. */
  bbox: Rect | null;
  /** Source items of a `GridFallback` run. */
  item_indices: number[];
};
