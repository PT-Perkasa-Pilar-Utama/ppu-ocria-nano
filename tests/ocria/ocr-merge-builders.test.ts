// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the test helpers in liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0).

// Shared builders for the ocr-merge unit tests. The file name matches the
// ocr-merge test glob, so the folder's tests find it; it holds no tests.

import type { OcrResult } from "../../src/ocria/ocr/types.js";
import type { PageOcrOutcome } from "../../src/ocria/ocr-merge/index.js";
import type { Page } from "../../src/ocria/types/page.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { textItem } from "../../src/ocria/types/text-item.js";

export function makeItem(x: number, y: number, w: number, h: number): TextItem {
  return textItem({ text: "x", x, y, width: w, height: h });
}

export function makeBlankPage(pageNumber: number): Page {
  return {
    page_number: pageNumber,
    page_width: 100,
    page_height: 100,
    text_items: [],
    graphics: [],
    struct_nodes: [],
    image_refs: [],
  };
}

/** A page whose items carry per-item `(font_name, text)` pairs; every item shares one bbox. */
export function makeFontPage(items: ReadonlyArray<readonly [string, string]>): Page {
  const page = makeBlankPage(1);
  page.text_items = items.map(([font, text]) =>
    textItem({ text, font_name: font, width: 10, height: 10 })
  );
  return page;
}

/** A page that already has substantial native text coverage. */
export function makeNativeTextPage(pageNumber: number): Page {
  const page = makeBlankPage(pageNumber);
  page.text_items = [
    textItem({
      text: "this page already has real native text content",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    }),
  ];
  return page;
}

/** A page with over 20 bytes of native text but very low page coverage. */
export function makeLowCoveragePage(pageNumber: number): Page {
  const page = makeBlankPage(pageNumber);
  page.text_items = [
    textItem({
      text: "small native header that is not enough",
      x: 0,
      y: 0,
      width: 10,
      height: 5,
    }),
  ];
  return page;
}

export function ocrResult(text: string, bbox: [number, number, number, number]): OcrResult {
  return { text, bbox, confidence: 0.9, words: [], faint: false };
}

/** An outcome with one result per page (or the error), at 144 dpi. */
export function mergeOutcome(pageNumber: number, error?: string): PageOcrOutcome {
  return {
    page_number: pageNumber,
    dpi: 144,
    has_native_text: false,
    image_rects: [],
    replace_native: false,
    results: error === undefined ? [ocrResult(`page ${pageNumber}`, [10, 120, 60, 140])] : [],
    ...(error === undefined ? {} : { error }),
  };
}

/** The outcome the task pool yields for an engine that fails: no results, the error, dpi 72. */
export function failedOutcome(pageNumber: number, error: string): PageOcrOutcome {
  return {
    page_number: pageNumber,
    dpi: 72,
    has_native_text: false,
    image_rects: [],
    replace_native: false,
    results: [],
    error,
  };
}
