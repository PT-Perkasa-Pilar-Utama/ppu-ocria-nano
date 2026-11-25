// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/test_helpers.rs (crates-v2.21.2, Apache-2.0).

// Fixtures for the markdown-layout unit tests. Test-only: nothing in src imports this file.

import { isRtlText } from "../bidi.js";
import { charCount, f32 } from "../rust.js";
import { emptyRegion } from "../types/geometry.js";
import type { GraphicPrimitive, Rect } from "../types/geometry.js";
import type { ParsedPage, ProjectedLine } from "../types/page.js";
import { textItem } from "../types/text-item.js";
import type { TextItem } from "../types/text-item.js";
import type { Block, Cell, PositionedBlock, SpanCell } from "./block-types.js";

/** A one-span line with the given text at (x, y), height `h` and font size `size`. */
export function line(text: string, x: number, y: number, h: number, size: number): ProjectedLine {
  return {
    text,
    rtl: isRtlText(text),
    bbox: { x, y, width: f32(charCount(text) * f32(size * f32(0.5))), height: h },
    anchor: "Left",
    indent_x: x,
    dominant_font_size: size,
    font_size_is_estimated: false,
    heading_font_size: null,
    dominant_font_name: "Arial",
    all_bold: false,
    all_italic: false,
    all_mono: false,
    all_strike: false,
    spans: [textItem({})],
    span_item_indices: [0],
    region_path: [],
    mcid: null,
    in_figure: false,
  };
}

/** `ParsedPage` holding `lines`, letter-sized. */
export function page(lines: ProjectedLine[]): ParsedPage {
  return {
    page_number: 1,
    page_label: null,
    page_width: 612,
    page_height: 792,
    content_bounds: null,
    text: "",
    markdown: "",
    text_items: [],
    projected_lines: lines,
    regions: emptyRegion(),
    graphics: [],
    vector_graphics: null,
    figures: [],
    projected_item_frames: [],
    model_tables: [],
    model_classes: [],
    model_blocks: [],
    struct_nodes: [],
    image_refs: [],
    annotations: null,
    form_fields: null,
    structure_tree: null,
    blocks: null,
    ocr_deskew: null,
  };
}

export function monoLine(text: string, y: number): ProjectedLine {
  const l = line(text, 50, y, 10, 10);
  l.all_mono = true;
  return l;
}

function minMax(items: TextItem[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const s of items) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, f32(s.x + s.width));
  }
  return { minX, maxX };
}

function spanLine(
  items: TextItem[],
  text: string,
  rtl: boolean,
  y: number,
  size: number
): ProjectedLine {
  const { minX, maxX } = minMax(items);
  return {
    text,
    rtl,
    bbox: { x: minX, y, width: Math.max(f32(maxX - minX), 0), height: size },
    anchor: "Left",
    indent_x: minX,
    dominant_font_size: size,
    font_size_is_estimated: false,
    heading_font_size: null,
    dominant_font_name: "Arial",
    all_bold: false,
    all_italic: false,
    all_mono: false,
    all_strike: false,
    span_item_indices: items.map((_, i) => i),
    spans: items,
    region_path: [],
    mcid: null,
    in_figure: false,
  };
}

/** A line whose spans sit at explicit x positions, to drive the table detector. */
export function lineWithSpans(
  cells: ReadonlyArray<[string, number]>,
  y: number,
  size: number
): ProjectedLine {
  const items = cells.map(([t, x]) =>
    textItem({
      text: t,
      x,
      y,
      width: f32(f32(charCount(t) * size) * f32(0.5)),
      height: size,
      font_size: size,
      font_name: "Arial",
    })
  );
  return spanLine(items, cells.map(([t]) => t).join("   "), false, y, size);
}

/** A line whose spans carry explicit per-span font metadata. */
export function styledLine(
  spans: ReadonlyArray<[string, number, string | null]>,
  y: number,
  size: number
): ProjectedLine {
  const items = spans.map(([t, x, font]) =>
    textItem({
      text: t,
      x,
      y,
      width: f32(f32(charCount(t) * size) * f32(0.5)),
      height: size,
      font_size: size,
      font_name: font,
    })
  );
  const joined = spans.map(([t]) => t).join(" ");
  return spanLine(items, joined, isRtlText(joined), y, size);
}

export function stroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number
): GraphicPrimitive {
  return { Stroke: { x1, y1, x2, y2, width, color: null } };
}

export function pageWithGraphics(lines: ProjectedLine[], graphics: GraphicPrimitive[]): ParsedPage {
  const p = page(lines);
  p.graphics = graphics;
  return p;
}

/** Page height 100, so the header band is at most 12 pt and the footer band at least 88 pt. */
export function headerFooterPage(
  n: number,
  header: string,
  footer: string,
  body: string
): ParsedPage {
  const p = page([
    line(header, 50, 5, 8, 8),
    line(body, 50, 50, 10, 10),
    line(footer, 50, 92, 6, 6),
  ]);
  p.page_number = n;
  p.page_height = 100;
  return p;
}

/** The four borders of a rectangle as four strokes. */
export function rectBorders(x: number, y: number, w: number, h: number): GraphicPrimitive[] {
  return [
    stroke(x, y, f32(x + w), y, 0.5),
    stroke(x, f32(y + h), f32(x + w), f32(y + h), 0.5),
    stroke(x, y, x, f32(y + h), 0.5),
    stroke(f32(x + w), y, f32(x + w), f32(y + h), 0.5),
  ];
}

/** `Cell`'s `PartialEq`: cells compare by text alone. */
export function cellsEq(a: readonly Cell[], b: readonly Cell[]): boolean {
  return a.length === b.length && a.every((c, i) => c.text === b[i].text);
}

function spanRowsEq(a: SpanCell[][], b: SpanCell[][]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (r, i) =>
        r.length === b[i].length &&
        r.every(
          (c, j) =>
            c.text === b[i][j].text &&
            c.colspan === b[i][j].colspan &&
            c.rowspan === b[i][j].rowspan
        )
    )
  );
}

function optCellsEq(a: Cell[] | null, b: Cell[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return cellsEq(a, b);
}

function tableRowsEq(a: Cell[][], b: Cell[][]): boolean {
  return a.length === b.length && a.every((r, i) => cellsEq(r, b[i]));
}

/** `Block`'s derived `PartialEq`, with `Cell` and `SpanCell` comparing without geometry. */
export function blockEq(a: Block, b: Block): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if ("Table" in a && "Table" in b) {
    return optCellsEq(a.Table.header, b.Table.header) && tableRowsEq(a.Table.rows, b.Table.rows);
  }
  if ("MergedTable" in a && "MergedTable" in b) {
    return (
      a.MergedTable.header_rows === b.MergedTable.header_rows &&
      spanRowsEq(a.MergedTable.rows, b.MergedTable.rows)
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Table rows as plain strings, to compare with a literal of expected text. */
export function rowTexts(rows: readonly (readonly Cell[])[]): string[][] {
  return rows.map((r) => r.map((c) => c.text));
}

/** The boxes of a block list, for tests that only check geometry. */
export function blockBoxes(blocks: readonly PositionedBlock[]): Array<Rect | null> {
  return blocks.map((b) => b.bbox);
}
