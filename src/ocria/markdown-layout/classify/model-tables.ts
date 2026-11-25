// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): learned-table pass of `classify_page_with_filters`.

import { chars, f32 } from "../../rust.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { TextItem } from "../../types/text-item.js";
import type { PositionedBlock } from "../block-types.js";
import { positionedBlock } from "../blocks/positioned.js";
import { escapeInline } from "../inline/index.js";
import { absorbHeaderBand } from "../table-fix/index.js";
import { toSpanRows } from "../../table-model/grid.js";
import { linePageBoxes, residualLine, textChar } from "./model-page.js";

/** Counts of the characters of `text` that identify it when matching cells to spans. */
function charCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of chars(text)) {
    if (textChar(ch)) m.set(ch, (m.get(ch) ?? 0) + 1);
  }
  return m;
}

/** What the learned table model took from a page's lines. */
export type ModelTablePass = {
  /** Model tables and the paragraphs of leftover text inside their boxes, with their flow y. */
  tables: Array<[number, PositionedBlock]>;
  /** The lines the model left to the region pipeline. */
  lines: ProjectedLine[];
};

/**
 * Learned table model (`table_model`): its tables replace the heuristic detectors wherever
 * they lie. A projected line whose centre falls inside a model table is that table's text:
 * drop it from the region pipeline (so no detector re-finds it) and emit the table as a
 * y-positioned interruption, like the global ruled pass.
 */
export function modelTablePass(page: ParsedPage, lines: ProjectedLine[]): ModelTablePass {
  const tables: Array<[number, PositionedBlock]> = [];
  const modelEdits = new Map<number, ProjectedLine | null>();
  const pboxes = page.model_tables.length === 0 ? [] : linePageBoxes(page, lines);
  for (const t of page.model_tables) {
    const b = t.bbox;
    const x0 = f32(b.x - 1);
    const y0 = f32(b.y - 1);
    const x1 = f32(f32(b.x + b.width) + 1);
    const y1 = f32(f32(b.y + b.height) + 1);
    const inside: number[] = [];
    lines.forEach((_, i) => {
      // page coordinates: the model's boxes are in page space, while a projected line's
      // box can be in the projection's reflowed space (regions re-stacked: a Federal
      // Register page's lines sat ~780 pt below their text) - its spans keep the page's
      const o = pboxes[i];
      const cx = f32(o.x + f32(o.width / 2));
      const cy = f32(o.y + f32(o.height / 2));
      if (x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1) inside.push(i);
    });
    if (inside.length === 0) continue;
    // a header band printed just above the table joins it (table_fix::absorb_header_band)
    const grid = structuredClone(t.grid);
    for (const i of absorbHeaderBand(grid, lines, pboxes, modelEdits)) modelEdits.set(i, null);
    // Grid text is matched back to the lines span by span, as multisets of `text_char`s (cell
    // and span word boundaries differ, and combining marks split "words"): covered spans are
    // the table's, any span whose text the model left outside the table survives as a
    // (reduced) line, so nothing is silently dropped and nothing is emitted twice.
    const pool = new Map<string, number>();
    for (const c of grid.cells) {
      for (const [ch, n] of charCounts(c.text)) pool.set(ch, (pool.get(ch) ?? 0) + n);
    }
    const edits: Array<[number, ProjectedLine | null]> = [];
    for (const i of inside) {
      const line = lines[i];
      const rest: TextItem[] = [];
      for (const sp of line.spans) {
        const need = charCounts(sp.text);
        let covered = true;
        for (const [ch, n] of need) {
          if ((pool.get(ch) ?? -1) < n) covered = false;
        }
        if (covered) {
          for (const [ch, n] of need) pool.set(ch, (pool.get(ch) ?? 0) - n);
        } else {
          rest.push(sp);
        }
      }
      if (rest.length === line.spans.length) continue;
      edits.push([i, residualLine(line, rest)]);
    }
    if (edits.length === 0) continue;
    const [rows, headerRows] = toSpanRows(grid);
    // placed in the flow at its first line's (projected) position, which equals b.y unless
    // the projection moved the region
    const flowY = Math.min(Infinity, ...inside.map((i) => lines[i].bbox.y));
    tables.push([
      flowY,
      positionedBlock({ MergedTable: { rows, header_rows: headerRows } }, { ...b }),
    ]);
    // Leftover text inside the table's box is emitted in place as plain paragraphs: handed
    // back to the region pipeline it can be re-detected as a table spanning (and swallowing)
    // the model's own.
    for (const [i, l] of edits) {
      if (l !== null) {
        const block = {
          Paragraph: { text: escapeInline(l.text), bold: l.all_bold, italic: l.all_italic },
        };
        tables.push([l.bbox.y, positionedBlock(block, { ...l.bbox })]);
      }
      modelEdits.set(i, null);
    }
  }
  if (modelEdits.size === 0) return { tables, lines };
  const kept: ProjectedLine[] = [];
  lines.forEach((l, i) => {
    if (!modelEdits.has(i)) kept.push(l);
    else {
      const edit = modelEdits.get(i);
      if (edit != null) kept.push(edit);
    }
  });
  return { tables, lines: kept };
}
