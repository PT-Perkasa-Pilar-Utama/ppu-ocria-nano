// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The fonts option: pdfium substitutes the fonts the caller installs for the standard-14 fonts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extract, open } from "../src/pdf/stages/index.js";
import { defaultExtractionOutputOptions } from "../src/pdf/extract/options.js";
import { Library } from "../src/pdf/pdfium/library.js";
import type { SystemFont } from "../src/pdf/pdfium/system-fonts.js";
import { HAS_NATIVE_FONTS, pdfBytes } from "./ocria/pdf-golden.js";

const FONT_DIR = process.env.PDF_TEST_FONT_DIR ?? "/System/Library/Fonts/Supplemental";

/** The ascent of the first text item of digital.pdf (Helvetica 10 pt) under `fonts`. */
async function helveticaAscent(fonts: readonly SystemFont[]): Promise<number | null> {
  const lib = await Library.init({ fonts });
  const document = open(lib, pdfBytes("digital"), null, []);
  try {
    const request = {
      targetPages: null,
      maxPages: 1,
      extractLinks: false,
      glyphResolver: null,
      output: defaultExtractionOutputOptions(),
    };
    return extract(document, request).pages[0].text_items[0].font_ascent ?? null;
  } finally {
    document.close();
  }
}

describe("fonts option", () => {
  test("no fonts is the built-in substitution", async () => {
    // the Foxit built-in sans, 1.0 em ascent scaled: 8.505 at 9 pt
    expect(await helveticaAscent([])).toBeCloseTo(8.505, 3);
  });

  test.skipIf(!HAS_NATIVE_FONTS)(
    "Arial installed for Helvetica sets the ascent from Arial",
    async () => {
      const arial = {
        name: "Arial",
        data: new Uint8Array(readFileSync(join(FONT_DIR, "Arial.ttf"))),
      };
      const builtin = await helveticaAscent([]);
      const withArial = await helveticaAscent([arial]);
      expect(withArial).not.toBe(builtin);
      // 1854 / 2048 em, the golden's 8.145 at 9 pt
      expect(withArial).toBeCloseTo(8.145, 3);
    }
  );

  test("a name pdfium never asks for changes nothing", async () => {
    const unrelated = {
      name: "No Such Face",
      data: new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
    expect(await helveticaAscent([unrelated])).toBe(await helveticaAscent([]));
  });
});
