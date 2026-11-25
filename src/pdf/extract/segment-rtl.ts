// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): SegmentBuilder::place_rtl_mark.

// Text offsets are UTF-16 units here (the Rust keeps UTF-8 byte offsets): `rtl_spans` ends and the
// word insert positions shift by the mark's own length in the same unit, so the arithmetic is unchanged.

import { f32, isWhitespace } from "../../ocria/rust.js";
import type { RectF } from "../pdfium/types.js";
import { isRtlCombiningMark } from "./misc.js";

/** How far (points) past a word's rightmost letter a combining mark may sit and still belong to the letter before the word. */
const RTL_MARK_REACH = f32(3);

const F32_MIN = -3.4028234663852886e38;

/** The text, open word and right-to-left letter spans of a segment that `placeRtlMark` edits. */
export type RtlMarkState = {
  text: string;
  curWord: string;
  wordHas: boolean;
  emitWords: boolean;
  dirRtl: boolean | null;
  /** Right-to-left letters as `[end in text, loose left, loose right]`. */
  rtlSpans: Array<[number, number, number]>;
};

/** Index just past the last whitespace code point of `text` (0 when there is none). */
function wordStartOf(text: string): number {
  const cps = Array.from(text);
  let units = text.length;
  for (let i = cps.length - 1; i >= 0; i--) {
    units -= cps[i].length;
    if (isWhitespace(cps[i])) return units + cps[i].length;
  }
  return 0;
}

function isCharBoundary(s: string, at: number): boolean {
  if (at < 0 || at > s.length) return false;
  if (at === 0 || at === s.length) return true;
  const hi = s.charCodeAt(at - 1);
  const lo = s.charCodeAt(at);
  return !(hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff);
}

/**
 * A right-to-left combining mark (Arabic harakat, Hebrew points) that PDFium hands over after the
 * rest of its word: insert it after the letter of the current word that its box sits over. False
 * when the mark already follows its letter, or no letter of the word lies under it.
 */
export function placeRtlMark(s: RtlMarkState, c: string, vpLoose: RectF): boolean {
  if (s.dirRtl !== true || !isRtlCombiningMark(c) || s.rtlSpans.length < 2) return false;
  const wordStart = wordStartOf(s.text);
  const cx = f32(f32(vpLoose.left + vpLoose.right) / 2);
  const k = s.rtlSpans.findIndex(
    ([end, l, r]) => end > wordStart && cx >= f32(l - f32(0.5)) && cx <= f32(r + f32(0.5))
  );
  const n = c.length;
  if (k < 0) {
    // Just past the word's first (rightmost) letter: the mark sits on the letter before the word,
    // which PDFium hands over separately and line assembly puts back in front.
    let wordRight = F32_MIN;
    for (const sp of s.rtlSpans) if (sp[0] > wordStart) wordRight = Math.max(wordRight, sp[2]);
    if (wordRight > F32_MIN && cx > wordRight && f32(cx - wordRight) < RTL_MARK_REACH) {
      s.text = s.text.slice(0, wordStart) + c + s.text.slice(wordStart);
      if (s.emitWords && s.wordHas) s.curWord = c + s.curWord;
      for (const sp of s.rtlSpans) if (sp[0] > wordStart) sp[0] += n;
      return true;
    }
    return false;
  }
  if (k + 1 === s.rtlSpans.length) return false;
  const at = s.rtlSpans[k][0];
  s.text = s.text.slice(0, at) + c + s.text.slice(at);
  if (s.emitWords && s.wordHas) {
    const inWord = s.curWord.length + at;
    const w = inWord - (s.text.length - n);
    if (w >= 0 && isCharBoundary(s.curWord, w))
      s.curWord = s.curWord.slice(0, w) + c + s.curWord.slice(w);
  }
  for (let i = k; i < s.rtlSpans.length; i++) s.rtlSpans[i][0] += n;
  return true;
}
