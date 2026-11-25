// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): clamped_vertical_bounds, counts_as_unmapped.

import { f32 } from "../../ocria/rust.js";
import type { RectF } from "../pdfium/types.js";

/**
 * Maximum loose-box height as a multiple of the INK height before the vertical extent is treated
 * as pathological: a single glyph in a font with very tall vertical metrics (Cambria Math makes a
 * 9pt hyphen 50pt tall) would stretch its whole line over adjacent lines. Scale-free: both boxes
 * live in the same space. Healthy ratios top out near 20x; the pathological case reads about 84x.
 */
export function clampedVerticalBounds(vpLoose: RectF, vpStrict: RectF): [number, number] {
  const looseH = Math.abs(f32(vpLoose.bottom - vpLoose.top));
  const strictH = Math.abs(f32(vpStrict.bottom - vpStrict.top));
  if (strictH > 0 && strictH < looseH && looseH > f32(40 * strictH))
    return [vpStrict.top, vpStrict.bottom];
  return [vpLoose.top, vpLoose.bottom];
}

/** `counts_as_unmapped`: whether a decoded glyph counts toward its item's unmapped-char tally. */
export function countsAsUnmapped(recovered: boolean, rawMapError: boolean): boolean {
  return !recovered && rawMapError;
}
