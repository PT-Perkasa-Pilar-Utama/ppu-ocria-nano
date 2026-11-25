// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Shared fixtures of the classify.rs unit tests.

import type { Block, PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { classifyPageWithFilters } from "../../src/ocria/markdown-layout/classify/index.js";
import {
  buildHeadingMap,
  computeBodySize,
} from "../../src/ocria/markdown-layout/headings/index.js";
import { line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ParsedPage, ProjectedLine } from "../../src/ocria/types/page.js";

/** `classify_page` (cfg(test)): `classify_page_with_filters` with no filters and placeholder images. */
export function classifyPage(
  p: ParsedPage,
  headingMap: Array<[number, number]>
): PositionedBlock[] {
  return classifyPageWithFilters(p, headingMap, new Set(), [], "placeholder", new Set());
}

export function mapOf(p: ParsedPage): Array<[number, number]> {
  const pages = [p];
  return buildHeadingMap(pages, computeBodySize(pages));
}

export function tag(l: ProjectedLine, idx: number): ProjectedLine {
  l.span_item_indices = [idx];
  return l;
}

/** A `Table` block of text-only cells. */
export function tableOf(...rows: string[][]): Block {
  return {
    Table: {
      header: null,
      rows: rows.map((r) => r.map((text) => ({ text, bbox: null, text_item_indices: [] }))),
    },
  };
}

/** The paragraph fields of a block, or an error naming what it is instead. */
export function paragraph(b: PositionedBlock): { text: string; bold: boolean; italic: boolean } {
  if (typeof b.block === "string" || !("Paragraph" in b.block)) {
    throw new Error(`expected paragraph, got ${JSON.stringify(b.block)}`);
  }
  return b.block.Paragraph;
}

export function isRule(b: PositionedBlock): boolean {
  return b.block === "HorizontalRule";
}

export function isKind(b: PositionedBlock, kind: string): boolean {
  return typeof b.block !== "string" && kind in b.block;
}

export function titlePage(): ParsedPage {
  return page([
    line("Title of the document goes here", 50, 50, 18, 18),
    line("First sentence of the para-", 50, 80, 10, 10),
    line("graph continues here.", 50, 92, 10, 10),
    line("Another paragraph.", 50, 130, 10, 10),
  ]);
}

/** The column count of a table block's first row (header when present). */
export function columnCount(t: { header: unknown[] | null; rows: unknown[][] }): number {
  if (t.header !== null) return t.header.length;
  return t.rows.length > 0 ? t.rows[0].length : 0;
}
