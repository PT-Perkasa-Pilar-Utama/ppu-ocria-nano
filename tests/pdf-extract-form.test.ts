// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Widget flattening of `extract_single_page` (and `restore_flattened_over_text`): the text a
// filled form field paints through its appearance stream is read, and page text under the widget
// is kept. LiteParse does this for every document that has an AcroForm, whatever the options.

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

const stream = (dict: string, content: string): string =>
  `<< ${dict} /Length ${content.length} >>\nstream\n${content}\nendstream`;

/** One text field whose value lives only in its appearance stream, beside a label (and optionally text under the widget). */
function formPdf(underWidget: boolean): Uint8Array {
  const content = [
    "BT /F1 12 Tf 72 696 Td (Name:) Tj ET",
    underWidget ? "BT /F1 12 Tf 160 696 Td (Printed) Tj ET" : "",
  ].join("\n");
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [5 0 R] >>",
    stream("", content),
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Alice Smith) /Rect [150 690 300 710] /F 4 /P 3 0 R /AP << /N 6 0 R >> >>",
    stream(
      "/Type /XObject /Subtype /Form /BBox [0 0 150 20] /Resources << /Font << /F1 7 0 R >> >>",
      "BT /F1 12 Tf 2 5 Td (Alice Smith) Tj ET"
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

let lib: Library;

beforeAll(async () => {
  lib = await Library.init();
});

type FormExtraction = { texts: string[]; flattened: number[] };

function extractForm(pdf: Uint8Array): FormExtraction {
  const document = lib.loadDocumentFromBytes(pdf, null);
  try {
    const out = extractPagesAndImages(document, {
      targetPages: null,
      maxPages: 10,
      extractLinks: false,
      glyphResolver: null,
      output: defaultExtractionOutputOptions(),
    });
    return {
      texts: out.pages[0].text_items.map((i) => i.text),
      flattened: out.flattened_page_numbers,
    };
  } finally {
    document.close();
  }
}

describe("form widgets", () => {
  test("a filled field's appearance text is read, and the page is reported flattened", () => {
    const { texts, flattened } = extractForm(formPdf(false));
    expect(texts).toContain("Name:");
    expect(texts.join(" ")).toContain("Alice Smith");
    expect(flattened).toEqual([1]);
  });

  test("page text under the widget survives flattening", () => {
    const { texts } = extractForm(formPdf(true));
    expect(texts).toContain("Printed");
    // Not asserted: the field value. When the two runs collide PDFium can keep the page text and
    // drop the appearance text, and LiteParse's restore step recovers only the other direction.
  });
});
