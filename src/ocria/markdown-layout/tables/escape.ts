// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): escape_table_cell.

import { mathRuns } from "../inline/escape.js";

/**
 * Escape `|` and `\n` inside a markdown table cell so the pipe-table grammar
 * stays valid. Newlines should be impossible inside a single cell (we built
 * cells from spans on the same projected line) but guard anyway.
 */
export function escapeTableCell(s: string): string {
  let out = "";
  for (const [isMath, run] of mathRuns(s)) {
    // Inline math keeps its backslashes; only the pipe is escaped
    // (GFM splits cells before parsing inlines).
    const body = isMath ? run : run.replaceAll("\\", "\\\\");
    out += body.replaceAll("|", "\\|").replaceAll("\n", " ");
  }
  return out;
}
