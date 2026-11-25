// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// LaTeX from the glyphs on one baseline: sub/superscripts by glyph size and baseline shift, plus
// the per-glyph text (Greek, symbols, math alphabets).

import { f32, isAlphabetic, trim } from "../../ocria/rust.js";
import { gEnc, TEXT_FAMS } from "./fonts.js";
import { isAlpha, isAsciiUpper, maxSize, median } from "./helpers.js";
import { PRE, greek, isOperator, symbol } from "./tables.js";
import type { G } from "./types.js";

const LEADING_APOSTROPHES = /^'+/;

/** `cmd_space`: a command ending in a letter needs a space before the next character. */
export function cmdSpace(s: string): string {
  if (!s.startsWith("\\")) return s;
  const last = Array.from(s).at(-1);
  return last !== undefined && isAlphabetic(last) ? `${s} ` : s;
}

export function texCharInner(g: G): string {
  const t = g.t;
  if (t.startsWith(PRE)) return cmdSpace(t.slice(PRE.length));
  const gr = greek(t);
  if (TEXT_FAMS.includes(g.fam) && gr !== null) return `\\${gr} `;
  if (g.role === "Bb" && isAlpha(t)) return `\\mathbb{${t.toUpperCase()}}`;
  if (g.role === "Frak" && isAlpha(t)) return `\\mathfrak{${t}}`;
  if (g.role === "Scr" && isAlpha(t)) return `\\mathscr{${t}}`;
  if (((g.role === "Sy" && gEnc(g) === "Oms") || g.role === "Cal") && isAsciiUpper(t)) {
    return `\\mathcal{${t}}`;
  }
  if (gr !== null) return `\\${gr} `;
  const sym = symbol(t);
  if (sym !== null) return cmdSpace(sym);
  return t;
}

export function texChar(g: G): string {
  return `${g.pre}${texCharInner(g)}${g.post}`;
}

/**
 * Note: a small glyph back on the baseline is a script's script (the l of `\|g\|_{C^l}`).
 */
export function onBase(g: G, base: number, size: number): boolean {
  return (
    g.size >= f32(f32(0.92) * size) ||
    (Math.abs(f32(g.base - base)) <= f32(f32(0.12) * size) && g.size >= f32(f32(0.8) * size))
  );
}

export const OPERATORNAME: readonly string[] = ["diag", "rank", "span", "sgn", "Re", "Im"];

/** An operator name at `gs[i]`: the end of the letter run and the LaTeX, or null. */
function operatorAt(
  all: readonly G[],
  gs: readonly number[],
  i: number,
  base: number,
  size: number
): { end: number; tex: string } | null {
  const n = gs.length;
  let j = i;
  while (
    j < n &&
    all[gs[j]].role === null &&
    isAlpha(all[gs[j]].t) &&
    onBase(all[gs[j]], base, size)
  ) {
    j++;
  }
  const word = gs
    .slice(i, j)
    .map((x) => all[x].t)
    .join("");
  if (!isOperator(word)) return null;
  const tex = OPERATORNAME.includes(word) ? `\\operatorname{${word}}` : `\\${word} `;
  return { end: j, tex };
}

/** LaTeX for glyphs on baseline `base` at `size`, with sub/superscripts recursively. */
export function build(
  all: readonly G[],
  gs: readonly number[],
  base: number,
  size: number
): string {
  let out = "";
  const n = gs.length;
  let i = 0;
  while (i < n) {
    const g = all[gs[i]];
    if (onBase(g, base, size)) {
      if (g.role === null && isAlpha(g.t)) {
        const op = operatorAt(all, gs, i, base, size);
        if (op !== null) {
          out += op.tex;
          i = op.end;
          continue;
        }
      }
      out += texChar(g);
      i += 1;
      continue;
    }
    // A script run: consecutive glyphs off the baseline.
    let j = i;
    while (j < n && !onBase(all[gs[j]], base, size)) j++;
    const run = gs.slice(i, j);
    const top = maxSize(all, run);
    // Note: first-level script glyphs pick sub or sup by their baseline; smaller (second-level)
    // glyphs go with the first-level glyph before them (E_{g^{-1}}: the -1 rides on the g).
    const sub: number[] = [];
    const sup: number[] = [];
    let lastSup: boolean | null = null;
    // Baselines of the latest first-level sub and sup glyphs.
    let subBase: number | null = null;
    let supBase: number | null = null;
    for (const x of run) {
      if (all[x].size >= f32(f32(0.9) * top) || lastSup === null) {
        const up = all[x].base > base;
        lastSup = up;
        if (up) supBase = all[x].base;
        else subBase = all[x].base;
      } else if (subBase !== null && supBase !== null) {
        // Note: with both scripts open, a smaller glyph rides the one whose baseline is nearer
        // (\Phi_{B_s}^{ren}: the s is B's).
        lastSup = Math.abs(f32(all[x].base - supBase)) < Math.abs(f32(all[x].base - subBase));
      }
      if (lastSup === true) sup.push(x);
      else sub.push(x);
    }
    const groups: [grp: number[], mark: string, isSup: boolean][] = [
      [sub, "_", false],
      [sup, "^", true],
    ];
    for (const [grp, mark, isSup] of groups) {
      if (grp.length === 0) continue;
      let lvl1 = grp.filter((x) => all[x].size >= f32(f32(0.9) * top));
      if (lvl1.length === 0) lvl1 = [...grp];
      const b = median(lvl1.map((x) => all[x].base));
      let body = build(all, grp, b, maxSize(all, lvl1));
      if (isSup) {
        // Note: primes are written f', not f^{'} (a double superscript in KaTeX).
        const k = LEADING_APOSTROPHES.exec(body)?.[0].length ?? 0;
        if (k > 0) {
          out += "'".repeat(k);
          body = trim(body.slice(k));
        }
      }
      if (body !== "") out += `${mark}{${body}}`;
    }
    i = j;
  }
  return tidy(trim(out));
}

export function tidy(s: string): string {
  let r = s.replaceAll("...", "\\ldots ").replaceAll("\\cdot \\cdot \\cdot ", "\\cdots ");
  r = r
    .replaceAll("NOT=", "\\neq ")
    .replaceAll("NOT", "\\not ")
    .replaceAll("MAPSTO\\to ", "\\mapsto ")
    .replaceAll("MAPSTO", "");
  for (const tok of ["HAT", "TILDE", "SQRT"]) r = r.replaceAll(tok, "");
  return r;
}
