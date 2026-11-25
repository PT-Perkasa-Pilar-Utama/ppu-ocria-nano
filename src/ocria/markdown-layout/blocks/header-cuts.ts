// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import { f32, trim } from "../../rust.js";
import { isAsciiDigit, splitWhitespace } from "../../rust-extra.js";
import type { Rect } from "../../types/geometry.js";
import type { Cell } from "../block-types.js";

const NUMERIC_PUNCT = " .,%$()-–+*/";

/** `str::split_whitespace` joined by single spaces and lowercased. */
function norm(s: string): string {
  return splitWhitespace(s).join(" ").toLowerCase();
}

export function nonempty(cells: Iterable<string>): number {
  let n = 0;
  for (const c of cells) if (trim(c) !== "") n++;
  return n;
}

/**
 * A column empty in every row that separates two tables set side by side: each side keeps at
 * least two columns and the sides' first rows share at least half of the smaller side's
 * non-empty header cells (the same columns repeated), so a spacer column inside one table
 * (empty between a currency sign and its figures) is never a cut.
 */
export function sideBySideGutter(rows: readonly (readonly Cell[])[]): number | null {
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const empty = (c: number): boolean => rows.every((r) => c >= r.length || trim(r[c].text) === "");
  const head = rows[0];
  const allEmpty = (from: number, to: number): boolean => {
    for (let c = from; c < to; c++) if (!empty(c)) return false;
    return true;
  };
  for (let g = 2; g < Math.max(width - 2, 0); g++) {
    if (!empty(g) || allEmpty(0, g) || allEmpty(g + 1, width)) continue;
    const left = head
      .slice(0, g)
      .map((c) => norm(c.text))
      .filter((s) => s !== "");
    const right = head
      .slice(g + 1)
      .map((c) => norm(c.text))
      .filter((s) => s !== "");
    const shared = right.filter((s) => left.includes(s)).length;
    if (
      left.length >= 2 &&
      right.length >= 2 &&
      shared * 2 >= Math.min(left.length, right.length)
    ) {
      return g;
    }
  }
  return null;
}

/** A plain number: at least one digit and nothing but digits and number punctuation. */
function numeric(cell: string): boolean {
  const c = trim(cell);
  if (c === "") return false;
  const cs = Array.from(c);
  return cs.some(isAsciiDigit) && cs.every((ch) => isAsciiDigit(ch) || NUMERIC_PUNCT.includes(ch));
}

/**
 * The key of a header row: three or more filled cells, mostly words (a repeated data row such
 * as a regression table's reference category, "Non-snacker | 1.00 | 1.00", is no header).
 */
function headerKey(r: readonly string[]): string | null {
  const filled = nonempty(r);
  const nums = r.filter(numeric).length;
  if (!(filled >= 3 && nums * 3 <= filled)) return null;
  return r.map(norm).join("\u001f");
}

/**
 * Row indices where a new table starts (see `splitRepeatedHeaderTables`); a row with
 * `blocked[i]` (inside a row span) is never a cut.
 */
export function repeatedHeaderCuts(
  rows: readonly (readonly string[])[],
  blocked: readonly boolean[]
): number[] {
  const cuts: number[] = [];
  let segStart = 0;
  for (let i = 1; i < rows.length; i++) {
    const k = headerKey(rows[i]);
    if (k == null) continue;
    // the earlier copy heads the current table (its first three rows)
    let repeats = false;
    for (let j = segStart; j < Math.min(i, segStart + 3); j++) {
      if (headerKey(rows[j]) === k) repeats = true;
    }
    if (!repeats) continue;
    // the title row above moves with the repeated header
    const cut = i - 1 > segStart && nonempty(rows[i - 1]) === 1 ? i - 1 : i;
    if (cut > segStart && !blocked[cut]) {
      cuts.push(cut);
      segStart = cut;
    }
  }
  return cuts;
}

/** The smallest rect covering every rect given, in f32; null when there are none. */
export function unionCells(rects: Iterable<Rect>): Rect | null {
  let b: [number, number, number, number] | null = null;
  for (const r of rects) {
    const x1 = f32(r.x + r.width);
    const y1 = f32(r.y + r.height);
    b =
      b == null
        ? [r.x, r.y, x1, y1]
        : [Math.min(b[0], r.x), Math.min(b[1], r.y), Math.max(b[2], x1), Math.max(b[3], y1)];
  }
  return b == null ? null : { x: b[0], y: b[1], width: f32(b[2] - b[0]), height: f32(b[3] - b[1]) };
}
