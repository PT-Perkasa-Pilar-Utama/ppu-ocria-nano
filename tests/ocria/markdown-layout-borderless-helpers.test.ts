// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Fixtures shared by the markdown-layout-tables-borderless tests.

import { expect } from "bun:test";

import type { ProjectedLine } from "../../src/ocria/types/page.js";
import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import type { TableCell, TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";

/** A line from "text@x|text@x" cells at height 10, font size 10. */
export function spec(cells: string, y: number): ProjectedLine {
  const parts = cells.split("|").map((c): [string, number] => {
    const at = c.lastIndexOf("@");
    return [c.slice(0, at), Number(c.slice(at + 1))];
  });
  return lineWithSpans(parts, y, 10);
}

/** A three-column row at x = 50, 200, 350, plus optional extra cells ("text@x|..."). */
export function row3(a: string, b: string, c: string, y: number, extra = ""): ProjectedLine {
  return spec(`${a}@50|${b}@200|${c}@350${extra === "" ? "" : `|${extra}`}`, y);
}

export function tc(
  start: number,
  end: number,
  text: string,
  extra: Partial<TableCell> = {}
): TableCell {
  return {
    start_x: start,
    end_x: end,
    text,
    bold: false,
    text_item_indices: [],
    item_x_ranges: [],
    ...extra,
  };
}

export function tableOf(run: TableRun): { header: Cell[] | null; rows: Cell[][] } {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) {
    throw new Error(`expected Block::Table, got ${JSON.stringify(b)}`);
  }
  return b.Table;
}

export function texts(cells: ReadonlyArray<{ text: string }>): string[] {
  return cells.map((c) => c.text);
}

/** Lines tagged with consecutive item indices, one per span. */
export function taggedLines(rows: ReadonlyArray<[string, number]>): ProjectedLine[] {
  let next = 0;
  return rows.map(([cells, y]) => {
    const l = spec(cells, y);
    l.span_item_indices = l.spans.map((_, i) => next + i);
    next += l.spans.length;
    return l;
  });
}

/** Every word of a run's consumed lines appears in what the run carries. */
export function assertRunKeepsText(lines: ProjectedLine[], run: TableRun): void {
  const b: Block = run.block;
  let kept: string;
  if (typeof b !== "string" && "Table" in b) {
    kept = [...(b.Table.header ?? []), ...b.Table.rows.flat()].map((c) => c.text).join(" ");
  } else if (typeof b !== "string" && "GridFallback" in b) {
    kept = b.GridFallback.lines.join(" ");
  } else {
    throw new Error(`unexpected table block ${JSON.stringify(b)}`);
  }
  for (const note of run.interstitials) kept += ` ${note.text}`;
  for (const l of lines.slice(run.start, run.end)) {
    for (const word of l.text.split(/\s+/).filter((w) => w !== "")) {
      expect(kept.includes(word)).toBe(true);
    }
  }
}
