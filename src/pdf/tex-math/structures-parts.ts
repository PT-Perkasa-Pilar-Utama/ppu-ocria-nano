// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/structures.rs (crates-v2.21.2, Apache-2.0).

// Helpers of the structure fold: glyph stacks above and below a rule, stand-in glyphs, and the
// checks that tell a fraction from table cells.

import { f32, totalCmp } from "../../ocria/rust.js";
import { attachAccents } from "./accents.js";
import { build } from "./build.js";
import { foldMax, foldMin, isAlpha, maxSize, median } from "./helpers.js";
import { STAND_IN_FAM } from "./rule.js";
import type { Rule } from "./rule.js";
import { PRE, isOperator } from "./tables.js";
import { gCx } from "./types.js";
import type { G } from "./types.js";

function sortByX0(all: readonly G[], gs: readonly number[]): number[] {
  return [...gs].sort((a, b) => totalCmp(all[a].x0, all[b].x0));
}

export function texOf(all: G[], gs: readonly number[]): string {
  const sorted = sortByX0(all, gs);
  const kept = attachAccents(all, sorted);
  if (kept.length === 0) return "";
  const big = maxSize(all, kept);
  const base = median(
    kept.filter((g) => all[g].size >= f32(f32(0.92) * big)).map((g) => all[g].base)
  );
  return build(all, kept, base, big);
}

export function standIn(
  all: readonly G[],
  tex: string,
  parts: readonly number[],
  x0: number,
  x1: number,
  base: number,
  size: number
): G {
  return {
    t: `${PRE}${tex}`,
    role: "Mi",
    fam: STAND_IN_FAM,
    size,
    base,
    x0,
    x1,
    top: foldMin(parts.map((g) => all[g].top)),
    bottom: foldMax(parts.map((g) => all[g].bottom)),
    loose: [foldMin(parts.map((g) => all[g].loose[0])), foldMax(parts.map((g) => all[g].loose[1]))],
    pre: "",
    post: "",
    src: parts.flatMap((g) => all[g].src),
  };
}

/**
 * The glyphs stacked right above (or below) a rule, within its width: the baseline nearest the
 * rule and the scripts riding on it. Glyphs much larger than the nearest ones are a neighbouring
 * text line, not the fraction (a text-style fraction is set at script size).
 */
export function stack(
  all: readonly G[],
  live: readonly number[],
  r: Rule,
  h: number,
  above: boolean
): number[] {
  const near = live.filter(
    (g) => f32(r.x0 - f32(0.8)) <= gCx(all[g]) && gCx(all[g]) <= f32(r.x1 + f32(0.8))
  );
  let cand: number[];
  let s: number;
  let nb: number;
  if (above) {
    cand = near.filter(
      (g) =>
        f32(h - all[g].bottom) >= f32(r.y - f32(0.6)) &&
        f32(all[g].base - r.y) < f32(f32(1.6) * all[g].size)
    );
    if (cand.length === 0) return [];
    const g0 = cand.reduce((a, b) => (all[b].base < all[a].base ? b : a));
    s = foldMax(
      cand
        .filter((g) => all[g].base <= f32(all[g0].base + f32(f32(0.4) * all[g].size)))
        .map((g) => all[g].size)
    );
    nb = foldMin(cand.filter((g) => all[g].size >= f32(f32(0.85) * s)).map((g) => all[g].base));
  } else {
    cand = near.filter(
      (g) =>
        f32(h - all[g].top) <= f32(r.y + f32(0.6)) &&
        f32(r.y - f32(h - all[g].top)) < f32(f32(0.9) * all[g].size)
    );
    if (cand.length === 0) return [];
    const g0 = cand.reduce((a, b) => (f32(h - all[b].top) > f32(h - all[a].top) ? b : a));
    s = foldMax(
      cand
        .filter(
          (g) => f32(h - all[g].top) >= f32(f32(h - all[g0].top) - f32(f32(0.4) * all[g].size))
        )
        .map((g) => all[g].size)
    );
    nb = foldMax(cand.filter((g) => all[g].size >= f32(f32(0.85) * s)).map((g) => all[g].base));
  }
  return cand.filter(
    (g) =>
      all[g].size <= f32(f32(1.15) * s) &&
      f32(nb - f32(f32(0.45) * s)) <= all[g].base &&
      all[g].base <= f32(nb + f32(f32(0.6) * s))
  );
}

/**
 * Whether glyphs hold a word of running text (3+ text-font letters that aren't an operator
 * name): table cells over and under a rule, not a fraction.
 */
export function wordy(all: readonly G[], gs: readonly number[]): boolean {
  const sorted = sortByX0(all, gs);
  let run = "";
  let runLen = 0;
  // `null` closes the last run, like the Rust `chain(once(None))`.
  for (const g of [...sorted, null]) {
    if (g !== null && all[g].role === null && isAlpha(all[g].t)) {
      run += all[g].t;
      runLen += 1;
      continue;
    }
    if (runLen >= 3 && !isOperator(run)) return true;
    run = "";
    runLen = 0;
  }
  return false;
}

export function width(all: readonly G[], gs: readonly number[]): [x0: number, x1: number] {
  return [foldMin(gs.map((g) => all[g].x0)), foldMax(gs.map((g) => all[g].x1))];
}

export function isRadical(t: string): boolean {
  return t === "\0SQRT" || t === "\0\\surd " || t === "√" || t === "\0\\surd";
}

/** Replace `parts` in `live` with a new stand-in glyph (appended to `all`). */
export function replace(
  all: G[],
  live: readonly number[],
  parts: readonly number[],
  sy: G
): number[] {
  const gone = new Set(parts);
  all.push(sy);
  const added = all.length - 1;
  return [...live.filter((g) => !gone.has(g)), added];
}
