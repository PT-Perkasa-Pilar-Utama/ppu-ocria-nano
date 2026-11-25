// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// An image's page against LiteParse's: the extracted page of the PDF it wraps
// the image in, and the DPI it OCRs the image at.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imagePage, imageRaster, ocrImageDpi, readImageDpi } from "../../src/ocria/image-page.js";
import { PAGES_DIR, pagePixels, sha } from "./ocr-golden.js";
import { canon, loadParseGolden, pageFromJson, parseGoldenNames, stage } from "./parse-golden.js";

/** Width and height from a PNG's IHDR chunk. */
function pngSize(d: Uint8Array): [number, number] {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

const images = parseGoldenNames().filter((n) => loadParseGolden(n).image.endsWith(".png"));

describe.each(images)("%s", (name) => {
  const g = loadParseGolden(name);
  const bytes = new Uint8Array(readFileSync(join(PAGES_DIR, g.image)));
  const [w, h] = pngSize(bytes);
  const page = imagePage(w, h, readImageDpi(bytes));

  test("page size", () => {
    const want = (stage(g, "extract.pages") as unknown[]).map(pageFromJson)[0];
    expect(canon(page)).toEqual(canon(want));
  });

  test("LayoutNet raster", async () => {
    const want = stage(g, "table.raw") as { w: number; h: number; sha: string };
    const r = imageRaster(await pagePixels(g.image), page);
    expect({ w: r.w, h: r.h, sha: sha(r.buf) }).toEqual(want);
  });

  test("OCR dpi", () => {
    const input = stage(g, "merge.input") as { outcomes: Array<{ dpi: number }> };
    expect(ocrImageDpi(page, w, h)).toBe(Math.fround(input.outcomes[0].dpi));
  });
});

test("JFIF and pHYs densities", () => {
  // pHYs: 11811 px/m = 299.9994 dpi (f32), unit metre
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0x2e,
    0x23, 0, 0, 0x2e, 0x23, 1, 0, 0, 0, 0,
  ]);
  expect(readImageDpi(png)).toEqual([
    Math.fround(Math.fround(11811) * Math.fround(0.0254)),
    Math.fround(Math.fround(11811) * Math.fround(0.0254)),
  ]);
  // JFIF APP0, units 2 (dots per cm), 118 x 118
  const jpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 0, 118, 0, 118, 0, 0, 0xff,
    0xd9,
  ]);
  const cm = Math.fround(118 * Math.fround(2.54));
  expect(readImageDpi(jpg)).toEqual([cm, cm]);
  expect(readImageDpi(new Uint8Array([1, 2, 3]))).toEqual([150, 150]);
});
