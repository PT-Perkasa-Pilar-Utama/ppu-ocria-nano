// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The extract glue of the math pass (`page_math_spans`, `math_item`, src/pdf/extract/math-spans.ts)
// on an in-memory page set in TeX fonts. The pass itself is tested in pdf-tex-math.test.ts.
// No golden PDF carries a TeX math font, so this checks the glue's behavior, not LiteParse's output.

import { beforeAll, describe, expect, test } from "bun:test";

import { defaultExtractionOutputOptions } from "../src/pdf/extract/options.js";
import { extractPagesAndImages } from "../src/pdf/extract/pages.js";
import { Library } from "../src/pdf/pdfium/library.js";

function buildPdf(objects: readonly string[]): Uint8Array {
  let pdf = "%PDF-1.4\n";
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

/** One page: "x" in CMMI10 at 10 pt with a superscript "2" in CMR7 at 7 pt, then plain text in Helvetica. */
function mathPdf(withTexFonts: boolean): Uint8Array {
  const italic = withTexFonts ? "CMMI10" : "Helvetica-Oblique";
  const roman = withTexFonts ? "CMR7" : "Helvetica";
  const content = [
    "BT /F1 10 Tf 72 700 Td (x) Tj ET",
    "BT /F2 7 Tf 79 705 Td (2) Tj ET",
    "BT /F3 10 Tf 72 650 Td (plain text) Tj ET",
  ].join("\n");
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
    `<< /Type /Font /Subtype /Type1 /BaseFont /${italic} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${roman} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

let lib: Library;

beforeAll(async () => {
  lib = await Library.init();
});

function itemsOf(pdf: Uint8Array): Array<{ text: string; math: boolean }> {
  const document = lib.loadDocumentFromBytes(pdf, null);
  try {
    const request = {
      targetPages: null,
      maxPages: 1,
      extractLinks: false,
      glyphResolver: null,
      output: defaultExtractionOutputOptions(),
    };
    return extractPagesAndImages(document, request).pages[0].text_items.map((i) => ({
      text: i.text,
      math: i.math,
    }));
  } finally {
    document.close();
  }
}

describe("math items", () => {
  test("a page without TeX fonts has no math item", () => {
    expect(itemsOf(mathPdf(false)).some((i) => i.math)).toBe(false);
  });

  test("a TeX page splices a LaTeX item in for the glyphs of the superscript and keeps other text", () => {
    const items = itemsOf(mathPdf(true));
    expect(items.some((i) => i.math && i.text.startsWith("$") && i.text.endsWith("$"))).toBe(true);
    expect(items.some((i) => !i.math && i.text === "plain text")).toBe(true);
    // the glyphs the math item consumed are not read again as text
    expect(items.some((i) => !i.math && i.text === "2")).toBe(false);
  });
});
