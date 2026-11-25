// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The markdown renderer (blocks.rs `render_blocks` and helpers) and
// `escape_table_cell` (tables.rs): the `#[cfg(test)]` tests of the Rust files
// that exercise them.

import { describe, expect, test } from "bun:test";

import type { Block, PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { cell, spanCell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  escapeHtmlCell,
  isPlainGrid,
  positionedBlockFromJson,
  renderBlocks,
  renderPipeTable,
  wrapEmphasis,
} from "../../src/ocria/markdown-layout/render/index.js";
import { mathRuns } from "../../src/ocria/markdown-layout/inline/escape.js";
import { escapeTableCell } from "../../src/ocria/markdown-layout/tables/escape.js";

/** Content blocks that carry no geometry: the shape almost every rendering assertion cares about. */
function render(blocks: Block[]): string {
  const positioned: PositionedBlock[] = blocks.map((block) => ({
    block,
    bbox: null,
    text_item_indices: [],
  }));
  return renderBlocks(positioned);
}

const paragraph = (text: string, bold = false, italic = false): Block => ({
  Paragraph: { text, bold, italic },
});

const listItem = (ordered: boolean, marker: string, text: string, level = 0): Block => ({
  ListItem: { ordered, marker, level, text, bold: false, italic: false },
});

const cells = (...texts: string[]) => texts.map((t) => cell(t));

describe("render_blocks", () => {
  test("formats markdown", () => {
    const s = render([
      { Heading: { level: 1, text: "Title" } },
      paragraph("A paragraph."),
      { Heading: { level: 2, text: "Sub" } },
    ]);
    expect(s).toBe("# Title\n\nA paragraph.\n\n## Sub");
  });

  test("figure uses the extracted format", () => {
    expect(render([{ Figure: { id: "p1_1", format: "jpg" } }])).toBe("![](img_p1_1.jpg)");
  });

  test("lists are tight", () => {
    const s = render([
      paragraph("Intro."),
      listItem(false, "•", "a"),
      listItem(false, "•", "b"),
      paragraph("Outro."),
    ]);
    expect(s).toBe("Intro.\n\n- a\n- b\n\nOutro.");
    // Ordered: original marker preserved
    expect(
      render([listItem(true, "138.", "footnote"), listItem(true, "139.", "next footnote")])
    ).toBe("138. footnote\n139. next footnote");
  });

  test("list items indent two spaces per level, capped at six levels", () => {
    expect(render([listItem(false, "-", "a", 2), listItem(false, "-", "b", 9)])).toBe(
      `    - a\n${" ".repeat(12)}- b`
    );
  });

  test("heading levels clamp to 1..6", () => {
    expect(
      render([{ Heading: { level: 0, text: "a" } }, { Heading: { level: 9, text: "b" } }])
    ).toBe("# a\n\n###### b");
  });

  test("emphasis combinations", () => {
    expect(wrapEmphasis("hi", false, false)).toBe("hi");
    expect(wrapEmphasis("hi", true, false)).toBe("**hi**");
    expect(wrapEmphasis("hi", false, true)).toBe("*hi*");
    expect(wrapEmphasis("hi", true, true)).toBe("***hi***");
    expect(wrapEmphasis("   ", true, true)).toBe("   ");
    expect(render([paragraph("x", true, true)])).toBe("***x***");
  });

  test("code block escapes an internal fence", () => {
    const s = render([{ CodeBlock: { lines: ["body containing ``` backticks"], lang: null } }]);
    expect(s.startsWith("~~~\n")).toBe(true);
    expect(s.endsWith("~~~")).toBe(true);
  });

  test("code block with a language and grid fallback", () => {
    expect(render([{ CodeBlock: { lines: ["a", "b"], lang: "python" } }])).toBe(
      "```python\na\nb\n```"
    );
    expect(render([{ GridFallback: { lines: ["x  y", "1  2"] } }])).toBe(
      "```text\nx  y\n1  2\n```"
    );
  });

  test("horizontal rule", () => {
    expect(render([paragraph("a"), "HorizontalRule", paragraph("b")])).toBe("a\n\n---\n\nb");
  });

  test("renders a table to pipe format", () => {
    const s = render([
      {
        Table: {
          header: cells("a", "b"),
          rows: [cells("1", "2"), cells("3", "4")],
        },
      },
    ]);
    expect(s).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
  });

  test("a table without a header promotes the first row", () => {
    const s = render([{ Table: { header: null, rows: [cells("h1", "h2"), cells("1", "2")] } }]);
    // No blank `|   |   |` header: the first row becomes the header.
    expect(s).toBe("| h1 | h2 |\n|---|---|\n| 1 | 2 |");
  });

  test("a table with no columns renders nothing", () => {
    expect(render([{ Table: { header: null, rows: [] } }])).toBe("");
    expect(renderPipeTable([], [])).toBe("");
  });

  test("a merged table without spans renders as pipes", () => {
    // A merge-aware producer that happens to emit a plain grid must be
    // byte-identical to the PDF path's pipe table.
    const plain: Block = {
      Table: { header: cells("a", "b"), rows: [cells("1", "2")] },
    };
    const merged: Block = {
      MergedTable: {
        header_rows: 1,
        rows: [
          [spanCell("a"), spanCell("b")],
          [spanCell("1"), spanCell("2")],
        ],
      },
    };
    expect(render([plain])).toBe(render([merged]));
  });

  test("a headerless merged grid promotes its first row", () => {
    const merged: Block = {
      MergedTable: { header_rows: 0, rows: [[spanCell("a")], [spanCell("1")]] },
    };
    expect(render([merged])).toBe("| a |\n|---|\n| 1 |");
  });

  test("a merged table with spans renders as HTML", () => {
    // Cells covered by a span are absent, not empty: row 1 has one cell.
    const s = render([
      {
        MergedTable: {
          header_rows: 1,
          rows: [
            [spanCell("wide", 2, 1)],
            [spanCell("tall", 1, 2), spanCell("x")],
            [spanCell("y")],
          ],
        },
      },
    ]);
    expect(s).toBe(
      '<table>\n<tr>\n<th colspan="2">wide</th>\n</tr>\n' +
        '<tr>\n<td rowspan="2">tall</td>\n<td>x</td>\n</tr>\n' +
        "<tr>\n<td>y</td>\n</tr>\n</table>"
    );
  });

  test("a merged table escapes HTML, not markdown", () => {
    // Inside an HTML block, markdown specials are literal; `<` is not.
    const s = render([
      {
        MergedTable: {
          header_rows: 0,
          rows: [[spanCell("a|b *c* <d> &e"), spanCell("f", 2, 1)]],
        },
      },
    ]);
    expect(s).toContain("<td>a|b *c* &lt;d&gt; &amp;e</td>");
    expect(escapeHtmlCell("a\nb")).toBe("a b");
  });

  test("multiple header rows force HTML", () => {
    // Two header rows have no pipe-table representation even with no spans.
    const s = render([
      {
        MergedTable: {
          header_rows: 2,
          rows: [
            [spanCell("a"), spanCell("b")],
            [spanCell("c"), spanCell("d")],
            [spanCell("1"), spanCell("2")],
          ],
        },
      },
    ]);
    expect(s.startsWith("<table>")).toBe(true);
    expect(s.split("<th>").length - 1).toBe(4);
    expect(s.split("<td>").length - 1).toBe(2);
  });

  test("ragged rows force HTML", () => {
    // Uneven row widths with no declared spans would render as a broken
    // pipe table; HTML at least preserves the cells.
    const rows = [[spanCell("a"), spanCell("b")], [spanCell("1")]];
    expect(isPlainGrid(rows, 1)).toBe(false);
    expect(render([{ MergedTable: { header_rows: 1, rows } }]).startsWith("<table>")).toBe(true);
  });

  test("an empty merged table keeps its separator and nothing else", () => {
    expect(render([paragraph("a"), { MergedTable: { header_rows: 0, rows: [] } }])).toBe("a\n\n");
  });

  test("a zero span is coerced to one", () => {
    // `rowspan="0"` means "to the end of the section" in HTML: never what a
    // producer means here, so it must not survive into the output.
    const c = spanCell("x", 0, 0);
    expect([c.colspan, c.rowspan]).toEqual([1, 1]);
    expect(isPlainGrid([[c]], 0)).toBe(true);
  });
});

describe("escape_table_cell", () => {
  test("escapes math cell pipes but keeps backslashes", () => {
    expect(escapeTableCell(String.raw`$\|x\|_{2}$ a\b`)).toBe(String.raw`$\\|x\\|_{2}$ a\\b`);
  });

  test("escapes a pipe inside a cell", () => {
    expect(escapeTableCell("a|b")).toBe("a\\|b");
  });

  test("replaces a newline with a space", () => {
    expect(escapeTableCell("a\nb")).toBe("a b");
    expect(escapeTableCell("$a\nb$")).toBe("$a b$");
  });

  test("a dollar amount is not math", () => {
    expect(escapeTableCell(String.raw`$5 to $10 \x`)).toBe(String.raw`$5 to $10 \\x`);
  });
});

describe("math_runs", () => {
  test("splits math spans from text", () => {
    expect(mathRuns("a $x^2$ b")).toEqual([
      [false, "a "],
      [true, "$x^2$"],
      [false, " b"],
    ]);
    expect(mathRuns("")).toEqual([]);
    expect(mathRuns("no math")).toEqual([[false, "no math"]]);
  });

  test("the closing dollar must follow a non-space and, unless LaTeX, not precede a digit", () => {
    expect(mathRuns("$5 to $10")).toEqual([[false, "$5 to $10"]]);
    expect(mathRuns(String.raw`$\mathbb{R}$3`)).toEqual([
      [true, String.raw`$\mathbb{R}$`],
      [false, "3"],
    ]);
    expect(mathRuns("$x $")).toEqual([[false, "$x $"]]);
    expect(mathRuns(String.raw`\$x$`)).toEqual([[false, String.raw`\$x$`]]);
  });

  test("non-ASCII text around a span keeps the slices", () => {
    expect(mathRuns("é $x$ 😀")).toEqual([
      [false, "é "],
      [true, "$x$"],
      [false, " 😀"],
    ]);
  });
});

describe("positionedBlockFromJson", () => {
  test("fills the serde defaults of blocks and cells", () => {
    const table = positionedBlockFromJson({
      block: { Table: { header: [{ text: "a", bbox: null }], rows: [[{ text: "1" }]] } },
      bbox: null,
    });
    expect(table.text_item_indices).toEqual([]);
    expect(table.block).toEqual({
      Table: {
        header: [{ text: "a", bbox: null, text_item_indices: [] }],
        rows: [[{ text: "1", bbox: null, text_item_indices: [] }]],
      },
    });
    const headerless = positionedBlockFromJson({
      block: { Table: { header: null, rows: [] } },
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      text_item_indices: [4],
    });
    expect(headerless.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(headerless.text_item_indices).toEqual([4]);
    const merged = positionedBlockFromJson({
      block: { MergedTable: { rows: [[{ text: "m", colspan: 2 }]], header_rows: 0 } },
      bbox: null,
    });
    expect(merged.block).toEqual({
      MergedTable: {
        rows: [[{ text: "m", colspan: 2, rowspan: 1, bbox: null, text_item_indices: [] }]],
        header_rows: 0,
      },
    });
    expect(positionedBlockFromJson({ block: "HorizontalRule", bbox: null }).block).toBe(
      "HorizontalRule"
    );
    expect(
      positionedBlockFromJson({ block: { Figure: { id: "a", format: "png" } }, bbox: null }).block
    ).toEqual({ Figure: { id: "a", format: "png" } });
  });
});
