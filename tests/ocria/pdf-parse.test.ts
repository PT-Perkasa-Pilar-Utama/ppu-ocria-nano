// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The whole PDF path in TypeScript, PDF bytes to markdown, against LiteParse's parse of the same
// PDF (tests/fixtures/golden/parse, run with a native macOS pdfium at 150 dpi). Each test compares
// one checkpoint of the run with the golden's.
//
// With the macOS system fonts the goldens were made with installed (tests/ocria/pdf-golden.ts
// reads them), every fixture matches at every checkpoint. Without them pdfium substitutes its
// built-in fonts for the standard-14 fonts the fixtures use, boxes differ by a fraction of a
// point, and the tests compare what the substituted font does not change. Three fixtures
// (rtl-text, scanned, vertical-text) use no such font and match either way.

import { describe, expect, test } from "bun:test";

import { pageInputRaster } from "../../src/ocria/table-model/page-input.js";
import type { PageInput } from "../../src/ocria/table-model/page-input.js";
import { mainRotation, uprightInput } from "../../src/ocria/table-model/rotate.js";
import { canon, loadParseGolden, stage } from "./parse-golden.js";
import { EXACT_OCR, sha } from "./ocr-golden.js";
import { HAS_NATIVE_FONTS, PDF_GOLDENS, runPdf } from "./pdf-golden.js";

/** Fixtures that use no standard-14 font, so the host's system fonts do not matter. */
const NO_STANDARD_FONTS = new Set(["rtl-text", "scanned", "vertical-text"]);

const exact = (name: string): boolean => HAS_NATIVE_FONTS || NO_STANDARD_FONTS.has(name);

/** Fixtures whose text comes from OCR; exact only on the recording platform (EXACT_OCR). */
const OCR_TEXT = new Set(["scanned"]);
const ocrExact = (name: string): boolean => EXACT_OCR || !OCR_TEXT.has(name);

type TableInputs = Array<[number, PageInput]>;

/** The inputs without the page render, which the golden does not serialize. */
function withoutRaw(inputs: unknown): unknown {
  return canon((inputs as TableInputs).map(([n, i]) => [n, { ...i, raw: undefined }]));
}

/** What the substituted font does not change: page sizes, the OCR flag, and the characters of the units (their order follows their boxes). */
function unitSkeleton(inputs: unknown): unknown {
  return (inputs as TableInputs).map(([n, i]) => ({
    page: n,
    wh: i.wh,
    ocr: i.ocr,
    text: Array.from(i.units.map((u) => u.text).join(""))
      .sort()
      .join(""),
  }));
}

describe.each([...PDF_GOLDENS])("%s", (name) => {
  const g = loadParseGolden(name);

  test("table.inputs", async () => {
    const run = await runPdf(name);
    const got = run.checkpoints.get("table.inputs");
    const want = stage(g, "table.inputs");
    if (exact(name)) expect(withoutRaw(got)).toEqual(canon(want));
    else expect(canon(unitSkeleton(got))).toEqual(canon(unitSkeleton(want)));
  });

  test.if(ocrExact(name))(
    "merge.input outcomes: OCR render dpi, flags and recognized lines",
    async () => {
      const run = await runPdf(name);
      const got = run.checkpoints.get("merge.input") as { outcomes: unknown };
      const want = stage(g, "merge.input") as { outcomes: unknown };
      expect(canon(got.outcomes)).toEqual(canon(want.outcomes));
    }
  );

  test("table.raster: the 150 dpi render gives the ruling lines and image input", async () => {
    const run = await runPdf(name);
    const input = (run.checkpoints.get("table.inputs.final") as TableInputs)[0][1];
    const [flat, flatImg] = pageInputRaster(input);
    // the recorded raster of a page whose text runs sideways is already upright
    const q = mainRotation(input);
    const { rules, img } =
      q === null ? { rules: flat, img: flatImg } : uprightInput(input, flat, flatImg, q);
    const want = stage(g, "table.raster") as {
      rules: unknown;
      img: { w: number; h: number; px: string; k: number } | null;
    };
    expect(canon(rules)).toEqual(canon(want.rules));
    if (img === null || want.img === null) throw new Error("the raster has no image");
    // Without the host fonts a page with text renders its glyphs differently; a scan is one image.
    const px = HAS_NATIVE_FONTS || name === "scanned" ? sha(img.px) : want.img.px;
    expect({ w: img.w, h: img.h, k: img.k, px }).toEqual(want.img);
  });

  test.if(ocrExact(name))("markdown", async () => {
    const run = await runPdf(name);
    expect(run.markdown).toBe(g.text);
  });

  test.if(ocrExact(name))("pages", async () => {
    const run = await runPdf(name);
    // probabilities from LayoutNet's class head differ from the reference in the last f32 bit
    const strip = (pages: unknown[]): unknown =>
      canon(pages.map((p) => ({ ...(p as object), model_classes: [] })));
    if (exact(name)) {
      expect(strip(run.pages)).toEqual(strip(g.pages));
    } else {
      const skeleton = (pages: unknown[]): unknown =>
        pages.map((p) => {
          const { page_number, markdown } = p as { page_number: number; markdown: string };
          return { page_number, markdown };
        });
      expect(skeleton(run.pages)).toEqual(skeleton(g.pages));
    }
  });
});
