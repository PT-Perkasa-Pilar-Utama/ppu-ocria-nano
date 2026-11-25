// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0): render_blocks.

import type { Block, Cell, PositionedBlock } from "../block-types.js";
import { cell } from "../block-types.js";
import { clamp } from "../../rust.js";
import { wrapEmphasis } from "./emphasis.js";
import { isPlainGrid, renderHtmlTable, renderPipeTable } from "./table-render.js";

type ListItem = Extract<Block, { ListItem: unknown }>["ListItem"];

function renderListItem(item: ListItem): string {
  const indent = "  ".repeat(Math.min(item.level, 6));
  // Preserve the original marker (e.g. `138.` for footnotes or `iii)` for
  // roman numerals) so semantic numbering survives the round-trip.
  // CommonMark requires `1.` / `1)` style but most LLM consumers tolerate alt
  // forms, and the alternative (renumbering as `1.`) drops info.
  const lead = item.ordered ? `${item.marker} ` : "- ";
  return indent + lead + wrapEmphasis(item.text, item.bold, item.italic);
}

/** The table's header row and body: the first body row leads when the header is missing. */
function headAndBody(
  header: Cell[] | null,
  rows: Cell[][]
): [readonly Cell[] | null, readonly Cell[][]] {
  // GFM requires a header row before the separator. When the detector found no
  // header, promote the first body row instead of synthesizing a blank
  // `|   |   |` header: a visible empty row reads as sloppy output and carries
  // no information.
  if (header !== null) return [header, rows];
  if (rows.length > 0) return [rows[0], rows.slice(1)];
  return [null, rows];
}

function renderCodeBlock(lines: readonly string[], lang: string | null): string {
  // Pick a fence that doesn't appear inside the body. Standard triple-backtick
  // handles ~all real-world code; bump to ~~~ if the body itself contains ```
  // (rare).
  const fence = lines.some((l) => l.includes("```")) ? "~~~" : "```";
  let out = fence + (lang ?? "");
  out += "\n";
  for (const line of lines) out += `${line}\n`;
  return out + fence;
}

function renderBlock(block: Block): string {
  if (block === "HorizontalRule") return "---";
  if ("Heading" in block) {
    const level = clamp(block.Heading.level, 1, 6);
    return `${"#".repeat(level)} ${block.Heading.text}`;
  }
  if ("Paragraph" in block) {
    const p = block.Paragraph;
    return wrapEmphasis(p.text, p.bold, p.italic);
  }
  if ("ListItem" in block) return renderListItem(block.ListItem);
  if ("Table" in block) {
    const [head, body] = headAndBody(block.Table.header, block.Table.rows);
    return renderPipeTable(head, body);
  }
  if ("MergedTable" in block) {
    const { rows, header_rows: headerRows } = block.MergedTable;
    if (rows.length === 0) return "";
    if (!isPlainGrid(rows, headerRows)) return renderHtmlTable(rows, headerRows);
    // Degenerate case: no merges, so pipes are expressive enough. Reuse the
    // exact same rendering `Block::Table` gets, including the
    // promote-first-row-when-headerless rule. `header_rows` is 0 or 1 here
    // (>1 forces HTML). Either way the first row leads: as the real header, or
    // promoted into one because GFM has no headerless table.
    const plain = rows.map((r) => r.map((c) => cell(c.text)));
    return renderPipeTable(plain[0], plain.slice(1));
  }
  if ("GridFallback" in block) {
    let out = "```text\n";
    for (const line of block.GridFallback.lines) out += `${line}\n`;
    return `${out}\`\`\``;
  }
  if ("CodeBlock" in block) return renderCodeBlock(block.CodeBlock.lines, block.CodeBlock.lang);
  return `![](img_${block.Figure.id}.${block.Figure.format})`;
}

function isListItem(block: Block): boolean {
  return block !== "HorizontalRule" && "ListItem" in block;
}

/** Render a list of blocks to a markdown string. */
export function renderBlocks(blocks: readonly PositionedBlock[]): string {
  let out = "";
  blocks.forEach((positioned, i) => {
    const { block } = positioned;
    if (i > 0) {
      // Consecutive list items render as a tight list (single newline).
      // Everything else gets a blank line between blocks.
      const tight = isListItem(block) && isListItem(blocks[i - 1].block);
      out += tight ? "\n" : "\n\n";
    }
    out += renderBlock(block);
  });
  return out;
}
