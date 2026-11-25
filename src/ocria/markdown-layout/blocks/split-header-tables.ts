// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import type { Rect } from "../../types/geometry.js";
import { cell } from "../block-types.js";
import type { Cell, PositionedBlock, SpanCell } from "../block-types.js";
import { nonempty, repeatedHeaderCuts, sideBySideGutter, unionCells } from "./header-cuts.js";
import { positionedBlock, sourcedBlock } from "./positioned.js";

/** The box of a cut-out part: the union of its cells' boxes, else the whole table's. */
function partBox(
  part: ReadonlyArray<ReadonlyArray<{ bbox: Rect | null }>>,
  whole: Rect | null
): Rect | null {
  const rects: Rect[] = [];
  for (const r of part) for (const c of r) if (c.bbox != null) rects.push(c.bbox);
  return unionCells(rects) ?? (whole == null ? null : { ...whole });
}

function tableBlock(rows: Cell[][], hasHeader: boolean, bbox: Rect | null): PositionedBlock {
  const header = hasHeader ? (rows[0] ?? null) : null;
  return positionedBlock({ Table: { header, rows: hasHeader ? rows.slice(1) : rows } }, bbox);
}

function splitTable(
  header: Cell[] | null,
  tableRows: Cell[][],
  pbBbox: Rect | null,
  out: PositionedBlock[]
): void {
  const all: Cell[][] = [...(header == null ? [] : [header]), ...tableRows];
  const hadHeader = header != null;
  // side by side first: each half is then checked for stacked repeats
  const gutter = sideBySideGutter(all);
  if (gutter != null) {
    const left: Cell[][] = [];
    const right: Cell[][] = [];
    for (const r of all) {
      while (r.length < gutter + 1) r.push(cell(""));
      const tail = r.splice(gutter + 1);
      r.length = gutter;
      left.push(r);
      right.push(tail);
    }
    for (const part of [left, right]) {
      const bbox = partBox(part, pbBbox);
      const hdr = hadHeader ? (part[0] ?? null) : null;
      const rest = hadHeader ? part.slice(1) : part;
      out.push(
        ...splitRepeatedHeaderTables([
          positionedBlock({ Table: { header: hdr, rows: rest } }, bbox),
        ])
      );
    }
    return;
  }
  const texts = all.map((r) => r.map((c) => c.text));
  const cuts = repeatedHeaderCuts(
    texts,
    all.map(() => false)
  );
  if (cuts.length === 0) {
    out.push(tableBlock(all, hadHeader, pbBbox));
    return;
  }
  let start = 0;
  [...cuts, all.length].forEach((end, k) => {
    const seg = all.slice(start, end);
    out.push(tableBlock(seg, k > 0 || hadHeader, partBox(seg, pbBbox)));
    start = end;
  });
}

function splitMerged(
  rows: SpanCell[][],
  headerRows: number,
  pbBbox: Rect | null,
  out: PositionedBlock[]
): void {
  // a cut may not fall inside a row span
  const spanned = rows.map(() => false);
  rows.forEach((row, r) => {
    for (const c of row) {
      const end = Math.min(r + Math.max(c.rowspan, 1), rows.length);
      for (let s = r + 1; s < end; s++) spanned[s] = true;
    }
  });
  const cuts = repeatedHeaderCuts(
    rows.map((r) => r.map((c) => c.text)),
    spanned
  );
  if (cuts.length === 0) {
    out.push(positionedBlock({ MergedTable: { rows, header_rows: headerRows } }, pbBbox));
    return;
  }
  let start = 0;
  [...cuts, rows.length].forEach((end, k) => {
    const seg = rows.slice(start, end);
    const bbox = partBox(seg, pbBbox);
    // later parts: their title row and repeated header row head the part
    const titled = seg.length > 0 && nonempty(seg[0].map((c) => c.text)) === 1;
    const hr = k === 0 ? Math.min(headerRows, seg.length) : Math.min(end - start, titled ? 2 : 1);
    out.push(positionedBlock({ MergedTable: { rows: seg, header_rows: hr } }, bbox));
    start = end;
  });
}

/**
 * Split tables whose rows repeat an earlier column-header row: several tables with the same
 * columns, stacked (rate tables per scenario, one schedule per year), that table detection read
 * as one. A header-like row (three or more filled cells, at most a third of them numbers) that
 * repeats one of the current table's first three rows starts a new table, taking with it a
 * one-cell title row just above it ("Proposed Base Rate"). Tables set side by side with the
 * same columns split at their shared empty gutter column (`sideBySideGutter`).
 * ParseBench v1 tables 65.6 -> 66.8; OPB, odl unchanged; ParseBench v2 tables 63.8 -> 63.7 core,
 * 55.3 -> 55.5 full.
 */
export function splitRepeatedHeaderTables(blocks: PositionedBlock[]): PositionedBlock[] {
  const out: PositionedBlock[] = [];
  for (const pb of blocks) {
    const b = pb.block;
    if (typeof b !== "string" && "Table" in b) {
      splitTable(b.Table.header, b.Table.rows, pb.bbox, out);
    } else if (typeof b !== "string" && "MergedTable" in b) {
      splitMerged(b.MergedTable.rows, b.MergedTable.header_rows, pb.bbox, out);
    } else {
      out.push(sourcedBlock(b, pb.bbox, pb.text_item_indices));
    }
  }
  return out;
}
