// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0).

// Structural clean-up of emitted tables, applied to every table block (model or heuristic)
// before rendering. Each rule fixes a pattern that costs whole columns or rows in table scoring
// even when every value was read correctly:
//
// - currency symbols in their own cell (`$ | 14,046`) or stuck to the previous value
//   (`8.8 % $ | 13,917`) move onto the number they belong to; columns left empty are removed;
// - a wrapped cell's continuation line emitted as its own row is folded into the row above;
// - a group header in a multi-row header ("Fiscal 2024" over "Net Sales | % of Net Sales") spans
//   the sub-columns it is centred over instead of the first one only;
// - dot / underscore leaders are stripped from cell text.

import type { Block, Cell, SpanCell } from "../block-types.js";
import { fromSpanRows, toSpanRows } from "./dense.js";
import type { Dense } from "./dense.js";
import { foldContinuationRows } from "./fold-rows.js";
import { spanGroupHeaders } from "./group-headers.js";
import { dropEmptyColumns, moveCurrency, stripLeaders } from "./rules.js";

function spanOf(c: Cell): SpanCell {
  return {
    text: c.text,
    colspan: 1,
    rowspan: 1,
    bbox: c.bbox == null ? null : { ...c.bbox },
    text_item_indices: [...c.text_item_indices],
  };
}

function run(d: Dense): void {
  stripLeaders(d);
  const emptied = moveCurrency(d);
  dropEmptyColumns(d, emptied);
  foldContinuationRows(d);
  spanGroupHeaders(d);
}

/** Apply the clean-up to a table block in place (other blocks are untouched). */
export function fixBlock(block: Block): void {
  if (typeof block === "string") return;
  if ("MergedTable" in block) {
    const t = block.MergedTable;
    const d = fromSpanRows(t.rows, t.header_rows);
    if (d == null) return;
    run(d);
    const [r, h] = toSpanRows(d);
    t.rows = r;
    t.header_rows = h;
    return;
  }
  if (!("Table" in block)) return;
  const t = block.Table;
  const all: SpanCell[][] = [];
  const hr = t.header != null ? 1 : 0;
  if (t.header != null) all.push(t.header.map(spanOf));
  for (const r of t.rows) all.push(r.map(spanOf));
  const d = fromSpanRows(all, hr);
  if (d == null) return;
  run(d);
  // a plain table stays plain: the rules here never create spans in a one-row header
  const [out, h] = toSpanRows(d);
  if (out.flat().some((c) => c.colspan > 1 || c.rowspan > 1)) return;
  const plain: Cell[][] = out.map((r) =>
    r.map((c) => ({ text: c.text, bbox: c.bbox, text_item_indices: c.text_item_indices }))
  );
  t.header = h > 0 && plain.length > 0 ? (plain.shift() ?? null) : null;
  t.rows = plain;
}
