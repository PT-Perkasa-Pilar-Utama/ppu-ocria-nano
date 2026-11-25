// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): native text usability and sparseness.

import { chars, f32 } from "../rust.js";
import type { Page } from "../types/page.js";
import type { TextItem } from "../types/text-item.js";
import { isAscii, isAsciiAlphabetic, lowerChar, toAsciiLowercase, utf8Len } from "../rust-extra.js";

/**
 * Precomposed Latin vowels carrying diacritics, lowercase. Without these,
 * languages that put a mark on most vowels (Vietnamese, tone-marked pinyin)
 * lose their vowels from the count while keeping their plain consonants, so
 * clean text drops below the garble floor. Covers Latin-1, Latin Extended-A/B
 * and the Vietnamese block of Latin Extended Additional.
 */
const ACCENTED_VOWELS: ReadonlySet<string> = new Set(
  chars(
    "àáâãäåāăąǎȁȃȧạảấầẩẫậắằẳẵặèéêëēĕėęěȅȇẹẻẽếềểễệìíîïĩīĭįǐȉȋỉịòóôõöøōŏőǒȍȏȯọỏốồổỗộơớờởỡợùúûüũūŭůűųǔǖǘǚǜȕȗụủưứừửữự"
  )
);

/** Below this many bytes of usable native text a page counts as having no text of its own. */
const MIN_NATIVE_TEXT_LEN = 20;

/** (ASCII letters, vowels among them, plus accented Latin vowels) in `text`. */
export function countLettersAndVowels(text: string): [number, number] {
  let letters = 0;
  let vowels = 0;
  for (const ch of text) {
    if (isAsciiAlphabetic(ch)) {
      letters++;
      if ("aeiou".includes(toAsciiLowercase(ch))) vowels++;
    } else if (!isAscii(ch) && chars(lowerChar(ch)).some((c) => ACCENTED_VOWELS.has(c))) {
      letters++;
      vowels++;
    }
  }
  return [letters, vowels];
}

/**
 * Heuristic for substitution-cipher / broken-cmap garbling: real Latin-script
 * text has a vowel ratio of roughly 30-45%, but a substitution permutation
 * almost always maps the original A/E/I/O/U onto non-vowel letters, driving
 * the apparent vowel ratio to near zero. Texts without enough ASCII letters
 * to judge (non-Latin scripts, numbers, short labels) are treated as fine.
 */
export function isLikelyGarbled(text: string): boolean {
  const [letters, vowels] = countLettersAndVowels(text);
  if (letters < 10) return false;
  return vowels * 10 < letters;
}

/**
 * A native text item that cannot be trusted as a text source: either its
 * Unicode mapping failed outright (Type3 fonts with no ToUnicode: the text
 * is a char-code fallback and the bbox comes from deceptive declared
 * metrics), or its content looks substitution-cipher garbled.
 */
export function isUnusableNative(item: TextItem): boolean {
  return item.has_unicode_map_error || isLikelyGarbled(item.text);
}

/** Bytes of native text on the page, excluding items OCR would replace anyway. */
export function nativeTextLength(page: Page): number {
  let n = 0;
  for (const item of page.text_items) if (!isUnusableNative(item)) n += utf8Len(item.text);
  return n;
}

/**
 * True when the page's native (already-extracted) text is sparse enough that
 * OCR is likely its primary text source. Mirrors the non-image predicates in
 * `render_pages_for_ocr` (`text_length < 20 || text_coverage < 0.15`) so the
 * systemic-failure guard matches the same pages that were rendered because
 * their native text was insufficient.
 */
export function pageHasSparseNativeText(page: Page): boolean {
  const textLength = nativeTextLength(page);
  const pageArea = f32(page.page_width * page.page_height);
  let textBboxArea = 0;
  for (const item of page.text_items) {
    if (!isUnusableNative(item)) textBboxArea = f32(textBboxArea + f32(item.width * item.height));
  }
  const textCoverage = pageArea > 0 ? f32(textBboxArea / pageArea) : 0;
  return textLength < MIN_NATIVE_TEXT_LEN || textCoverage < f32(0.15);
}
