// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/structures.rs (crates-v2.21.2, Apache-2.0).

// Two-dimensional math from rules: fractions, overlines and square roots.
//
// A rule is a thin horizontal rect, line, or stretched image (some PDFs draw TeX's `\vrule` as a
// 1x1 image). Rules are taken narrowest first, so an inner fraction is folded before the one
// holding it: its glyphs become one stand-in glyph whose text is the finished LaTeX.

import { f32, totalCmp } from "../../ocria/rust.js";
import { fmax, fmin, median, maxSize } from "./helpers.js";
import type { Rule } from "./rule.js";
import { isRadical, replace, stack, standIn, texOf, width, wordy } from "./structures-parts.js";
import { gCx } from "./types.js";
import type { G } from "./types.js";

/** Square root: a radical glyph whose top-right meets the rule's left end. Returns the new live list, or null when no root folds here. */
function foldRoot(all: G[], live: number[], r: Rule, h: number): number[] | null {
  const rad = live.filter(
    (g) =>
      isRadical(all[g].t) &&
      Math.abs(f32(all[g].x1 - r.x0)) < f32(1.5) &&
      Math.abs(f32(f32(h - all[g].top) - r.y)) < f32(f32(f32(0.35) * all[g].size) + f32(1.5))
  );
  if (rad.length === 0) return null;
  let under = live
    .filter((g) => !rad.includes(g))
    .filter(
      (g) =>
        f32(r.x0 - f32(0.5)) <= gCx(all[g]) &&
        gCx(all[g]) <= f32(r.x1 + f32(0.5)) &&
        f32(h - all[g].top) <= f32(r.y + f32(0.6)) &&
        f32(r.y - f32(h - all[g].top)) < f32(f32(1.6) * all[g].size)
    );
  if (under.length === 0) return null;
  const s = maxSize(all, under);
  const nb = median(under.filter((g) => all[g].size >= f32(f32(0.85) * s)).map((g) => all[g].base));
  under = under.filter(
    (g) => f32(nb - f32(f32(0.6) * s)) <= all[g].base && all[g].base <= f32(nb + f32(f32(0.8) * s))
  );
  const tex = `\\sqrt{${texOf(all, under)}}`;
  const parts = [...under, ...rad];
  const sy = standIn(all, tex, parts, all[rad[0]].x0, r.x1, nb, s);
  return replace(all, live, parts, sy);
}

/** Fraction: glyphs stacked above and below the rule, as wide as it and centred on it. */
function foldFraction(
  all: G[],
  live: number[],
  r: Rule,
  num: number[],
  den: number[],
  body: number
): number[] | null {
  if (num.length === 0 || den.length === 0) return null;
  const tol = fmax(f32(f32(0.3) * body), 3);
  const [nx0, nx1] = width(all, num);
  const [dx0, dx1] = width(all, den);
  const wide = fmax(f32(nx1 - nx0), f32(dx1 - dx0));
  const rc = f32(f32(r.x0 + r.x1) / 2);
  const slack = f32(f32(f32(0.15) * r.w) + f32(1.5));
  const centred =
    Math.abs(f32(f32(f32(nx0 + nx1) / 2) - rc)) < slack &&
    Math.abs(f32(f32(f32(dx0 + dx1) / 2) - rc)) < slack;
  if (
    !(
      f32(r.w - tol) <= wide &&
      wide <= f32(r.w + 1) &&
      centred &&
      !wordy(all, num) &&
      !wordy(all, den)
    )
  ) {
    return null;
  }
  const tex = `\\frac{${texOf(all, num)}}{${texOf(all, den)}}`;
  const parts = [...num, ...den];
  const part = maxSize(all, parts);
  // Note: display fractions set their parts at full size, text-style ones at script size (so the
  // fraction's own size is ~1/0.7 of its parts').
  const size = part >= f32(f32(0.92) * body) ? part : fmin(body, f32(part / f32(0.7)));
  const sy = standIn(all, tex, parts, r.x0, r.x1, f32(r.y - f32(f32(0.25) * size)), size);
  return replace(all, live, parts, sy);
}

/** Overline: math glyphs right under the rule, as wide as it. */
function foldOverline(
  all: G[],
  live: number[],
  r: Rule,
  den: number[],
  h: number,
  body: number
): number[] | null {
  if (den.length === 0) return null;
  const [dx0, dx1] = width(all, den);
  const close = den.some(
    (g) => f32(r.y - f32(h - all[g].top)) < f32(f32(f32(0.45) * all[g].size) + 1)
  );
  const topG = den.reduce((a, b) => (all[b].top < all[a].top ? b : a));
  if (
    !(
      close &&
      den.some((g) => all[g].role !== null) &&
      Math.abs(f32(f32(dx1 - dx0) - r.w)) < fmax(f32(f32(0.3) * body), f32(2.5)) &&
      f32(r.y - f32(h - all[topG].top)) < f32(f32(0.5) * body)
    )
  ) {
    return null;
  }
  const tex = `\\overline{${texOf(all, den)}}`;
  const s = maxSize(all, den);
  const nb = median(den.filter((g) => all[g].size >= f32(f32(0.85) * s)).map((g) => all[g].base));
  const sy = standIn(all, tex, den, dx0, dx1, nb, s);
  return replace(all, live, den, sy);
}

/**
 * Fold fractions, square roots and overlines into stand-in glyphs. Returns the live glyph list;
 * stand-ins are appended to `all`.
 */
export function fold(all: G[], live: number[], rules: readonly Rule[], h: number): number[] {
  if (live.length === 0 || rules.length === 0) return live;
  const body = median(live.map((g) => all[g].size));
  const sorted = [...rules].sort((a, b) => totalCmp(a.w, b.w));
  for (const r of sorted) {
    if (r.w > f32(f32(0.6) * 612)) continue;
    const root = foldRoot(all, live, r, h);
    if (root !== null) {
      live = root;
      continue;
    }
    const num = stack(all, live, r, h, true);
    const den = stack(all, live, r, h, false);
    const frac = foldFraction(all, live, r, num, den, body);
    if (frac !== null) {
      live = frac;
      continue;
    }
    const over = foldOverline(all, live, r, den, h, body);
    if (over !== null) live = over;
  }
  return live;
}
