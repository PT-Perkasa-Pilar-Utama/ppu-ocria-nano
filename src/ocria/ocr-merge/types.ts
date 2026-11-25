// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): PageOcrOutcome.

import type { Rect } from "../types/geometry.js";
import type { OcrResult } from "../ocr/types.js";

/**
 * One page's recognition outcome: what the engine returned for one raster,
 * plus the raster's page facts, so the merge is a pure function of
 * `(pages, outcomes)`. `error` is set when the engine failed on this page.
 */
export type PageOcrOutcome = {
  /** 1-based source page number the raster came from. */
  page_number: number;
  /** DPI the raster was rendered at; pixel to point scale is `72 / dpi`. */
  dpi: number;
  has_native_text: boolean;
  image_rects: Rect[];
  /** The page's native text is an invisible OCR layer the new OCR replaces. */
  replace_native: boolean;
  /** Engine output in raster pixel coordinates; serde omits it when empty. */
  results?: OcrResult[];
  /** The engine's error message when recognition failed on this page. */
  error?: string;
};

/** `PageOcrOutcome` from serde JSON, with `#[serde(default)]` fields filled as Rust's Deserialize does. */
export function pageOcrOutcomeFromJson(v: unknown): PageOcrOutcome {
  // SAFETY: v is serde JSON of PageOcrOutcome (the recorded merge.input).
  const o = v as PageOcrOutcome;
  return {
    ...o,
    replace_native: o.replace_native ?? false,
    results: (o.results ?? []).map((r) => ({
      ...r,
      words: r.words ?? [],
      faint: r.faint ?? false,
    })),
  };
}
