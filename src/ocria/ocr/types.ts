// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the OcrResult types in liteparse crates/liteparse/src/ocr/mod.rs (crates-v2.21.2, Apache-2.0).

import type { Quad } from "./img.js";

/** One word an OCR engine measured inside a line-level result. */
export type OcrWord = {
  text: string;
  /** Axis-aligned box in pixel coordinates: [x1, y1, x2, y2]. */
  bbox: [number, number, number, number];
};

/** One OCR detection, a line, with its box and confidence. */
export type OcrResult = {
  text: string;
  /** Bounding box in pixel coordinates: [x1, y1, x2, y2] (left, top, right, bottom). */
  bbox: [number, number, number, number];
  /** Confidence in 0..1 (f32). */
  confidence: number;
  /**
   * The (possibly rotated) detection, ordered top-left, top-right,
   * bottom-right, bottom-left in the glyphs' upright reading frame.
   */
  polygon?: Quad;
  /** Measured word boxes in reading order; ocria-nano measures none. */
  words: OcrWord[];
  /** The line's rotation in degrees counter-clockwise in [0, 360), when the engine measured it. */
  rotation?: number;
  /**
   * A short token read from a region the detector scored under its threshold
   * (the faint pass). The table model reads it as an opaque token.
   */
  faint: boolean;
};
