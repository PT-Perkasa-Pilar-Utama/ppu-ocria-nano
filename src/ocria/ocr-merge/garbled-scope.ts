// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): garbled_scope and the page-level garbled checks.

import { f32, isWhitespace } from "../rust.js";
import type { Page } from "../types/page.js";
import {
  controlChars,
  controlsAreGarbled,
  intrusionsAreGarbled,
  isSymbolFont,
  scriptIntrusions,
  symbolIntrusions,
  symbolsAreGarbled,
  tokensAreGarbled,
} from "./garble-signals.js";
import type { MisreadByChar } from "./misread.js";
import { baseFontName, MISREAD_MIN_TAILS, MISREAD_MIN_WORDS, misreadGlyphs } from "./misread.js";
import { countLettersAndVowels } from "./native.js";
import { malformedTokens } from "./script-of.js";

/**
 * A font group must hold at least this share of the page's letters before its
 * own vowel ratio can flag the page. Corruption travels with a font, so a
 * broken map affects a substantial block of the page; requiring a real share
 * keeps a stray caption or ticker run in an odd font from flagging a healthy page.
 */
const GARBLE_MIN_FONT_SHARE = f32(0.15);

/** Minimum ASCII letters before a group of text is worth judging for garbling. */
const GARBLE_MIN_LETTERS = 30;

/**
 * True when a body of text's vowel ratio is below the natural-language floor.
 * Real Latin-script vowel ratios sit ~30-45% across English, Portuguese,
 * Spanish, French, etc. A ratio under 20% is well outside any natural-language
 * range and signals substitution-style corruption.
 */
export function ratioIsGarbled(letters: number, vowels: number): boolean {
  return letters >= GARBLE_MIN_LETTERS && vowels * 5 < letters;
}

/**
 * Which of a page's native text items are untrustworthy because they decode
 * to garbage. `Fonts` holds the `font_name` of each flagged group (null for items without one).
 */
export type GarbledScope =
  | { kind: "None" }
  | { kind: "WholePage" }
  | { kind: "Fonts"; fonts: Set<string | null> };

type Pair = [number, number];

/** Add `(a, b)` to the per-font tally for `font`. */
function tally(m: Map<string | null, Pair>, font: string | null, a: number, b: number): void {
  const e = m.get(font);
  if (e) {
    e[0] += a;
    e[1] += b;
  } else {
    m.set(font, [a, b]);
  }
}

/** Fonts whose `(a, b)` tally passes `bad`. */
function badFonts(
  m: Map<string | null, Pair>,
  bad: (a: number, b: number) => boolean
): Array<string | null> {
  const out: Array<string | null> = [];
  for (const [font, [a, b]] of m) if (bad(a, b)) out.push(font);
  return out;
}

/**
 * Page-level garbled check: even when individual items are too short to judge
 * in isolation (e.g. "GDWH", "FXUUHQFB XVG"), text whose aggregate vowel ratio
 * collapses is almost certainly substitution-encoded. Used to drop untrusted
 * native items before OCR merge, so short garbled labels don't suppress
 * overlapping OCR results.
 *
 * Judged per font group, not only page-wide: a page mixing a healthy standard
 * font with an embedded font whose ToUnicode map is wrong averages out to a
 * natural-looking ratio, so a page-wide sum alone reports the page as clean
 * while half its text is corrupt. The page-wide check is still applied first,
 * since it catches pages whose fonts are individually too small to judge (and
 * pages whose items carry no font name at all).
 */
export function garbledScope(page: Page): GarbledScope {
  let totalLetters = 0;
  let totalVowels = 0;
  const perFont = new Map<string | null, Pair>();
  // Complex-script text with unmapped conjunct / ligature glyphs (see `scriptIntrusions`).
  const perFontScript = new Map<string | null, Pair>();
  let totalScript = 0;
  let totalIntrusions = 0;
  // Legacy-encoded Indic fonts and cipher-like maps (see `symbolIntrusions`).
  const perFontSymbol = new Map<string | null, Pair>();
  let totalSymLetters = 0;
  let totalSym = 0;
  // Control characters and malformed tokens (see `controlChars`, `tokenIsMalformed`).
  const perFontCtrl = new Map<string | null, Pair>();
  let totalCtrl = 0;
  let totalChars = 0;
  const perFontTok = new Map<string | null, Pair>();
  let totalJudged = 0;
  let totalMalformed = 0;
  // Misread glyphs (see `misreadGlyphs`), per base font: intruding char -> its distinct
  // words and the distinct tails it opens.
  const perBaseMisread = new Map<string | null, MisreadByChar>();
  for (const it of page.text_items) {
    const font = it.font_name ?? null;
    if (!it.math && !isSymbolFont(font)) {
      const key = font === null ? null : baseFontName(font);
      let words = perBaseMisread.get(key);
      if (!words) {
        words = new Map();
        perBaseMisread.set(key, words);
      }
      for (const m of misreadGlyphs(it.text)) {
        let e = words.get(m.ch);
        if (!e) {
          e = [new Set(), new Set()];
          words.set(m.ch, e);
        }
        e[0].add(m.word);
        e[1].add(m.tail);
      }
    }
    // math items carry the TeX pass's own LaTeX (and its fonts' control-position glyphs)
    if (!it.math && !isSymbolFont(font)) {
      const [c, n] = controlChars(it.text);
      totalCtrl += c;
      totalChars += n;
      tally(perFontCtrl, font, c, n);
      const [j, m] = malformedTokens(it.text);
      totalJudged += j;
      totalMalformed += m;
      tally(perFontTok, font, j, m);
    }
    // The checks below judge decoded text; a math item's text is the TeX pass's LaTeX
    // ("\\mathbb{N}", "z^{n+1}"), which reads as a vowel-less cipher.
    if (it.math) continue;
    const [l, v] = countLettersAndVowels(it.text);
    totalLetters += l;
    totalVowels += v;
    tally(perFont, font, l, v);
    const [sc, intr] = scriptIntrusions(it.text);
    totalScript += sc;
    totalIntrusions += intr;
    tally(perFontScript, font, sc, intr);
    const [lt, sy] = symbolIntrusions(it.text);
    totalSymLetters += lt;
    totalSym += sy;
    tally(perFontSymbol, font, lt, sy);
  }

  if (
    ratioIsGarbled(totalLetters, totalVowels) ||
    intrusionsAreGarbled(totalScript, totalIntrusions) ||
    symbolsAreGarbled(totalSymLetters, totalSym) ||
    controlsAreGarbled(totalCtrl, totalChars) ||
    tokensAreGarbled(totalJudged, totalMalformed)
  ) {
    return { kind: "WholePage" };
  }

  const minShare = Math.ceil(f32(f32(totalLetters) * GARBLE_MIN_FONT_SHARE));
  const fonts = new Set<string | null>();
  for (const font of badFonts(perFont, (l, v) => l >= minShare && ratioIsGarbled(l, v)))
    fonts.add(font);
  for (const font of badFonts(perFontScript, intrusionsAreGarbled)) fonts.add(font);
  for (const font of badFonts(perFontSymbol, symbolsAreGarbled)) fonts.add(font);
  for (const font of badFonts(perFontCtrl, controlsAreGarbled)) fonts.add(font);
  for (const font of badFonts(perFontTok, tokensAreGarbled)) fonts.add(font);
  // A misread glyph condemns every subset of its base font on the page: a producer that
  // wrote one subset's map wrong wrote the others the same way, and the body subset's few
  // misreads ("maGor") are too sparse to judge alone.
  const misreadBases = new Set<string | null>();
  for (const [base, words] of perBaseMisread) {
    for (const [w, tails] of words.values()) {
      if (w.size >= MISREAD_MIN_WORDS && tails.size >= MISREAD_MIN_TAILS) {
        misreadBases.add(base);
        break;
      }
    }
  }
  if (misreadBases.size > 0) {
    for (const it of page.text_items) {
      const font = it.font_name ?? null;
      if (misreadBases.has(font === null ? null : baseFontName(font))) fonts.add(font);
    }
  }
  return fonts.size === 0 ? { kind: "None" } : { kind: "Fonts", fonts };
}

/**
 * True when text with a failed Unicode mapping is both a real amount (not a
 * stray Type3 symbol glyph) and a real share of the page's native text.
 */
export function pageHasUnmappedText(page: Page): boolean {
  let unmapped = 0;
  let total = 0;
  for (const it of page.text_items) {
    let n = 0;
    for (const c of it.text) if (!isWhitespace(c)) n++;
    if (it.has_unicode_map_error) unmapped += n;
    total += n;
  }
  return unmapped >= GARBLE_MIN_LETTERS && unmapped >= f32(f32(total) * GARBLE_MIN_FONT_SHARE);
}

/**
 * Page-level garbled signal: substitution-cipher text (see `garbledScope`)
 * or a substantial share of text whose Unicode mapping failed outright.
 */
export function pageIsGarbled(page: Page): boolean {
  return garbledScope(page).kind !== "None" || pageHasUnmappedText(page);
}
