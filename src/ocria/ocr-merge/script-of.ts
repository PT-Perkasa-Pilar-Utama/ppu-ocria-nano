// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): script_of and token_is_malformed.

import { chars, cp, isAlphabetic, isAlphanumeric, isLowercase, isUppercase } from "../rust.js";
import { isControl, splitWhitespace, trimMatches } from "../rust-extra.js";

/** Whether `o` lies in any of the inclusive `[lo, hi]` ranges. */
function inAny(o: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([lo, hi]) => o >= lo && o <= hi);
}

/**
 * Coarse script of a letter for `tokenIsMalformed`: 0 Latin, 1 CJK (Han, kana, Hangul and
 * their fullwidth forms, which share tokens with Latin and each other in unspaced text),
 * otherwise an id per script from a table of the scripts we can tell apart (so Tamil and Telugu
 * differ, while the blocks of one script agree); unlisted scripts share one id.
 * The rows keep the Rust `match` arm order.
 */
const SCRIPT_ROWS: ReadonlyArray<readonly [number, ReadonlyArray<readonly [number, number]>]> = [
  [
    0,
    [
      [0, 0x24f],
      [0x1e00, 0x1eff],
      [0x2c60, 0x2c7f],
      [0xa720, 0xa7ff],
    ],
  ],
  [
    1,
    [
      [0x1100, 0x11ff],
      [0x3000, 0x30ff],
      [0x3400, 0x9fff],
      [0xac00, 0xd7af],
      [0xf900, 0xfaff],
      [0xff00, 0xffef],
    ],
  ],
  // Scripts whose letters span several blocks are one script each: polytonic Greek and
  // Coptic, Cyrillic extensions, Hebrew / Arabic presentation forms, Ethiopic, Georgian.
  [
    0x370,
    [
      [0x0370, 0x03ff],
      [0x1f00, 0x1fff],
      [0x2c80, 0x2cff],
    ],
  ],
  [
    0x400,
    [
      [0x0400, 0x052f],
      [0x1c80, 0x1c8f],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
    ],
  ],
  [
    0x590,
    [
      [0x0590, 0x05ff],
      [0xfb1d, 0xfb4f],
    ],
  ],
  [
    0x600,
    [
      [0x0600, 0x06ff],
      [0x0750, 0x077f],
      [0x0860, 0x08ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  ],
  [
    0x1200,
    [
      [0x1200, 0x139f],
      [0x2d80, 0x2ddf],
      [0xab00, 0xab2f],
    ],
  ],
  [
    0x10a0,
    [
      [0x10a0, 0x10ff],
      [0x1c90, 0x1cbf],
      [0x2d00, 0x2d2f],
    ],
  ],
  [
    0x1780,
    [
      [0x1780, 0x17ff],
      [0x19e0, 0x19ff],
    ],
  ],
  [
    0x1000,
    [
      [0x1000, 0x109f],
      [0xa9e0, 0xa9ff],
      [0xaa60, 0xaa7f],
    ],
  ],
  [
    0x530,
    [
      [0x0530, 0x058f],
      [0xfb13, 0xfb17],
    ],
  ],
  [0x700, [[0x0700, 0x074f]]],
];

export function scriptOf(c: string): number {
  const o = cp(c);
  for (const [id, ranges] of SCRIPT_ROWS) if (inAny(o, ranges)) return id;
  // Indic scripts sit in exact 128-codepoint blocks
  if (o >= 0x0900 && o <= 0x0dff) return o & ~0x7f;
  if (o >= 0x0e00 && o <= 0x0e7f) return 0xe00;
  if (o >= 0x0e80 && o <= 0x0eff) return 0xe80;
  if (o >= 0x0f00 && o <= 0x0fff) return 0xf00;
  // anything else is one bucket: never counted as a script mix
  return 2;
}

/** A letter of a script other than Latin and CJK (combining marks excluded). */
function otherScript(c: string): boolean {
  const u = cp(c);
  return isAlphabetic(c) && !(u >= 0x300 && u <= 0x36f) && scriptOf(c) > 1;
}

function accentedLatin(c: string): boolean {
  const u = cp(c);
  return isAlphabetic(c) && u >= 0xc0 && u <= 0x24f;
}

type CaseFlips = { flips: number; short: boolean };

/** A case flip is a lowercase letter, an uppercase one, then a lowercase one. */
function caseFlips(cs: readonly string[]): CaseFlips {
  let flips = 0;
  let short = false;
  for (let i = 1; i < cs.length - 1; i++) {
    if (isLowercase(cs[i - 1]) && isUppercase(cs[i]) && isLowercase(cs[i + 1])) {
      flips++;
      let run = 0;
      for (let j = i + 1; j < cs.length && isLowercase(cs[j]); j++) run++;
      short ||= run < 3;
    }
  }
  return { flips, short };
}

/**
 * A token whose shape no correctly decoded text has:
 * - a case flip into a short lowercase run, or two flips, inside a word ("hZeY", "cVdaVTe",
 *   "ÞkusLkkykuÚke"); camelCase starts a real sub-word ("DataEncoder", "iPhone") and
 *   identifiers with `_` `.` `/` are skipped;
 * - `;` or `=` between letters ("iNdm;s;=udf.a", legacy Sinhala / Tamil fonts);
 * - letters of two different non-Latin, non-CJK scripts, or an accented Latin letter
 *   glued to one ("ประสงคŤ", Thai tone marks mapped into Latin Extended).
 *
 * `null` when the token is too short to judge.
 */
export function tokenIsMalformed(tok: string): boolean | null {
  if (tok.includes("$") || tok.includes("\\")) return null; // LaTeX written by the TeX math pass
  const cs = chars(trimMatches(tok, (c) => !isAlphanumeric(c)));
  if (cs.length < 3 || cs.filter(isAlphabetic).length < 2) return null;
  if (!cs.some((c) => c === "_" || c === "." || c === "/" || c === "@")) {
    const { flips, short } = caseFlips(cs);
    if (flips >= 2 || short) return true;
  }
  for (let i = 1; i < cs.length - 1; i++) {
    if ((cs[i] === ";" || cs[i] === "=") && isAlphabetic(cs[i - 1]) && isAlphabetic(cs[i + 1])) {
      return true;
    }
  }
  let seen: number | null = null;
  for (const c of cs) {
    if (!otherScript(c)) continue;
    const s = scriptOf(c);
    if (seen !== null && seen !== s) return true;
    seen = s;
  }
  for (let i = 0; i + 1 < cs.length; i++) {
    const [a, b] = [cs[i], cs[i + 1]];
    if ((accentedLatin(a) && otherScript(b)) || (otherScript(a) && accentedLatin(b))) return true;
  }
  return false;
}

/** (judged tokens, malformed tokens) in `text`, control characters read as spaces. */
export function malformedTokens(text: string): [number, number] {
  let judged = 0;
  let malformed = 0;
  const clean = chars(text)
    .map((c) => (isControl(c) ? " " : c))
    .join("");
  for (const tok of splitWhitespace(clean)) {
    const m = tokenIsMalformed(tok);
    if (m === null) continue;
    judged++;
    if (m) malformed++;
  }
  return [judged, malformed];
}
