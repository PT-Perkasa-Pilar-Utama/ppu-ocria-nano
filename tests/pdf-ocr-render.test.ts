// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2) for the
// parts ported under src/pdf/ocr-render/: despeckle, fitting_dpi and uncovered_path_area.

import { describe, expect, test } from "bun:test";

import { textItem } from "../src/ocria/types/text-item.js";
import {
  UNCOVERED_VECTOR_AREA_THRESHOLD,
  uncoveredPathArea,
} from "../src/pdf/ocr-render/complexity.js";
import { despeckle } from "../src/pdf/ocr-render/despeckle.js";
import { fittingDpi } from "../src/pdf/ocr-render/render.js";
import type { ImageBounds } from "../src/pdf/pdfium/page-images.js";

/** A 1-inch square 300 dpi grey raster: white, with 2x2 px dots every 8 px. */
function dottedInch(): Uint8Array {
  return Uint8Array.from({ length: 300 * 300 }, (_, i) =>
    (i % 300) % 8 < 2 && Math.floor(i / 300) % 8 < 2 ? 0 : 255
  );
}

function paint(pixels: Uint8Array, x: number, y: number, w: number, h: number): void {
  for (let row = y; row < y + h; row++) pixels.fill(0, row * 300 + x, row * 300 + x + w);
}

describe("despeckle", () => {
  test("removes dots and keeps punctuation and rules", () => {
    const px = dottedInch();
    paint(px, 100, 100, 7, 7); // a 300 dpi period
    paint(px, 20, 200, 260, 2); // a hairline rule
    paint(px, 150, 51, 1, 4); // a thin 1x4 mark touching a dot: still a speck
    const removed = despeckle(px, 300, 300, 1, 300);
    expect(removed).toBeGreaterThan(1000);
    const dark = (x: number, y: number): boolean => px[y * 300 + x] === 0;
    expect(dark(103, 103)).toBe(true); // the period was kept
    expect(dark(150, 201)).toBe(true); // the rule was kept
    expect(!dark(0, 0) && !dark(8, 8)).toBe(true); // a dot was removed
  });

  test("leaves a clean page and low dpi alone", () => {
    // A few specks on a clean page are under the density gate.
    const clean = new Uint8Array(300 * 300 * 3).fill(255);
    for (let i = 0; i < 10; i++) {
      const o = (i * 20 * 300 + i * 20) * 3;
      clean.fill(0, o, o + 3);
    }
    const before = clean.slice();
    expect(despeckle(clean, 300, 300, 3, 300)).toBe(0);
    expect(clean).toEqual(before);
    // Below the minimum dpi nothing runs, however dotted.
    const low = dottedInch();
    const lowBefore = low.slice();
    expect(despeckle(low, 300, 300, 1, 150)).toBe(0);
    expect(low).toEqual(lowBefore);
  });
});

describe("fittingDpi", () => {
  const renderedPx = (pt: number, dpi: number): number =>
    Math.round(Math.fround(pt * Math.fround(dpi / 72)));

  test("a capped page renders to exactly the cap", () => {
    // Letter, A4, Legal, a landscape slide, a tall receipt and a poster over the cap at 72 dpi.
    const sizes: Array<[number, number]> = [
      [612, 792],
      [595.28, 841.89],
      [612, 1008],
      [960, 540],
      [226.77, 2834.65],
      [2592, 3456],
    ];
    for (const cap of [300, 1600, 2400, 4000]) {
      for (const [w, h] of sizes) {
        const dpi = fittingDpi(Math.fround(w), Math.fround(h), 300, cap);
        const longEdge = Math.max(renderedPx(Math.fround(w), dpi), renderedPx(Math.fround(h), dpi));
        if (dpi < 300) expect(longEdge).toBe(cap);
        else expect(longEdge).toBeLessThanOrEqual(cap);
      }
    }
  });

  test("a page under the cap keeps the configured dpi", () => {
    expect(fittingDpi(612, 792, 150, 2400)).toBe(150);
  });
});

describe("uncoveredPathArea", () => {
  const pb = (x: number, y: number, width: number, height: number): ImageBounds => ({
    x,
    y,
    width,
    height,
  });
  const item = (x: number, y: number, width: number, height: number) =>
    textItem({ text: "text", x, y, width, height });

  test("no text", () => {
    // A sentence-sized outlined region with no native text at all.
    const area = uncoveredPathArea([pb(50, 300, 200, 12)], []);
    expect(Math.abs(area - 2400)).toBeLessThan(1);
    expect(area).toBeGreaterThanOrEqual(UNCOVERED_VECTOR_AREA_THRESHOLD);
  });

  test("fully covered by text", () => {
    // Shading rect behind real text: fully covered, must not trigger.
    expect(uncoveredPathArea([pb(50, 300, 200, 12)], [item(40, 295, 250, 25)])).toBe(0);
  });

  test("partial coverage", () => {
    const area = uncoveredPathArea([pb(0, 0, 100, 10)], [item(0, 0, 50, 10)]);
    expect(Math.abs(area - 500)).toBeLessThan(1);
  });

  test("small decorations stay below the threshold", () => {
    // A few bullet-sized filled paths shouldn't reach the threshold.
    expect(uncoveredPathArea([pb(10, 10, 8, 8), pb(10, 30, 8, 8)], [])).toBeLessThan(
      UNCOVERED_VECTOR_AREA_THRESHOLD
    );
  });
});
