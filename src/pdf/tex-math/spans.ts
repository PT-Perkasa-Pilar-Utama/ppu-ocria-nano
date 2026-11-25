// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Math spans in one line: runs of math glyphs, extended over text-font digits, punctuation and
// operator names that sit between or next to math glyphs.

import { f32 } from "../../ocria/rust.js";
import { accentOf } from "./accents.js";
import { isAlpha, maxSize } from "./helpers.js";
import { TEXT_MATH_OK, isOperator } from "./tables.js";
import { gCx } from "./types.js";
import type { G } from "./types.js";

/** Characters a footnote marker is made of (besides digits). */
const MARKER_SYMBOLS = "∗*†‡§¶⋆";

const ASCII_DIGITS = /^[0-9]*$/;

/** A single code point, or null when `t` is empty or longer. */
function onlyChar(t: string): string | null {
  const cs = Array.from(t);
  return cs.length === 1 ? cs[0] : null;
}

export function inTextMathOk(t: string): boolean {
  const c = onlyChar(t);
  return c !== null && TEXT_MATH_OK.includes(c);
}

/**
 * Glyphs a footnote marker is made of: digits and the reference symbols; commas only between
 * them.
 */
export function isMarker(t: string, first: boolean): boolean {
  const c = onlyChar(t);
  if (c === null) return false;
  return (c >= "0" && c <= "9") || MARKER_SYMBOLS.includes(c) || (!first && c === ",");
}

/**
 * Drops a text-font bracket at either end of a span that has no partner inside it (the `)` of
 * "(q and q̇)" belongs to the sentence). Edits `sp` in place.
 */
export function trimUnmatchedBrackets(all: readonly G[], sp: number[]): void {
  const unmatched: boolean[] = sp.map(() => false);
  // Note: any opener closes with any closer: half-open intervals ([0, ∞)).
  const stack: number[] = [];
  for (const [k, x] of sp.entries()) {
    if (all[x].role !== null) continue;
    const t = all[x].t;
    if (t === "(" || t === "[") stack.push(k);
    else if ((t === ")" || t === "]") && stack.pop() === undefined) unmatched[k] = true;
  }
  for (const k of stack) unmatched[k] = true;
  let lo = 0;
  while (lo < unmatched.length && unmatched[lo]) lo++;
  let trailing = 0;
  while (trailing < unmatched.length - lo && unmatched[unmatched.length - 1 - trailing]) trailing++;
  sp.length = sp.length - trailing;
  sp.splice(0, lo);
}

/** Footnote markers set tight after a text word are text, not scripts: clear their `math` flags. */
function clearFootnoteMarkers(
  all: readonly G[],
  ln: readonly number[],
  math: boolean[],
  body: number
): void {
  const n = ln.length;
  const g = (k: number): G => all[ln[k]];
  // Note: a raised small run set tight after a text-font word or sentence punctuation is a
  // footnote marker (Kim∗, Lee∗†, b.³), not a superscript. Operator names keep their scripts
  // (sin²).
  let k = 1;
  while (k < n) {
    const prev = g(k - 1);
    const afterText =
      prev.role === null &&
      prev.size >= f32(f32(0.85) * body) &&
      (isAlpha(prev.t) || ".,;:".includes(prev.t)) &&
      f32(g(k).x0 - prev.x1) < f32(f32(0.3) * prev.size);
    const raised = (m: number): boolean =>
      g(m).size < f32(f32(0.85) * body) && g(m).base > f32(prev.base + f32(f32(0.2) * prev.size));
    if (!(afterText && raised(k) && isMarker(g(k).t, true))) {
      k += 1;
      continue;
    }
    let w = k - 1;
    while (w > 0 && g(w - 1).role === null && isAlpha(g(w - 1).t)) w--;
    let word = "";
    for (let m = w; m < k; m++) word += g(m).t;
    let j = k;
    while (j < n && raised(j) && isMarker(g(j).t, false)) j++;
    // Note: a word whose script is set tight against a bracket or math is a function name
    // (Aut⁰(X)).
    const tightAfter =
      j < n &&
      f32(g(j).x0 - g(j - 1).x1) < f32(f32(0.15) * g(j).size) &&
      (math[j] || g(j).t === "(");
    if (!isOperator(word) && !tightAfter) {
      for (let m = k; m < j; m++) math[m] = false;
    }
    k = j;
  }
}

/** Operator names in text font next to math, and bold letters or function names against math. */
function markOperatorNames(all: readonly G[], ln: readonly number[], math: boolean[]): void {
  const n = ln.length;
  const g = (k: number): G => all[ln[k]];
  let i = 0;
  while (i < n) {
    if (!(g(i).role === null && isAlpha(g(i).t))) {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j < n &&
      g(j).role === null &&
      isAlpha(g(j).t) &&
      (j === i || f32(g(j).x0 - g(j - 1).x1) < f32(f32(0.15) * g(j).size))
    ) {
      j++;
    }
    let word = "";
    for (let k = i; k < j; k++) word += g(k).t;
    const near = (i > 0 && math[i - 1]) || (j < n && math[j]);
    const em = g(i).size;
    const tightL = i > 0 && math[i - 1] && f32(g(i).x0 - g(i - 1).x1) < f32(f32(0.2) * em);
    const tightR =
      j < n && f32(g(j).x0 - g(j - 1).x1) < f32(f32(0.12) * em) && (math[j] || g(j).t === "(");
    // Note: a bold letter against math is a vector (\mathbf{x}); a word set tight against a
    // bracket or math is a function name (Hom(A, B)).
    const boldLetter =
      j - i === 1 && (g(i).fam === "CMBX" || g(i).fam === "CMB") && (tightL || tightR);
    if ((isOperator(word) && near) || boldLetter || (j - i >= 2 && tightR && near)) {
      for (let m = i; m < j; m++) math[m] = true;
    }
    i = j;
  }
}

/** Grow over text-font digits / punctuation adjacent to math, both directions, until stable. */
function growOverText(all: readonly G[], ln: readonly number[], math: boolean[]): void {
  const n = ln.length;
  const g = (k: number): G => all[ln[k]];
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < n; k++) {
      if (math[k] || !inTextMathOk(g(k).t)) continue;
      const sz = g(k).size;
      const left = k > 0 && math[k - 1] && f32(g(k).x0 - g(k - 1).x1) < f32(f32(0.6) * sz);
      const right = k + 1 < n && math[k + 1] && f32(g(k + 1).x0 - g(k).x1) < f32(f32(0.6) * sz);
      if (left || right) {
        // Note: a sentence's full stop or comma after math stays text.
        if (".,;:".includes(g(k).t) && !right) continue;
        math[k] = true;
        changed = true;
      }
    }
  }
}

/**
 * Runs of math glyphs in a line, extended over text-font digits / punctuation / operator names
 * that sit between or next to math glyphs.
 */
export function spansInLine(all: readonly G[], ln: readonly number[]): number[][] {
  const n = ln.length;
  if (n === 0) return [];
  const g = (k: number): G => all[ln[k]];
  const body = maxSize(all, ln);
  const math: boolean[] = ln.map((_, k) => g(k).role !== null || g(k).size < f32(f32(0.85) * body));
  // Note: a small text-font glyph is a script only when the line also has math-font glyphs.
  if (!ln.some((_, k) => g(k).role !== null)) return [];
  clearFootnoteMarkers(all, ln, math, body);
  // Operator names in text font: a run of letters matching OPERATORS next to math.
  markOperatorNames(all, ln, math);
  for (let k = 0; k < n; k++) {
    if (!math[k] && accentOf(g(k)) !== null) {
      const cx = gCx(g(k));
      for (let m = Math.max(k - 3, 0); m < Math.min(k + 4, n); m++) {
        if (math[m] && f32(g(m).x0 - 1) <= cx && cx <= f32(g(m).x1 + 1)) {
          math[k] = true;
          break;
        }
      }
    }
  }
  growOverText(all, ln, math);
  const out: number[][] = [];
  let cur: number[] = [];
  for (let k = 0; k < n; k++) {
    if (math[k]) {
      // Note: TeX's widest math space is ~0.3em; a wider gap before a text-font number is a table
      // column (3.6→ | 18.7→), not math.
      const last = cur.at(-1);
      const gap = last === undefined ? null : f32(g(k).x0 - all[last].x1);
      const numeral = g(k).role === null && ASCII_DIGITS.test(g(k).t);
      if (gap !== null && (gap > f32(f32(1.5) * body) || (numeral && gap > f32(f32(0.6) * body)))) {
        out.push(cur);
        cur = [];
      }
      cur.push(ln[k]);
    } else if (cur.length > 0) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  for (const sp of out) trimUnmatchedBrackets(all, sp);
  return out.filter((s) => s.some((x) => all[x].role !== null) || s.length > 1);
}
