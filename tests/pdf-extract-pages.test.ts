// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the tests of the `#[cfg(test)]` module of liteparse crates/liteparse/src/extract.rs
// (crates-v2.21.2) that build a PDF in memory and extract it, against src/pdf/extract/pages.ts,
// page-text.ts and the segment files.
//
// Not ported, because the subject has no port: `encode_pixels_png_*`, `image_cache_remove_page_*`
// and `extract_pages_from_input_missing_file_errors` (`PdfInput::Path`; the TS entry takes bytes),
// `vector_graphics_*` and `white_fill_*` (`build_vector_graphics`).
//
// `resolve_page_result` has no port of its own: `extractPagesAndImages` inlines it, so its two
// tests run through `extractPagesAndImages` on a document whose `page` throws.
//
// The goldens' pdfium substitutes system fonts for the standard-14 fonts, the wasm build uses its
// built-in Foxit fonts; a test that depends on the advance widths of Helvetica or Times is
// marked where it differs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { projectPagesToGrid } from "../src/ocria/projection/index.js";
import type { Page } from "../src/ocria/types/page.js";
import type { TextItem } from "../src/ocria/types/text-item.js";
import { defaultExtractionOutputOptions } from "../src/pdf/extract/options.js";
import type { ExtractRequest } from "../src/pdf/extract/pages.js";
import { extractPagesAndImages } from "../src/pdf/extract/pages.js";
import type { Document } from "../src/pdf/pdfium/document.js";
import { Library } from "../src/pdf/pdfium/library.js";

/** `extract_pages_from_document`: every page, no links, default output options. */
function request(continueOnPageError = false): ExtractRequest {
  return {
    targetPages: null,
    maxPages: Number.MAX_SAFE_INTEGER,
    extractLinks: false,
    glyphResolver: null,
    output: { ...defaultExtractionOutputOptions(), continue_on_page_error: continueOnPageError },
  };
}

function streamObject(content: string): string {
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

/** A classic-xref PDF from its objects (object `n` is `objects[n - 1]`); every byte is ASCII. */
function buildPdf(header: string, objects: readonly string[]): Uint8Array {
  let pdf = `${header}\n`;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

function rotatedTextPdf(): Uint8Array {
  const content =
    "BT /F1 10 Tf 20 40 Td (FIRSTMARK) Tj ET\nBT /F1 10 Tf 20 250 Td (SECONDMARK) Tj ET";
  return buildPdf("%PDF-1.7", [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Rotate 90 /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Rotate 270 /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    streamObject(content),
    streamObject(content),
    HELVETICA,
  ]);
}

/**
 * One normal page plus a `/UserUnit 36` page whose text is written at 0.3 pt, real size 10.8 pt.
 * PDFium reports the raw sub-point metrics, so without the user-unit rescale every char on page 2
 * dies in the zero-height (< 0.5 pt) filter, which is exactly how spreadsheet-export invoices
 * used to parse as completely empty pages.
 */
function userUnitPdf(): Uint8Array {
  return buildPdf("%PDF-1.7", [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 100] /UserUnit 36 /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    streamObject("BT /F1 10 Tf 20 40 Td (NORMALMARK) Tj ET"),
    streamObject("BT /F1 0.3 Tf 2 50 Td (TINYMARK) Tj ET"),
    HELVETICA,
  ]);
}

function type1PagePdf(baseFont: string, content: string): Uint8Array {
  return buildPdf("%PDF-1.4", [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} >>`,
    streamObject(content),
  ]);
}

function assertXNear(item: TextItem, want: number): void {
  // text {item.text} x={item.x} want {want}
  expect(Math.abs(item.x - want), `text ${item.text} x=${item.x} want ${want}`).toBeLessThan(0.25);
}

function byText(items: readonly TextItem[], text: string): TextItem {
  const found = items.find((it) => it.text === text);
  if (found === undefined) throw new Error(`missing ${text} in ${JSON.stringify(items)}`);
  return found;
}

const withoutWhitespace = (s: string): string => s.replace(/\s/gu, "");

let lib: Library;

beforeAll(async () => {
  lib = await Library.init();
});

/** Open `pdf`, extract it, and close it. */
function extractBytes(pdf: Uint8Array): Page[] {
  const document = lib.loadDocumentFromBytes(pdf, null);
  try {
    return extractPagesAndImages(document, request()).pages;
  } finally {
    document.close();
  }
}

describe("extract pages through pdfium", () => {
  test("user_unit_page_extracts_text_at_real_scale", () => {
    const pages = extractBytes(userUnitPdf());
    expect(pages).toHaveLength(2);

    // The normal page is untouched by the user-unit machinery.
    expect([pages[0].page_width, pages[0].page_height]).toEqual([200, 300]);
    const normalText = pages[0].text_items.map((i) => i.text).join("");
    expect(normalText, `page 1: ${normalText}`).toContain("NORMALMARK");

    // The /UserUnit 36 page reports its real dimensions...
    expect([pages[1].page_width, pages[1].page_height]).toEqual([40 * 36, 100 * 36]);
    // ...and its 0.3 pt-written text survives extraction at ~10.8 pt.
    const tinyItems = pages[1].text_items.filter((i) => i.text.includes("TINYMARK"));
    expect(tinyItems, `items: ${JSON.stringify(pages[1].text_items)}`).toHaveLength(1);
    const item = tinyItems[0];
    // expected ~10.8pt tall text
    expect(item.height).toBeGreaterThan(5);
    expect(item.height).toBeLessThan(20);
    // Baseline sanity: the text sits in the upper half of the page in top-left viewport
    // coordinates (written at y=50 of 100, scaled 36x).
    expect(Math.abs(item.y - (100 - 50.3) * 36), `unexpected y: ${item.y}`).toBeLessThan(36);
  });

  /**
   * Issue #504: a `TJ` row places `CODE1`, `SOME DESCRIPTION`, and `48.`, then `PROD1` is drawn
   * back inside the first gap. The short `48.` run must not swallow `PROD1`, or the description
   * is dropped as overpaint.
   */
  test("short_run_backward_jump_keeps_intervening_text", () => {
    const content =
      "BT /F1 8 Tf 1 0 0 1 10 700 Tm [(CODE1) -12500 (SOME DESCRIPTION) -27917 (48.)] TJ ET\n" +
      "BT /F1 8 Tf 1 0 0 1 70 700 Tm (PROD1) Tj ET";
    const items = extractBytes(type1PagePdf("Helvetica", content))[0].text_items;
    expect(items, JSON.stringify(items.map((it) => [it.text, it.x, it.width]))).toHaveLength(4);
    assertXNear(byText(items, "CODE1"), 10);
    assertXNear(byText(items, "PROD1"), 70);
    assertXNear(byText(items, "SOME DESCRIPTION"), 137.6);
    assertXNear(byText(items, "48."), 441.4);
  });

  /**
   * Issue #505: Times-Roman 7.7pt, "90000" drawn first on a baseline 5pt below the short "13",
   * which is itself left of "18 Jul, 2025". "90000" is just under 20pt wide, so the same
   * short-run backward jump used to merge it with "13" and the overlap then dropped both.
   */
  test("short_run_backward_jump_on_offset_baseline_keeps_each_string", () => {
    const content =
      "BT /F1 7.7 Tf 1 0 0 1 121.33 392.47 Tm (90000) Tj ET\n" +
      "BT /F1 7.7 Tf 1 0 0 1 36 397.48 Tm (13) Tj ET\n" +
      "BT /F1 7.7 Tf 1 0 0 1 58.68 397.48 Tm (18 Jul, 2025) Tj ET";
    const items = extractBytes(type1PagePdf("Times-Roman", content))[0].text_items;
    const got = items.map((it): [string, number] => [it.text, it.x]);
    // expected 90000, 13, and the date as separate items
    expect(got, JSON.stringify(got)).toHaveLength(3);
    assertXNear(byText(items, "90000"), 121.33);
    assertXNear(byText(items, "13"), 36);
    assertXNear(byText(items, "18 Jul, 2025"), 58.68);
  });

  /**
   * A same-line kern of a fraction of a glyph must stay one item. The adjustment is large enough
   * that the strict boxes overlap (negative gap) and small enough to be ordinary kerning, not a
   * column jump.
   */
  test("small_negative_kerning_stays_one_item", () => {
    // 250 thousandths of an em at 12pt is 3pt of pull-together: about half a glyph of Helvetica
    // 'A' (advance 8pt), well under three character widths.
    const content = "BT /F1 12 Tf 1 0 0 1 72 700 Tm [(A) 250 (VATAR)] TJ ET";
    const pdf = type1PagePdf("Helvetica", content);

    const document = lib.loadDocumentFromBytes(pdf, null);
    try {
      const page = document.page(0);
      try {
        const textPage = page.text();
        try {
          const a = textPage.charBox(0);
          const v = textPage.charBox(1);
          if (a === null || v === null) throw new Error("no char box");
          const gap = v.left - a.right;
          // kerning fixture gap should be a small negative overlap, not a column jump
          expect(gap, `gap ${gap}`).toBeLessThan(-0.5);
          expect(gap, `gap ${gap}`).toBeGreaterThan(-8);
        } finally {
          textPage.close();
        }
      } finally {
        page.close();
      }
    } finally {
      document.close();
    }

    const items = extractBytes(pdf)[0].text_items;
    expect(items.map((it) => it.text)).toEqual(["AVATAR"]);
  });

  /**
   * TeX-style output sets `1 Tf` and puts the real size in `Tm`, so the `Tf` operand is 1 and
   * glyph advances come back at 1pt scale. The backward-jump cutoff must still be measured in
   * page units, or ordinary kerning (and ligatures like "fi") would split words apart.
   */
  test("tm_scaled_kerning_stays_one_item", () => {
    const content = "BT /F1 1 Tf 12 0 0 12 72 700 Tm [(A) 250 (VATAR)] TJ ET";
    const items = extractBytes(type1PagePdf("Helvetica", content))[0].text_items;
    expect(items.map((it) => it.text)).toEqual(["AVATAR"]);
  });

  test("rotated_pages_use_viewport_dimensions_and_keep_edge_text", () => {
    const pages = extractBytes(rotatedTextPdf());
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect([page.page_width, page.page_height]).toEqual([300, 200]);
      const rawText = withoutWhitespace(page.text_items.map((item) => item.text).join(""));
      expect(rawText, `raw text: ${rawText}`).toContain("FIRSTMARK");
      expect(rawText, `raw text: ${rawText}`).toContain("SECONDMARK");
    }

    for (const page of projectPagesToGrid(pages)) {
      const text = withoutWhitespace(page.text_items.map((item) => item.text).join(""));
      expect(text, `extracted text: ${text}`).toContain("FIRSTMARK");
      expect(text, `extracted text: ${text}`).toContain("SECONDMARK");
      expect(page.text_items.every((item) => item.x + item.width <= page.page_width + 0.1)).toBe(
        true
      );
    }
  });
});

describe("extract page errors", () => {
  let document: Document;

  beforeAll(() => {
    // Three pages in the count, and every `page` call throws: page 3 is the broken page.
    document = lib.loadDocumentFromBytes(rotatedTextPdf(), null);
    document.pageCount = (): number => 3;
    document.page = (): never => {
      throw new Error("broken page");
    };
  });

  afterAll(() => {
    document.close();
  });

  test("page_error_is_fail_fast_by_default", () => {
    // The Rust also asserts that no page error was recorded; here the error leaves no result to hold one.
    expect(() => extractPagesAndImages(document, { ...request(), targetPages: [3] })).toThrow(
      "broken page"
    );
  });

  test("page_error_can_be_collected_and_skipped", () => {
    const result = extractPagesAndImages(document, { ...request(true), targetPages: [3] });
    expect(result.pages).toEqual([]);
    expect(result.page_errors).toEqual([{ page: 3, message: "broken page" }]);
  });
});
