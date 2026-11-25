// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the word-box, rotation and figure tests in liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0).

import { describe, expect, test } from "bun:test";

import type { Quad } from "../../src/ocria/ocr/img.js";
import type { OcrResult, OcrWord } from "../../src/ocria/ocr/types.js";
import { mergeOcrResults } from "../../src/ocria/ocr-merge/index.js";
import type { PageOcrOutcome } from "../../src/ocria/ocr-merge/index.js";
import type { Page } from "../../src/ocria/types/page.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { makeBlankPage, ocrResult } from "./ocr-merge-builders.test.js";

type Box = [number, number, number, number];

const ocrWord = (text: string, bbox: Box): OcrWord => ({ text, bbox });

function outcomeOf(
  results: OcrResult[],
  dpi: number,
  hasNativeText = false,
  imageRects: PageOcrOutcome["image_rects"] = []
): PageOcrOutcome {
  return {
    page_number: 1,
    dpi,
    has_native_text: hasNativeText,
    image_rects: imageRects,
    replace_native: false,
    results,
  };
}

/** One page of OCR results merged with word boxes on, at `dpi`. */
function mergeOcrPage(results: OcrResult[], dpi: number): Page {
  const pages = [makeBlankPage(1)];
  mergeOcrResults(pages, [outcomeOf(results, dpi)], false, true);
  return pages[0];
}

function wordRects(item: TextItem): Array<[string, number, number, number, number]> {
  return item.words.map((w) => [w.text, w.x, w.y, w.width, w.height]);
}

/**
 * An OCR-sourced item must carry a word box the way a native one does: the item's own
 * text and box are the word box. Without it the projection has nothing to carry forward
 * when it joins neighbouring OCR items into a run (#473).
 */
describe("word boxes", () => {
  test("OCR items carry word boxes when enabled", () => {
    const outcome = (): PageOcrOutcome =>
      outcomeOf([ocrResult("hello", [10, 20, 60, 30]), ocrResult("world", [62, 20, 110, 30])], 72);
    const enabled = [makeBlankPage(1)];
    mergeOcrResults(enabled, [outcome()], false, true);
    expect(enabled[0].text_items).toHaveLength(2);
    for (const item of enabled[0].text_items) {
      expect(item.words, item.text).toHaveLength(1);
      const word = item.words[0];
      expect(word.text).toBe(item.text);
      expect([word.x, word.y, word.width, word.height]).toEqual([
        item.x,
        item.y,
        item.width,
        item.height,
      ]);
    }
    // The same input with word boxes off must stay allocation-free.
    const disabled = [makeBlankPage(1)];
    mergeOcrResults(disabled, [outcome()], false, false);
    expect(disabled[0].text_items).toHaveLength(2);
    expect(disabled[0].text_items.every((i) => i.words.length === 0)).toBe(true);
  });

  // Measured words become the word boxes when they pair one per word of the cleaned text.
  // Any other count keeps one box for the line: no words, fewer words, one fallback word
  // for the whole line, or a measured `|` border that table-artifact cleaning dropped.
  test("measured OCR word boxes pair one per word", () => {
    const line = (text: string, words: OcrWord[]): OcrResult => ({
      text,
      bbox: [10, 20, 200, 30],
      confidence: 0.9,
      words,
      faint: false,
    });
    const measured = [
      ocrWord("Invoice", [11, 21, 60, 29]),
      ocrWord("total", [70, 21, 100, 29]),
      ocrWord("42.50", [160, 22, 199, 29]),
    ];
    // 144 dpi pixels are half a point each.
    const merged = (result: OcrResult): Array<[string, number, number, number, number]> =>
      wordRects(mergeOcrPage([result], 144).text_items[0]);
    expect(merged(line("Invoice total 42.50", measured))).toEqual([
      ["Invoice", 5.5, 10.5, 24.5, 4],
      ["total", 35, 10.5, 15, 4],
      ["42.50", 80, 11, 19.5, 3.5],
    ]);
    const wholeLine = ocrWord("Invoice total 42.50", [10, 20, 200, 30]);
    for (const words of [[], measured.slice(0, 2), [wholeLine]]) {
      expect(merged(line("Invoice total 42.50", words))).toEqual([
        ["Invoice total 42.50", 5, 10, 95, 5],
      ]);
    }
    const bordered = [
      ocrWord("|", [10, 20, 14, 30]),
      ocrWord("1", [40, 20, 50, 30]),
      ocrWord("9999999", [120, 20, 200, 30]),
    ];
    expect(merged(line("| 1 9999999", bordered))).toEqual([["1 9999999", 5, 10, 95, 5]]);
  });
});

describe("rotation", () => {
  // A scan fed sideways is turned upright as a whole page; each measured word box turns
  // with its line and keeps its own place along it.
  test("an uprighted scan turns each measured word box", () => {
    const line: OcrResult = {
      text: "Invoice total amount",
      bbox: [10, 5, 20, 95],
      confidence: 0.9,
      // Reads bottom to top: 90 degrees counter-clockwise.
      polygon: [
        [10, 95],
        [10, 5],
        [20, 5],
        [20, 95],
      ],
      words: [
        ocrWord("Invoice", [10, 60, 20, 95]),
        ocrWord("total", [10, 35, 20, 55]),
        ocrWord("amount", [10, 5, 20, 30]),
      ],
      faint: false,
    };
    const item = mergeOcrPage([line], 72).text_items[0];
    expect([item.rotation, item.x, item.y, item.width, item.height]).toEqual([0, 5, 10, 90, 10]);
    expect(wordRects(item)).toEqual([
      ["Invoice", 5, 10, 35, 10],
      ["total", 45, 10, 20, 10],
      ["amount", 70, 10, 25, 10],
    ]);
  });

  // The engine's angle decides a line's rotation over its quad's point order, including
  // the 90/270 choice on a vertical line. A line read at 180 degrees keeps its quad's
  // bounds and its words in reading order, right to left on screen.
  test("the engine rotation overrides the polygon order", () => {
    const merged = (polygon: Quad, words: OcrWord[], rotation: number | undefined): TextItem => {
      const xs = polygon.map((p) => p[0]);
      const ys = polygon.map((p) => p[1]);
      const line: OcrResult = {
        text: "Invoice total",
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        confidence: 0.9,
        polygon,
        words,
        faint: false,
        ...(rotation === undefined ? {} : { rotation }),
      };
      return mergeOcrPage([line], 144).text_items[0];
    };
    // Alone, each quad's point order reads as the angle in its name.
    const flat0: Quad = [
      [10, 20],
      [210, 20],
      [210, 40],
      [10, 40],
    ];
    const up90: Quad = [
      [10, 200],
      [10, 20],
      [20, 20],
      [20, 200],
    ];
    const down270: Quad = [
      [20, 20],
      [20, 200],
      [10, 200],
      [10, 20],
    ];

    const readTurned = [
      ocrWord("Invoice", [110, 20, 210, 40]),
      ocrWord("total", [10, 20, 100, 40]),
    ];
    const turned = merged(flat0, readTurned, 180);
    expect(turned.rotation).toBe(180);
    expect([turned.x, turned.y, turned.width, turned.height]).toEqual([5, 10, 100, 10]);
    expect(wordRects(turned).map(([t, x, , w]) => [t, x, w])).toEqual([
      ["Invoice", 55, 50],
      ["total", 5, 45],
    ]);

    expect(merged(up90, [], 270).rotation).toBe(270);
    expect(merged(down270, [], 90).rotation).toBe(90);
    expect(merged(up90, [], undefined).rotation).toBe(90);
  });
});

// A scanned figure on a page with a typed footer keeps all its OCR text, even when most
// recognised words are short ("et", "de", "la") or noise (#538).
test("figure OCR with short words is kept", () => {
  const page = makeBlankPage(1);
  page.text_items.push(
    textItem({ text: "Guide de Performance", x: 10, y: 92, width: 60, height: 4 })
  );
  const word = (text: string, x: number, y: number): OcrResult =>
    ocrResult(text, [x, y, x + 8, y + 4]);
  const results = [
    word("Logement", 10, 10),
    word("et", 20, 10),
    word("de", 30, 10),
    word("la", 40, 10),
    word("ES", 10, 20),
    word("à", 20, 20),
    word("Abordable", 30, 20),
  ];
  const outcome = outcomeOf(results, 72, true, [{ x: 5, y: 5, width: 80, height: 60 }]);
  const pages = [page];
  mergeOcrResults(pages, [outcome], false, false);
  const texts = pages[0].text_items.map((i) => i.text);
  for (const w of ["Logement", "et", "de", "la", "ES", "à", "Abordable"]) {
    expect(texts, `figure word ${w} was dropped`).toContain(w);
  }
});

// Not in the Rust tests: no recorded golden has a deskew, so this checks the
// rotate-about arithmetic against the geometry it implements.
describe("deskew", () => {
  const TILT = 3;
  const rad = (TILT * Math.PI) / 180;
  /** A line `len` long and 20 high, its left edge at (x0, y0) in a page tilted by TILT degrees about (cx, cy). */
  const tilted = (
    text: string,
    x0: number,
    y0: number,
    len: number,
    cx: number,
    cy: number
  ): OcrResult => {
    const rot = ([x, y]: [number, number]): [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      return [
        cx + dx * Math.cos(rad) - dy * Math.sin(rad),
        cy + dx * Math.sin(rad) + dy * Math.cos(rad),
      ];
    };
    const poly: Quad = [
      rot([x0, y0]),
      rot([x0 + len, y0]),
      rot([x0 + len, y0 + 20]),
      rot([x0, y0 + 20]),
    ];
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return {
      text,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      confidence: 0.9,
      polygon: poly,
      words: [],
      faint: false,
    };
  };

  test("a page of tilted lines is rotated upright and records the tilt", () => {
    const page = makeBlankPage(1);
    page.page_width = 400;
    page.page_height = 400;
    const lines = [0, 1, 2, 3].map((i) =>
      tilted(`line ${i} of text`, 50, 60 + i * 60, 300, 200, 200)
    );
    mergeOcrResults([page], [outcomeOf(lines, 72)], false, true);
    expect(page.ocr_deskew).toBeCloseTo(TILT, 2);
    expect(page.text_items).toHaveLength(4);
    page.text_items.forEach((it, i) => {
      expect(it.x).toBeCloseTo(50, 1);
      expect(it.y).toBeCloseTo(60 + i * 60, 1);
      expect(it.width).toBeCloseTo(300, 1);
      expect(it.height).toBeCloseTo(20, 1);
      // the polygon's own side is the line height, not the taller tilted box
      expect(it.font_size).toBeCloseTo(20, 1);
    });
  });

  test("fewer than three long lines record no tilt", () => {
    const page = makeBlankPage(1);
    page.page_width = 400;
    page.page_height = 400;
    const lines = [0, 1].map((i) => tilted(`line ${i}`, 50, 60 + i * 60, 300, 200, 200));
    mergeOcrResults([page], [outcomeOf(lines, 72)], false, true);
    expect(page.ocr_deskew ?? null).toBeNull();
  });
});
