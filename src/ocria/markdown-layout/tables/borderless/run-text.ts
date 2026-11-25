// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): what a table run keeps of its lines.

import { isAsciiDigit, splitWhitespace } from "../../../rust-extra.js";
import { chars, f32, isWhitespace, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import type { TableRun } from "../types.js";

function nonSpaceChars(t: string): number {
  return chars(t).filter((c) => !isWhitespace(c)).length;
}

/** The cells of a `Table` block run (header, then rows), then its interstitials. */
function runCells(run: TableRun): Cell[] | null {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return null;
  return [...(b.Table.header ?? []), ...b.Table.rows.flat(), ...run.interstitials];
}

/**
 * Share of the non-space characters of the lines a run spans that its cells
 * and interstitials carry, or null for a run that is not a pipe table. The
 * classifier skips the whole span, so whatever the table leaves out is dropped
 * from the markdown. Header replication can push it above 1.
 */
export function runTextKept(run: TableRun, lines: ProjectedLine[]): number | null {
  const cells = runCells(run);
  if (cells === null) return null;
  if (run.start > run.end || run.end > lines.length) return null;
  let span = 0;
  for (const l of lines.slice(run.start, run.end)) span += nonSpaceChars(l.text);
  if (span === 0) return null;
  let kept = 0;
  for (const c of cells) kept += nonSpaceChars(c.text);
  return f32(kept / span);
}

/**
 * Lines inside a run's span that none of its cells or interstitials took a
 * word from. The classifier skips the span, so these would be dropped. A line
 * that shares even one word with the table stays with it, so nothing the table
 * already shows is repeated.
 */
export function linesLeftOut(run: TableRun, lines: ProjectedLine[]): number[] {
  const cells = runCells(run);
  if (cells === null) return [];
  const words = new Map<string, number>();
  for (const cell of cells) {
    for (const w of splitWhitespace(cell.text)) words.set(w, (words.get(w) ?? 0) + 1);
  }
  const out: number[] = [];
  for (let i = run.start; i < Math.min(run.end, lines.length); i++) {
    let taken = false;
    for (const w of splitWhitespace(lines[i].text)) {
      const n = words.get(w);
      if (n !== undefined && n > 0) {
        words.set(w, n - 1);
        taken = true;
      }
    }
    if (!taken && trim(lines[i].text) !== "") out.push(i);
  }
  return out;
}

/**
 * Measurement-value shape: a decimal number ("2.28"), currency/percent,
 * comma-grouped number ("1,240"), or a dash placeholder ("--" / em dash).
 * Bare integers (years, codes) deliberately do NOT match - they appear in
 * legitimate header layers.
 */
export function isValueLike(text: string): boolean {
  const t = trim(text);
  if (t === "") return false;
  const cs = chars(t);
  if (cs.every((c) => c === "-" || c === "—" || c === "–")) return true;
  if (t.includes("$") || t.includes("%") || t.includes("±")) return true;
  for (let i = 0; i + 2 < cs.length; i++) {
    if (
      isAsciiDigit(cs[i]) &&
      (cs[i + 1] === "." || cs[i + 1] === ",") &&
      isAsciiDigit(cs[i + 2])
    ) {
      return true;
    }
  }
  return false;
}
