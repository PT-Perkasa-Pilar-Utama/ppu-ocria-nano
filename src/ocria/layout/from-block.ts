// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): LayoutBlock::of and the From<&PositionedBlock> conversion.

import type { Block, Cell, PositionedBlock, SpanCell } from "../markdown-layout/block-types.js";
import type { Rect } from "../types/geometry.js";
import type { LayoutBlock, LayoutCell } from "./types.js";

/** `indices` with repeats dropped, first occurrence kept. */
function unique(indices: readonly number[]): number[] {
  const out: number[] = [];
  for (const i of indices) {
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

function copyRect(r: Rect | null): Rect | undefined {
  return r === null ? undefined : { ...r };
}

function withBbox<T extends object>(value: T, bbox: Rect | null): T & { bbox?: Rect } {
  const copy = copyRect(bbox);
  return copy === undefined ? value : { ...value, bbox: copy };
}

/** `LayoutCell::from(&Cell)`. */
export function layoutCellFromCell(c: Cell): LayoutCell {
  return withBbox({ text: c.text, text_item_indices: unique(c.text_item_indices) }, c.bbox);
}

/** `LayoutCell::from(&SpanCell)`. */
export function layoutCellFromSpanCell(c: SpanCell): LayoutCell {
  const cell: LayoutCell = { text: c.text, text_item_indices: unique(c.text_item_indices) };
  const withSpans: LayoutCell = {
    ...cell,
    ...(c.colspan > 1 ? { colspan: c.colspan } : {}),
    ...(c.rowspan > 1 ? { rowspan: c.rowspan } : {}),
  };
  return withBbox(withSpans, c.bbox);
}

/** Base value with every variant-specific field cleared (`LayoutBlock::of`). */
export function layoutBlockOf(kind: string, bbox: Rect | null): LayoutBlock {
  const textItemIndices: number[] = [];
  return withBbox({ kind, bold: false, italic: false, text_item_indices: textItemIndices }, bbox);
}

const byValue = (a: number, b: number): number => a - b;

function cellsOf(row: readonly Cell[]): LayoutCell[] {
  return row.map(layoutCellFromCell);
}

/** The fields `kind` and its payload set on top of `LayoutBlock::of`. */
function variantFields(block: Block): Partial<LayoutBlock> & { kind: string } {
  if (block === "HorizontalRule") return { kind: "rule" };
  if ("Heading" in block) {
    return { kind: "heading", text: block.Heading.text, level: block.Heading.level };
  }
  if ("Paragraph" in block) {
    const p = block.Paragraph;
    return { kind: "paragraph", text: p.text, bold: p.bold, italic: p.italic };
  }
  if ("ListItem" in block) {
    const l = block.ListItem;
    return {
      kind: "list_item",
      text: l.text,
      level: l.level,
      ordered: l.ordered,
      marker: l.marker,
      bold: l.bold,
      italic: l.italic,
    };
  }
  if ("CodeBlock" in block) {
    const c = block.CodeBlock;
    return {
      kind: "code",
      lines: [...c.lines],
      ...(c.lang === null ? {} : { lang: c.lang }),
    };
  }
  if ("Table" in block) {
    const t = block.Table;
    return {
      kind: "table",
      ...(t.header === null ? {} : { header: cellsOf(t.header) }),
      rows: t.rows.map(cellsOf),
    };
  }
  if ("MergedTable" in block) {
    const t = block.MergedTable;
    return {
      kind: "merged_table",
      header_rows: t.header_rows,
      rows: t.rows.map((r) => r.map(layoutCellFromSpanCell)),
    };
  }
  if ("GridFallback" in block)
    return { kind: "grid_fallback", lines: [...block.GridFallback.lines] };
  return { kind: "figure", id: block.Figure.id, format: block.Figure.format };
}

/** `LayoutBlock::from(&PositionedBlock)`. */
export function layoutBlockFromPositioned(pb: PositionedBlock): LayoutBlock {
  const { kind, ...fields } = variantFields(pb.block);
  const block: LayoutBlock = { ...layoutBlockOf(kind, pb.bbox), ...fields };
  const isTable =
    pb.block !== "HorizontalRule" && ("Table" in pb.block || "MergedTable" in pb.block);
  const items = isTable
    ? [...(block.header ?? []), ...(block.rows ?? []).flat()].flatMap((c) => c.text_item_indices)
    : [...pb.text_item_indices];
  items.sort(byValue);
  // `dedup` after the sort: equal values are adjacent.
  block.text_item_indices = items.filter((v, i) => i === 0 || v !== items[i - 1]);
  return block;
}
