// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/structures.rs (crates-v2.21.2, Apache-2.0).

// A thin horizontal rule (fraction bar, overline, radical top) and the family name of the stand-in
// glyph a folded structure becomes.

import { f32 } from "../../ocria/rust.js";

/** A thin horizontal rule. `y` is y-up page space (`page height - y`). */
export type Rule = {
  x0: number;
  x1: number;
  y: number;
  w: number;
};

/** `Rule::from_box`: a rule from a viewport-space box (y down), when the box is thin and wide enough to be one. */
export function ruleFromBox(
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  pageH: number
): Rule | null {
  if (!(f32(bottom - top) <= f32(1.2) && f32(x1 - x0) >= f32(1.5))) return null;
  return { x0, x1, y: f32(pageH - f32(f32(top + bottom) / 2)), w: f32(x1 - x0) };
}

/** Family of a folded structure's stand-in glyph. */
export const STAND_IN_FAM = "SYN";
