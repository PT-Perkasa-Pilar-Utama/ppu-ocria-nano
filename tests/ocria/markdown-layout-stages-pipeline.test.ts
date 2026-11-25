// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Port of the `#[cfg(test)]` tests of liteparse crates/liteparse/src/stages.rs
// (crates-v2.21.2) that run the markdown stages end to end, and of the table
// test `deskewed_measured_words_keep_three_table_columns` that does the same
// from OCR results.

import { describe, expect, test } from "bun:test";

import { line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { OcrResult, OcrWord } from "../../src/ocria/ocr/types.js";
import { mergeOcrResults } from "../../src/ocria/ocr-merge/index.js";
import { projectPagesForMarkdown, projectPagesToGrid } from "../../src/ocria/projection/index.js";
import { toRadiansF32 } from "../../src/ocria/rust-extra.js";
import { documentSignals } from "../../src/ocria/stages/document-signals.js";
import { extractBlocks } from "../../src/ocria/stages/extract-blocks.js";
import type { BlockOptions } from "../../src/ocria/stages/extract-blocks.js";
import { layoutBlocks } from "../../src/ocria/stages/layout-blocks.js";
import { renderPageMarkdown } from "../../src/ocria/stages/render-page-markdown.js";
import { f32 } from "../../src/ocria/rust.js";
import type { Page, ParsedPage } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";

const PLACEHOLDER: BlockOptions = {
  outline: [],
  image_mode: "placeholder",
  keep_headers_footers: false,
};

/** The markdown stages composed as `parse()` composes them, one string per page. */
function renderPages(pages: ParsedPage[]): string[] {
  const signals = documentSignals(pages, false);
  return pages.map((p) => renderPageMarkdown(p, extractBlocks(p, signals, PLACEHOLDER)));
}

function renderDocument(pages: ParsedPage[]): string {
  return renderPages(pages).join("\n\n-----\n\n");
}

function pageWith(n: number, lines: ReturnType<typeof line>[]): ParsedPage {
  const p = page(lines);
  p.page_number = n;
  p.text = "fallback";
  return p;
}

function blankPage(items: TextItem[]): Page {
  return {
    page_number: 1,
    ocr_deskew: null,
    page_label: null,
    page_width: 612,
    page_height: 792,
    content_bounds: null,
    text_items: items,
    graphics: [],
    vector_graphics: null,
    struct_nodes: [],
    image_refs: [],
    annotations: null,
    form_fields: null,
    structure_tree: null,
  };
}

/**
 * Markdown of a one-page scan: three horizontal body lines, then the OCR items
 * `row` as `(text, x, y, rotation)`. A sideways item's box stands upright: 10pt
 * wide and 5pt tall per character.
 */
function ocrMarkdown(row: ReadonlyArray<[string, number, number, number]>): string {
  const body = [
    "Register of changes for the period ending May",
    "Prepared by the records office for its review",
    "All amounts are in dollars before any tax is due",
  ];
  const rows: Array<[string, number, number, number]> = [
    ...body.map((text, i): [string, number, number, number] => [text, 50, 100 + i * 20, 0]),
    ...row,
  ];
  const items = rows.map(([text, x, y, rotation]) => {
    const length = f32([...text].length * 5);
    const [width, height] = rotation === 0 ? [length, 10] : [10, length];
    return textItem({
      text,
      x,
      y,
      width,
      height,
      rotation,
      font_size: 10,
      font_name: "OCR",
      confidence: 0.9,
    });
  });
  return renderDocument(projectPagesForMarkdown([blankPage(items)]));
}

describe("stages pipeline", () => {
  test("empty_document_renders_empty", () => {
    expect(renderDocument([])).toBe("");
  });

  test("a_row_with_one_sideways_glyph_stays_in_the_markdown", () => {
    // OCR can read a row's index digit as one glyph at 90°. The glyph sits just
    // under the line above, so projection keeps it on its row. The row is still
    // horizontal text: markdown keeps it and leaves the glyph out.
    const md = ocrMarkdown([
      ["L", 50, 155, 90],
      ["Current", 80, 155, 0],
      ["A-001", 150, 155, 0],
      ["Smith", 230, 155, 0],
    ]);
    expect(md).toContain("Current A-001 Smith");
    expect(md).not.toContain("L");
  });

  test("a_line_made_mostly_of_sideways_text_is_skipped", () => {
    // A margin stamp read at 90° with one fragment read upright is still margin
    // furniture: the whole line stays out of the markdown.
    const md = ocrMarkdown([
      ["arXiv:2401.00001v1", 50, 360, 90],
      ["Q7", 52, 400, 0],
    ]);
    expect(md).not.toContain("arXiv");
    expect(md).not.toContain("Q7");
  });

  test("stages_link_blocks_back_to_text_items", () => {
    const rows: Array<[string, number, number]> = [
      ["Heading For The Page", 50, 18],
      ["First line of body prose here.", 80, 10],
      ["second line of body prose here.", 92, 10],
      ["Third line of body prose here.", 104, 10],
    ];
    const items = rows.map(([text, y, h]) =>
      textItem({ text, x: 50, y, width: 200, height: h, font_size: h, font_name: "Arial" })
    );
    const pages = projectPagesToGrid([blankPage(items)]);
    const signals = documentSignals(pages, false);
    const blocks = extractBlocks(pages[0], signals, PLACEHOLDER);
    expect(blocks).not.toBeNull();
    const layout = layoutBlocks(pages[0], blocks ?? []);
    expect(layout.length).toBe(2);
    expect(layout[0].kind).toBe("heading");
    expect(layout[0].text_item_indices).toEqual([0]);
    expect(layout[1].kind).toBe("paragraph");
    expect(layout[1].text_item_indices).toEqual([1, 2, 3]);
    // Indices address the projected page's `text_items`.
    expect(pages[0].text_items[0].text).toBe("Heading For The Page");
  });

  test("page_without_projected_lines_falls_back_to_fenced_text", () => {
    const p = pageWith(1, []);
    p.text = "hello";
    const out = renderDocument([p]);
    expect(out).toContain("```text");
    expect(out).toContain("hello");
  });

  test("heading_and_paragraph", () => {
    const p = pageWith(1, [
      line("My Title For This Test Document", 50, 50, 18, 18),
      line("First sentence of body prose here.", 50, 80, 10, 10),
      line("Second sentence of body prose here.", 50, 92, 10, 10),
      line("Third sentence of body prose here.", 50, 104, 10, 10),
    ]);
    const out = renderDocument([p]);
    expect(out).toContain("# My Title For This Test Document");
    expect(out).toContain("First sentence of body prose here.");
  });

  test("per_page_markdown_joins_with_separator", () => {
    const pages = [
      pageWith(1, [line("A page.", 50, 80, 10, 10)]),
      pageWith(2, [line("B page.", 50, 80, 10, 10)]),
    ];
    const perPage = renderPages(pages);
    expect(perPage.length).toBe(2);
    expect(perPage[0]).toContain("A page.");
    expect(perPage[1]).toContain("B page.");
    // The per-page strings carry no separator on their own.
    expect(perPage[0]).not.toContain("-----");
    const out = renderDocument(pages);
    expect(out).toContain("-----");
    expect(out.indexOf("A page.")).toBeLessThan(out.indexOf("B page."));
  });
});

type Pt = [number, number];

describe("OCR to markdown", () => {
  test("deskewed_measured_words_keep_three_table_columns", () => {
    const bounds = (q: Pt[]): [number, number, number, number] => [
      Math.min(...q.map((p) => p[0])),
      Math.min(...q.map((p) => p[1])),
      Math.max(...q.map((p) => p[0])),
      Math.max(...q.map((p) => p[1])),
    ];
    for (const skew of [0, 5, 10]) {
      const rad = toRadiansF32(skew);
      const sin = f32(Math.sin(rad));
      const cos = f32(Math.cos(rad));
      const quad = (x: number, y: number, width: number): [Pt, Pt, Pt, Pt] => {
        const corners: Pt[] = [
          [x, y],
          [f32(x + width), y],
          [f32(x + width), f32(y + 30)],
          [x, f32(y + 30)],
        ];
        const [a, b, c, d] = corners.map(([px, py]): Pt => {
          const dx = f32(px - 306);
          const dy = f32(py - 396);
          return [
            f32(f32(306 + f32(dx * cos)) - f32(dy * sin)),
            f32(f32(396 + f32(dx * sin)) + f32(dy * cos)),
          ];
        });
        return [a, b, c, d];
      };
      const results: OcrResult[] = [0, 1, 2, 3].map((row) => {
        const y = f32(260 + f32(row * 45));
        const polygon = quad(100, y, 400);
        const texts =
          row === 0 ? ["Item", "name", "Qty", "Price"] : ["Widget", "large", "2", "$40"];
        const spans: Array<[number, number]> = [
          [100, 40],
          [145, 60],
          [340, 40],
          [430, 70],
        ];
        const words: OcrWord[] = texts.map((text, i) => ({
          text,
          bbox: bounds(quad(spans[i][0], y, spans[i][1])),
        }));
        return {
          text: texts.join(" "),
          bbox: bounds(polygon),
          polygon,
          confidence: 0.99,
          rotation: 0,
          words,
          faint: false,
        };
      });
      const pages = [blankPage([])];
      mergeOcrResults(
        pages,
        [
          {
            page_number: 1,
            dpi: 72,
            has_native_text: false,
            image_rects: [],
            replace_native: false,
            results,
          },
        ],
        false,
        true
      );
      const projected = projectPagesForMarkdown(pages);
      const signals = documentSignals(projected, true);
      const blocks = extractBlocks(projected[0], signals, {
        outline: [],
        image_mode: "off",
        keep_headers_footers: true,
      });
      const markdown = renderPageMarkdown(projected[0], blocks);
      expect(markdown, `skew=${skew}: ${markdown}`).toContain("|---|---|---|");
      expect(markdown, `skew=${skew}: ${markdown}`).toContain("| Item name | Qty | Price |");
      expect(markdown.split("| Widget large | 2 | $40 |").length - 1).toBe(3);
    }
  });
});
