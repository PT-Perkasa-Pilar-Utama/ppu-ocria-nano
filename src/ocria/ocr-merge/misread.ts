// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): misread glyph detection.

import { chars, isAlphabetic, isLowercase, isUppercase } from "../rust.js";
import { isAsciiDigit, lowerChar, splitWhitespace, trimMatches } from "../rust-extra.js";
import { scriptOf } from "./script-of.js";

/**
 * Fewest distinct words one misread character must turn up in for its font to count as
 * garbled (see `misreadGlyphs`). Brand and camel-case names ("arXiv", "iPad", "McRae")
 * repeat one word; a wrong map entry hits every word with that glyph. On ParseBench v2 text,
 * tables and opendataloader (1,210 pages) the broken fonts reach 3-50 words, clean text 2.
 */
export const MISREAD_MIN_WORDS = 3;

/**
 * ...and, for a misread capital, at least this many distinct tails it opens: compound names
 * end in one repeated part ("HistoAge", "PhenoAge", "GrimAge"), a wrong map entry lands
 * mid-word in different places ("executiMe", "achieMed").
 */
export const MISREAD_MIN_TAILS = 2;

/** Per misread char: the distinct words it sits in and the distinct tails it opens. */
export type MisreadByChar = Map<string, [Set<string>, Set<string>]>;

/**
 * One misread character (see `misreadGlyphs`): the char, the word it sits in (letters,
 * lowercased), and the text from it to the word's end (for a symbol, the whole word).
 */
export type Misread = { ch: string; word: string; tail: string };

/** A font's name without its subset tag ("AAAAAB+Futura" -> "Futura"). */
export function baseFontName(name: string): string {
  const plus = name.indexOf("+");
  return plus >= 0 ? name.slice(plus + 1) : name;
}

const EDGE_PUNCT = ".,;:()[]{}'\"!?";
const EDGE_QUOTES = "«»“”‘’";

/** A Latin, Greek or Cyrillic letter. */
function bicameralLetter(c: string): boolean {
  if (!isAlphabetic(c)) return false;
  const s = scriptOf(c);
  return s === 0 || s === 0x370 || s === 0x400;
}

/**
 * Characters a font map put where a letter belongs, each with the word (its letters,
 * lowercased) it sits in. A map that is wrong for only a few glyphs leaves text that reads
 * almost right, so none of the font-wide rates catch it:
 * - `! % *` between two Latin, Greek or Cyrillic letters ("va!í", "kter*ch": č, š, ý lost);
 * - a capital inside a lowercase word whose lowercase tail (under 3 letters) ends the word
 *   ("maGor", "OecutiMe", "horiQon"). A capital in second place ("iPad"), words with digits
 *   ("dBm", "o9A") and identifiers are skipped.
 *
 * `"` is no intruder: a quotation printed without its leading space ("expression"put") is real.
 */
export function misreadGlyphs(text: string): Misread[] {
  const out: Misread[] = [];
  for (const tok of splitWhitespace(text)) {
    const t = trimMatches(tok, (c) => EDGE_PUNCT.includes(c) || EDGE_QUOTES.includes(c));
    if (t.startsWith("http") || chars(t).some((c) => "_@\\$/".includes(c))) continue;
    const cs = chars(t);
    if (cs.length < 3) continue;
    const word = (): string => cs.filter(isAlphabetic).map(lowerChar).join("");
    for (let i = 1; i < cs.length - 1; i++) {
      if ("!%*".includes(cs[i]) && bicameralLetter(cs[i - 1]) && bicameralLetter(cs[i + 1])) {
        out.push({ ch: cs[i], word: word(), tail: word() });
      }
    }
    if (cs.some(isAsciiDigit)) continue;
    for (let i = 2; i < cs.length - 1; i++) {
      if (isLowercase(cs[i - 1]) && isUppercase(cs[i]) && isLowercase(cs[i + 1])) {
        let tail = 0;
        while (i + 1 + tail < cs.length && isLowercase(cs[i + 1 + tail])) tail++;
        if (i + 1 + tail === cs.length && tail < 3) {
          out.push({ ch: cs[i], word: word(), tail: cs.slice(i).join("") });
        }
      }
    }
  }
  return out;
}
