// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0): render_pipe_table, escape_html_cell, is_plain_grid, render_html_table.

import type { Cell, SpanCell } from "../block-types.js";
import { escapeTableCell } from "../tables/escape.js";

const HTML_SPECIALS = /[&<>\n]/g;

function htmlEscape(c: string): string {
  switch (c) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    default:
      return " ";
  }
}

/**
 * Render a GFM pipe table. `head` is the header row (already chosen by the
 * caller); `body` the remaining rows. Empty when there are no columns.
 */
export function renderPipeTable(head: readonly Cell[] | null, body: readonly Cell[][]): string {
  const columnCount = head === null ? 0 : head.length;
  if (head === null || columnCount === 0) return "";
  let out = `| ${head.map((cell) => escapeTableCell(cell.text)).join(" | ")} |\n|`;
  out += "---|".repeat(columnCount);
  for (const row of body) {
    out += `\n| ${row.map((cell) => escapeTableCell(cell.text)).join(" | ")} |`;
  }
  return out;
}

/**
 * Escape a cell for HTML `<td>` content. Markdown specials are deliberately
 * left alone: inside an HTML block they are literal text, and escaping them
 * would surface backslashes in the rendered output.
 */
export function escapeHtmlCell(s: string): string {
  return s.replace(HTML_SPECIALS, htmlEscape);
}

/**
 * True when a merged table degenerates to a plain rectangular grid, in which
 * case the pipe rendering is both valid and nicer to read.
 */
export function isPlainGrid(rows: readonly SpanCell[][], headerRows: number): boolean {
  // GFM has exactly one header row, or none.
  if (headerRows > 1) return false;
  if (!rows.every((r) => r.every((c) => c.colspan <= 1 && c.rowspan <= 1))) return false;
  // Ragged rows can only have come from spans we've just ruled out, but check
  // anyway: a pipe table with uneven rows renders as a broken table.
  const width = rows.length > 0 ? rows[0].length : 0;
  return rows.every((r) => r.length === width);
}

/**
 * Render a merged table as HTML. Cells covered by a neighbour's span are
 * simply absent from `rows`, so this is a direct transcription.
 */
export function renderHtmlTable(rows: readonly SpanCell[][], headerRows: number): string {
  let out = "<table>";
  rows.forEach((row, r) => {
    out += "\n<tr>";
    const tag = r < headerRows ? "th" : "td";
    for (const cell of row) {
      out += `\n<${tag}`;
      if (cell.colspan > 1) out += ` colspan="${cell.colspan}"`;
      if (cell.rowspan > 1) out += ` rowspan="${cell.rowspan}"`;
      out += `>${escapeHtmlCell(cell.text)}</${tag}>`;
    }
    out += "\n</tr>";
  });
  return `${out}\n</table>`;
}
