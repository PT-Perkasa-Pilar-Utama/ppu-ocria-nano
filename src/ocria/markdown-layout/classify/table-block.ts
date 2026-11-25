// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): table-block statistics.

import { splitWhitespace } from "../../rust-extra.js";
import { f32, isLowercase, trim, trimEnd, trimStart } from "../../rust.js";
import type { Block } from "../block-types.js";

const ASCII_DIGIT = /[0-9]/;
const SENTENCE_ENDS = [".", "!", "?", ":", ";"];

/** The cells of a `Table` block (header first), or null for any other block. */
function tableCells(block: Block): string[] | null {
  if (typeof block === "string" || !("Table" in block)) return null;
  const { header, rows } = block.Table;
  return [...(header ?? []), ...rows.flat()].map((c) => c.text);
}

export function tableColumnCount(block: Block): number {
  if (typeof block === "string" || !("Table" in block)) return 0;
  const { header, rows } = block.Table;
  if (header != null) return header.length;
  return rows.length > 0 ? rows[0].length : 0;
}

export function filledCellCount(block: Block): number {
  return (tableCells(block) ?? []).filter((t) => trim(t) !== "").length;
}

export function numericFilledCellCount(block: Block): number {
  return (tableCells(block) ?? []).filter((t) => ASCII_DIGIT.test(t)).length;
}

export function tableCoversGlobal(local: Block, global: Block): boolean {
  const globalNumeric = numericFilledCellCount(global);
  if (globalNumeric === 0) {
    return filledCellCount(local) >= f32(f32(0.6) * filledCellCount(global));
  }
  return numericFilledCellCount(local) >= f32(f32(0.6) * globalNumeric);
}

/** The cell texts of a `Table` or `MergedTable` as rows, or null for any other block. */
function textGrid(block: Block): string[][] | null {
  if (typeof block === "string") return null;
  if ("Table" in block) {
    const { header, rows } = block.Table;
    const all = header == null ? rows : [header, ...rows];
    return all.map((r) => r.map((c) => c.text));
  }
  if ("MergedTable" in block) return block.MergedTable.rows.map((r) => r.map((c) => c.text));
  return null;
}

/**
 * A heuristic table whose cells read as multi-column prose: mostly non-numeric cells whose
 * text runs on down each column (a cell that doesn't end a sentence over one that
 * starts lowercase). The same test as `table_model::Grid::is_prose`; the borderless
 * detector's false tables on multi-column reports look like this, real tables don't.
 */
export function tableBlockIsProse(block: Block): boolean {
  const grid = textGrid(block);
  if (grid == null) return false;
  const words = (t: string): number => splitWhitespace(t).length;
  const cells = grid.flat().filter((t) => trim(t) !== "");
  if (cells.length < 6) return false;
  const wc = cells.map(words).sort((a, b) => a - b);
  const medianWords = wc[Math.floor(wc.length / 2)];
  if (medianWords < 2) return false;
  const numeric = cells.filter((t) => words(t) <= 3 && ASCII_DIGIT.test(t)).length;
  if (numeric * 10 >= cells.length * 3) return false;
  const nCols = Math.max(0, ...grid.map((r) => r.length));
  let pairs = 0;
  let flow = 0;
  for (let q = 0; q < nCols; q++) {
    const col: Array<[number, string]> = [];
    grid.forEach((r, i) => {
      if (q < r.length && trim(r[q]) !== "") col.push([i, r[q]]);
    });
    for (let k = 0; k + 1 < col.length; k++) {
      const [i0, t0] = col[k];
      const [i1, t1] = col[k + 1];
      if (i1 > i0 + 2) continue;
      pairs += 1;
      const e = trimEnd(t0);
      const open = !SENTENCE_ENDS.some((c) => e.endsWith(c));
      const first = Array.from(trimStart(t1))[0];
      const lower = first !== undefined && isLowercase(first);
      if (open && lower) flow += 1;
    }
  }
  // long cells (4+ words) need 40% of adjacent pairs to flow; short line fragments (narrow
  // prose columns split one line per row, 2-3 words a cell) need 60%
  if (pairs < 3) return false;
  return medianWords >= 4 ? flow * 10 >= pairs * 4 : flow * 10 >= pairs * 6;
}
