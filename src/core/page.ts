// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The public page: LiteParse's ParsedPage in camelCase. This file is the one
// place that maps the port's serde-shaped types to the public API.

import type { LayoutBlock as RawBlock, LayoutCell as RawCell } from "../ocria/layout/types.js";
import type { Rect } from "../ocria/types/geometry.js";
import type { ParsedPage } from "../ocria/types/page.js";
import type { TextItem } from "../ocria/types/text-item.js";

/** A box in points (72 per inch), top-left origin. */
export type Box = { x: number; y: number; width: number; height: number };

/** One text item: an OCR line, or a run of a PDF's text layer. */
export type PageItem = Box & {
  text: string;
  /** Degrees counter-clockwise. */
  rotation: number;
  /** OCR confidence in 0..1; null for text-layer items. */
  confidence: number | null;
  fontName: string | null;
  fontSize: number | null;
};

/** One table cell of a block. */
export type BlockCell = {
  text: string;
  bbox: Box | null;
  /** Spans of a merged-table cell, when more than 1. */
  colspan: number | null;
  rowspan: number | null;
  /** Indices into the page's `items` the cell was read from. */
  itemIndices: number[];
};

/** One layout block, in reading order: the same blocks the markdown is written from. */
export type PageBlock = {
  /** heading, paragraph, list_item, code, table, merged_table, grid_fallback, rule or figure. */
  kind: string;
  text: string | null;
  /** Heading level (1-6), or list nesting depth for `list_item`. */
  level: number | null;
  bold: boolean;
  italic: boolean;
  /** `list_item`: ordered list, and the marker as printed. */
  ordered: boolean | null;
  marker: string | null;
  /** `code` and `grid_fallback`: the source lines. */
  lines: string[] | null;
  lang: string | null;
  /** `table`: the header row; `merged_table`: none (`headerRows` counts them in `rows`). */
  header: BlockCell[] | null;
  rows: BlockCell[][] | null;
  headerRows: number | null;
  bbox: Box | null;
  /** Indices into the page's `items` the block was read from, sorted. */
  itemIndices: number[];
};

/** One parsed page. */
export type Page = {
  /** 1-based. */
  pageNumber: number;
  /** Page size in points. */
  width: number;
  height: number;
  /** For an OCR'd page, the image resolution: pixels = points x dpi / 72. Null for text-layer pages. */
  dpi: number | null;
  /** Headings, paragraphs, lists, tables and code. Page headers and footers are left out unless asked for. */
  markdown: string;
  /** The page's text laid out as on the page (LiteParse's grid projection). */
  text: string;
  items: PageItem[];
  blocks: PageBlock[];
  /** The page as LiteParse's stages hold it, for the exported stage functions. */
  parsed: ParsedPage;
};

function box(r: Rect | null | undefined): Box | null {
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

function item(t: TextItem): PageItem {
  return {
    text: t.text,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    rotation: t.rotation,
    confidence: t.confidence ?? null,
    fontName: t.font_name ?? null,
    fontSize: t.font_size ?? null,
  };
}

function cell(c: RawCell): BlockCell {
  return {
    text: c.text,
    bbox: box(c.bbox),
    colspan: c.colspan ?? null,
    rowspan: c.rowspan ?? null,
    itemIndices: c.text_item_indices,
  };
}

function block(b: RawBlock): PageBlock {
  return {
    kind: b.kind,
    text: b.text ?? null,
    level: b.level ?? null,
    bold: b.bold,
    italic: b.italic,
    ordered: b.ordered ?? null,
    marker: b.marker ?? null,
    lines: b.lines ?? null,
    lang: b.lang ?? null,
    header: b.header ? b.header.map(cell) : null,
    rows: b.rows ? b.rows.map((r) => r.map(cell)) : null,
    headerRows: b.header_rows ?? null,
    bbox: box(b.bbox),
    itemIndices: b.text_item_indices,
  };
}

/** The public page of a parsed page, its markdown and its OCR resolution. */
export function toPage(parsed: ParsedPage, markdown: string, dpi: number | null): Page {
  return {
    pageNumber: parsed.page_number,
    width: parsed.page_width,
    height: parsed.page_height,
    dpi,
    markdown,
    text: parsed.text,
    items: parsed.text_items.map(item),
    blocks: (parsed.blocks ?? []).map(block),
    parsed,
  };
}
