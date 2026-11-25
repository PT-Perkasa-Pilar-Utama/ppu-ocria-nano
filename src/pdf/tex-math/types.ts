// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Data shapes of the math pass: what PDFium reported per glyph, the glyph the pass works on, and
// the span it emits. Field names stay snake_case so the extract glue mirrors the Rust.

import { f32 } from "../../ocria/rust.js";
import type { Enc } from "./encodings.js";

/** What PDFium reported for one glyph's text. */
export type RawText =
  /** A clean Unicode mapping (one code point). */
  | { Unicode: string }
  /** No Unicode for the glyph (PDFium's map error): the raw char code. */
  | { Code: number };

/** One page glyph, as collected by `extract`. Coordinates are viewport space (y down); `origin_y` is the baseline. */
export type RawChar = {
  index: number;
  text: RawText;
  /** Font base name as in the PDF (subset prefix included). */
  font_name: string;
  /** Effective size (font size x text-matrix scale). */
  size: number;
  /** Font descent at `size` (negative, points). */
  descent: number;
  origin_y: number;
  x0: number;
  x1: number;
  /** Tight glyph box (top, bottom), viewport y. */
  ink: [top: number, bottom: number] | null;
  /** Font box (top, bottom), viewport y: the box text items use. */
  loose: [top: number, bottom: number];
};

/** One math span found on a page. */
export type MathSpan = {
  tex: string;
  /** Viewport-space box over every glyph in the span. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Size of the span's base glyphs. */
  size: number;
  /** Char indices the span consumed. */
  chars: number[];
};

const MARKS: readonly string[] = [
  "\\frac",
  "\\sqrt",
  "\\overline",
  "\\mathbb",
  "\\mathcal",
  "\\mathfrak",
  "\\mathscr",
  "\\hat",
  "\\tilde",
  "\\bar",
  "\\dot",
  "\\ddot",
  "\\acute",
  "\\grave",
  "\\check",
  "\\breve",
  "\\vec",
  "\\widehat",
  "\\widetilde",
];

/**
 * Whether the span carries structure plain text can't show: scripts, fractions, roots, accents,
 * or a math alphabet. Note: a lone ± or μ (or plain Greek) stays text, so table cells like
 * "0.11 ± 0.02" keep their form.
 */
export function hasStructure(span: MathSpan): boolean {
  return (
    span.tex.includes("_") || span.tex.includes("^") || MARKS.some((m) => span.tex.includes(m))
  );
}

export type Role = "Mi" | "Sy" | "Bb" | "Ex" | "Frak" | "Scr" | "Cal";

/**
 * One glyph in the math pass. `top` / `bottom` are viewport y (down), `base` is the baseline in
 * y-up page space (`page height - y`), as in the prototype.
 */
export type G = {
  t: string;
  role: Role | null;
  fam: string;
  size: number;
  base: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Font box (top, bottom), viewport y, for the span's item box. */
  loose: [top: number, bottom: number];
  /** Accent commands opened before this glyph, and closed after it. */
  pre: string;
  post: string;
  /** Source char indices (several for a folded structure). */
  src: number[];
};

/** `G::cx`: the horizontal centre. */
export function gCx(g: G): number {
  return f32(f32(g.x0 + g.x1) / 2);
}

export type FontInfo = [role: Role | null, enc: Enc | null];
