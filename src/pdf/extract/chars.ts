// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): CharInfoChunks and CharView.

// The wasm build always exports FPDFText_GetCharInfoBatch, so the Rust per-character fallback
// getters are not ported: a `CharView` here is the batch record.

import type { CharInfo, TextPage } from "../pdfium/text-page.js";
import type { RectF } from "../pdfium/types.js";
import { f32 } from "../../ocria/rust.js";

/** Raw `CPDF_TextPage::CharType` values of the batch records. */
export const CHAR_TYPE_GENERATED = 1;
export const CHAR_TYPE_NOT_UNICODE = 2;
export const CHAR_TYPE_HYPHEN = 3;

/** Records per `FPDFText_GetCharInfoBatch` call. */
const CHAR_INFO_CHUNK = 16 * 1024;

/** Chunked reader over the batched char-info API. */
export class CharInfoChunks {
  private buf: CharInfo[] = [];
  /** Absolute char index of `buf[0]`. */
  private start = 0;

  constructor(private readonly textPage: TextPage) {}

  /** The record of absolute char index `i`, refilling the chunk on demand; undefined past the end. */
  record(i: number): CharInfo | undefined {
    const off = i - this.start;
    if (off < 0 || off >= this.buf.length) {
      this.buf = this.textPage.charInfosBatch(i, CHAR_INFO_CHUNK);
      this.start = i;
    }
    return this.buf[i - this.start];
  }
}

export function isGenerated(rec: CharInfo): boolean {
  return rec.charType === CHAR_TYPE_GENERATED;
}

export function hasUnicodeMapError(rec: CharInfo): boolean {
  return rec.charType === CHAR_TYPE_NOT_UNICODE;
}

export function isHyphen(rec: CharInfo): boolean {
  return rec.charType === CHAR_TYPE_HYPHEN;
}

/** The char's text-render mode (3 is invisible), or null when it has no text object. */
export function textRenderMode(rec: CharInfo): number | null {
  return rec.textRenderMode >= 0 ? rec.textRenderMode : null;
}

/** The char's text object handle, or null. */
export function textObject(rec: CharInfo): number | null {
  return rec.textObject !== 0 ? rec.textObject : null;
}

/** `CharView::strict_char_box`: the ink box as an f32 rect (page space). */
export function strictCharBox(rec: CharInfo): RectF {
  return { left: f32(rec.left), top: f32(rec.top), right: f32(rec.right), bottom: f32(rec.bottom) };
}

/** Control/PUA/sentinel codepoints that signal a garbage /ToUnicode mapping. */
export function isSuspiciousUnicode(unicode: number): boolean {
  return (
    unicode === 0 ||
    unicode === 0xfffe ||
    unicode === 0xffff ||
    unicode < 0x20 ||
    (unicode >= 0xe000 && unicode <= 0xf8ff)
  );
}

/** `char::from_u32`: the code point as a string, null for a surrogate or past U+10FFFF. */
export function charFromU32(v: number): string | null {
  if (v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) return null;
  return String.fromCodePoint(v);
}

/** `char::is_control`: general category Cc. */

/** `char::is_ascii_alphanumeric`. */
export function isAsciiAlphanumeric(c: string): boolean {
  return /^[0-9A-Za-z]$/.test(c);
}
