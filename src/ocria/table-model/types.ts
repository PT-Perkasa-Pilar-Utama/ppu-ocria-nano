// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/{mod,decode}.rs (crates-v2.21.2, Apache-2.0): result types.

import type { Rect } from "../types/geometry.js";

/** Block classes of the layout model's class head. */
export const BLOCK_CLASSES = [
  "Text",
  "Heading",
  "Title",
  "PageHeader",
  "PageFooter",
  "List",
  "Table",
  "Caption",
  "Footnote",
  "Formula",
  "Code",
  "FigureText",
  "KeyValue",
] as const;

/** A placed grid cell (top-left slot, span ends, text, box in points as f64). */
export type GridCell = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  text: string;
  bx: [number, number, number, number];
};

/** A decoded table: cells in placement order, the header rows, and the grid size. */
export type Grid = { cells: GridCell[]; head_rows: number[]; n_rows: number; n_cols: number };

/** A decoded table: its grid and its box on the page (points, top-left origin). */
export type ModelTable = { bbox: Rect; grid: Grid };

/** A unit's box (points), character count, and softmax over `BLOCK_CLASSES`. */
export type UnitClass = { bbox: Rect; chars: number; probs: number[] };

/** A layout block from the model's block head; `class` indexes `BLOCK_CLASSES`. */
export type ModelBlock = { bbox: Rect; class: number; text: string };

/** What the model found on a page. */
export type PageModel = { tables: ModelTable[]; classes: UnitClass[]; blocks: ModelBlock[] };
