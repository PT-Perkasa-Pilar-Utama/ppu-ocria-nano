// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): prescan_page_batched, lam_alef_order.

import { isWhitespace } from "../../ocria/rust.js";
import { Font } from "../pdfium/font.js";
import type { Library } from "../pdfium/library.js";
import type { TextPage } from "../pdfium/text-page.js";
import type { CharInfoChunks } from "./chars.js";
import { CHAR_TYPE_GENERATED, charFromU32, isSuspiciousUnicode } from "./chars.js";
import { isControl } from "../../ocria/rust-extra.js";

/** A font flagged for garbage /ToUnicode needs at least this many chars... */
const GARBAGE_MIN_CHARS = 20;

/** The prescan verdicts: whether invisible text is skipped, and the garbage-ToUnicode fonts by handle. */
export type Prescan = { skipInvisible: boolean; garbageFonts: Set<number> };

/**
 * One chunked pass computing the invisible-text verdict and the garbage-ToUnicode fonts:
 * invisible text is skipped only when visible text clearly dominates (an invisible layer under
 * a native-text page); when invisible text is the majority it IS the content (a scanned PDF's OCR layer).
 * Fonts whose /ToUnicode maps a high fraction of chars into control/PUA/sentinel codepoints are
 * flagged by font handle.
 */
export function prescanPageBatched(
  lib: Library,
  chunks: CharInfoChunks,
  charCount: number
): Prescan {
  let visible = 0;
  let invisible = 0;
  const counts = new Map<number, [number, number]>();
  let lastObj = 0;
  let lastKey = 0;

  for (let i = 0; i < charCount; i++) {
    const rec = chunks.record(i);
    if (rec === undefined) continue;
    const unicode = rec.unicode;
    const generated = rec.charType === CHAR_TYPE_GENERATED;

    // Visible/invisible tally.
    if (unicode !== 0 && unicode !== 0xfffe && unicode !== 0xffff) {
      const c = charFromU32(unicode);
      const wsOrCtrl = c !== null && (isWhitespace(c) || isControl(c));
      if (!wsOrCtrl && !generated) {
        if (rec.textRenderMode === 3) invisible += 1;
        else visible += 1;
      }
    }

    // Garbage-font tally.
    if (generated || unicode === 0x09 || unicode === 0x0a || unicode === 0x0d || unicode === 0x20)
      continue;
    if (rec.textObject === 0) continue;
    const obj = rec.textObject;
    let key: number;
    if (obj === lastObj) {
      key = lastKey;
    } else {
      const font = Font.fromTextObject(lib, obj);
      if (font === null) continue;
      lastObj = obj;
      lastKey = font.handle;
      key = lastKey;
    }
    const entry = counts.get(key) ?? [0, 0];
    entry[0] += 1;
    if (isSuspiciousUnicode(unicode)) entry[1] += 1;
    counts.set(key, entry);
  }

  const skipInvisible =
    visible === 0 || invisible === 0 ? false : invisible / (visible + invisible) < 0.3;
  const garbageFonts = new Set<number>();
  for (const [key, [total, suspicious]] of counts) {
    if (total >= GARBAGE_MIN_CHARS && suspicious * 10 >= total) garbageFonts.add(key);
  }
  return { skipInvisible, garbageFonts };
}

const ARABIC_LAM = 0x0644;

function isAlef(u: number): boolean {
  return u === 0x0622 || u === 0x0623 || u === 0x0625 || u === 0x0627;
}

/**
 * Logical order for a lam-alef ligature glyph. One glyph draws lam + alef, and many producers
 * write its ToUnicode entry in visual order, alef first; PDFium then hands back two chars sharing
 * the glyph's char code. Separate alef and lam glyphs (the article "al") carry different codes.
 */
export function lamAlefOrder(
  textPage: TextPage,
  i: number,
  charCount: number,
  unicode: number,
  code: number
): number {
  const sharesGlyph = (j: number): number | null => {
    if (j < 0 || j >= charCount) return null;
    return textPage.charCode(j) === code ? textPage.unicode(j) : null;
  };
  if (isAlef(unicode) && sharesGlyph(i + 1) === ARABIC_LAM) return ARABIC_LAM;
  if (unicode === ARABIC_LAM) {
    const prev = sharesGlyph(i - 1);
    if (prev !== null && isAlef(prev)) return prev;
  }
  return unicode;
}
