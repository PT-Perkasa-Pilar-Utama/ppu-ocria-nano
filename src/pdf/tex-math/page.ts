// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Math spans of one page: the TeX-page gate, the span pipeline, and which spans get emitted.

import { f32 } from "../../ocria/rust.js";
import { attachAccents } from "./accents.js";
import { build } from "./build.js";
import { gEnc } from "./fonts.js";
import { glyphs } from "./glyphs.js";
import { foldMax, foldMin, maxSize, median } from "./helpers.js";
import { lines } from "./lines.js";
import type { Rule } from "./rule.js";
import { spansInLine } from "./spans.js";
import { STAND_IN_FAM } from "./rule.js";
import { fold } from "./structures.js";
import { hasStructure } from "./types.js";
import type { G, MathSpan, RawChar } from "./types.js";

/**
 * The item box for a span on baseline `base`: the font box of the real glyphs on that baseline
 * (the span's own, else its line's), so the item sits in its line like text does.
 *
 * Note: neither scripts' ink nor a fraction's stacked parts may set it: an item that rises above
 * its line drops out of the line's band in layout, and the text after it then reads as a new
 * column start (a two-column page turned "tabular").
 */
export function lineBox(
  all: readonly G[],
  ln: readonly number[],
  kept: readonly number[],
  base: number,
  size: number,
  pageH: number
): [top: number, bottom: number] {
  const real = (x: number): boolean => {
    const g = all[x];
    return (
      g.fam !== STAND_IN_FAM &&
      Math.abs(f32(g.base - base)) <= f32(f32(0.1) * size) &&
      g.size >= f32(f32(0.8) * size)
    );
  };
  let boxes = kept.filter(real).map((x) => all[x].loose);
  if (boxes.length === 0) boxes = ln.filter(real).map((x) => all[x].loose);
  if (boxes.length === 0) {
    // Typical font box: 0.78 em above the baseline, 0.22 em below.
    const y = f32(pageH - base);
    return [f32(y - f32(f32(0.78) * size)), f32(y + f32(f32(0.22) * size))];
  }
  return [foldMin(boxes.map((b) => b[0])), foldMax(boxes.map((b) => b[1]))];
}

/** Whether any glyph's font makes the page a TeX page. */
function isTexPage(all: readonly G[]): boolean {
  return all.some(
    (g) =>
      gEnc(g) !== null ||
      g.role === "Bb" ||
      g.role === "Frak" ||
      g.role === "Cal" ||
      g.role === "Scr"
  );
}

/** Math spans of one page, or null when the page isn't set in TeX. */
export function pageMath(
  chars: readonly RawChar[],
  rules: readonly Rule[],
  pageH: number
): MathSpan[] | null {
  const all = glyphs(chars, pageH);
  // Note: only pages set by TeX (a math font in a TeX encoding, or an AMS / Euler / rsfs font) get
  // math: Word's Symbol font and table rules elsewhere would otherwise read as math.
  if (!isTexPage(all)) return null;
  const allIdx = all.map((_, i) => i);
  const live = fold(all, allIdx, rules, pageH);
  const res: MathSpan[] = [];
  for (const ln of lines(all, live)) {
    for (const sp of spansInLine(all, ln)) {
      const kept = attachAccents(all, sp);
      if (kept.length === 0) continue;
      const big = maxSize(all, kept);
      const base = median(
        kept.filter((x) => all[x].size >= f32(f32(0.92) * big)).map((x) => all[x].base)
      );
      const tex = build(all, kept, base, big);
      if (tex === "") continue;
      const [top, bottom] = lineBox(all, ln, kept, base, big, pageH);
      // Integer indices, so the unstable sort of the Rust cannot change the order of equals.
      const sorted = sp.flatMap((x) => all[x].src).sort((a, b) => a - b);
      const consumed = sorted.filter((v, i) => i === 0 || v !== sorted[i - 1]);
      res.push({
        tex,
        x0: foldMin(sp.map((x) => all[x].x0)),
        x1: foldMax(sp.map((x) => all[x].x1)),
        top,
        bottom,
        size: big,
        chars: consumed,
      });
    }
  }
  return res;
}

/** The spans to splice into the page text, and the char indices they replace. */
export function emitted(spans: readonly MathSpan[]): [spans: MathSpan[], consumed: Set<number>] {
  const keep = spans.filter(hasStructure);
  return [keep, new Set(keep.flatMap((s) => s.chars))];
}
