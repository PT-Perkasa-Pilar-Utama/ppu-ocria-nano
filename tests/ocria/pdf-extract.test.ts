// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The extract stage against the `extract.pages` golden of each PDF fixture.
//
// The goldens come from a native macOS build of pdfium, which substitutes system fonts (Arial,
// Times New Roman, Courier New) for the standard-14 fonts a PDF names without embedding. With
// those fonts installed (tests/ocria/pdf-golden.ts reads them from macOS) every fixture matches
// exactly. Without them pdfium uses its built-in Foxit fonts, so ascent, descent, glyph advances
// and every box derived from them differ; the test then compares what does not depend on the
// substituted font. docs/port-progress/pdf.md has the measured differences.

import { describe, expect, test } from "bun:test";

import type { Page } from "../../src/ocria/types/page.js";
import { canon, loadParseGolden, pageFromJson, stage } from "./parse-golden.js";
import { HAS_NATIVE_FONTS, PDF_GOLDENS, extractGoldenPages, openPdf } from "./pdf-golden.js";

/** Fixtures that reference non-embedded standard-14 fonts. */
const SUBSTITUTED_FONTS = new Set([
  "borderless",
  "digital",
  "legacy-font",
  "multipage",
  "rotate-90",
  "sideways",
  "structured",
]);
/** Text items split differently under the substituted font's advances. */
const SPLIT_BY_ADVANCES = new Set(["rotate-90"]);
/** Item fields that follow from the substituted font's metrics. */
const FONT_METRIC_FIELDS = [
  "font_ascent",
  "font_descent",
  "x",
  "y",
  "width",
  "height",
  "words",
  "text_width",
  "followed_by_space",
] as const;

function withoutFontMetrics(pages: Page[]): unknown {
  return canon(
    pages.map((p) => ({
      ...p,
      text_items: p.text_items.map((item) => {
        const copy = { ...item };
        for (const f of FONT_METRIC_FIELDS) delete copy[f];
        return copy;
      }),
    }))
  );
}

/** The page text with item boundaries removed, for fixtures whose items split differently. */
function flatText(pages: Page[]): unknown {
  return pages.map((p) => ({
    page_number: p.page_number,
    page_width: p.page_width,
    page_height: p.page_height,
    text: p.text_items.map((i) => i.text).join(""),
  }));
}

function checkMode(name: string): string {
  if (HAS_NATIVE_FONTS) return "exact";
  if (SPLIT_BY_ADVANCES.has(name)) return "page text";
  return SUBSTITUTED_FONTS.has(name) ? "without font metrics" : "exact";
}

describe("extract.pages", () => {
  for (const name of PDF_GOLDENS) {
    const mode = checkMode(name);
    test(`${name} (${mode})`, async () => {
      const want = (stage(loadParseGolden(name), "extract.pages") as unknown[]).map(pageFromJson);
      const document = await openPdf(name);
      try {
        const got = extractGoldenPages(document);
        if (HAS_NATIVE_FONTS) expect(canon(got)).toEqual(canon(want));
        else if (SPLIT_BY_ADVANCES.has(name)) expect(flatText(got)).toEqual(flatText(want));
        else if (SUBSTITUTED_FONTS.has(name))
          expect(withoutFontMetrics(got)).toEqual(withoutFontMetrics(want));
        else expect(canon(got)).toEqual(canon(want));
      } finally {
        document.close();
      }
    });
  }
});
