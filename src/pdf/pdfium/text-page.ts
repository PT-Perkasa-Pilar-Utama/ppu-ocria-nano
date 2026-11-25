// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/text_page.rs (crates-v2.21.2, Apache-2.0).
// `TextChar` is a view over (text page, index) in Rust; here the per-character getters take the index.

import { Font } from "./font.js";
import type { Library } from "./library.js";
import type { CharBox, Color, Matrix, RectF, TextRect } from "./types.js";

/** `FPDF_CHARINFO_LP` on wasm32: the record `FPDFText_GetCharInfoBatch` fills (see fpdf_text.h). */
export const CHARINFO_SIZE = 80;
export type CharInfo = {
  textObject: number;
  /** FPDFText_GetCharBox, page space. */
  left: number;
  right: number;
  bottom: number;
  top: number;
  looseBox: RectF;
  fontSize: number;
  unicode: number;
  charCode: number;
  /** Raw `CPDF_TextPage::CharType`: 1 generated, 2 no unicode mapping, 3 hyphen. */
  charType: number;
  /** FPDFTextObj_GetTextRenderMode of the char's text object, -1 when none. */
  textRenderMode: number;
};

/** Extracted text content of a page; call `close()` when done. */
export class TextPage {
  constructor(
    readonly lib: Library,
    readonly handle: number
  ) {}

  charCount(): number {
    return this.lib.m._FPDFText_CountChars(this.handle);
  }

  /**
   * `TextPage::char_infos_batch`: read up to `count` records starting at
   * `start` from the fork's batch export. Returns the records written.
   */
  charInfosBatch(start: number, count: number): CharInfo[] {
    if (count <= 0) return [];
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const buf = s.alloc(count * CHARINFO_SIZE);
      const written = Math.max(0, m._FPDFText_GetCharInfoBatch(this.handle, start, count, buf));
      const out: CharInfo[] = [];
      for (let i = 0; i < written; i++) {
        const p = buf + i * CHARINFO_SIZE;
        out.push({
          textObject: heap.u32(p),
          left: heap.f64(p + 8),
          right: heap.f64(p + 16),
          bottom: heap.f64(p + 24),
          top: heap.f64(p + 32),
          looseBox: {
            left: heap.f32(p + 40),
            top: heap.f32(p + 44),
            right: heap.f32(p + 48),
            bottom: heap.f32(p + 52),
          },
          fontSize: heap.f32(p + 56),
          unicode: heap.u32(p + 60),
          charCode: heap.u32(p + 64),
          charType: heap.i32(p + 68),
          textRenderMode: heap.i32(p + 72),
        });
      }
      return out;
    });
  }

  /** `TextPage::count_rects`; call before `rect()`. */
  countRects(start: number, count: number): number {
    return this.lib.m._FPDFText_CountRects(this.handle, start, count);
  }

  /** `TextPage::rect`: a rectangle from the last `countRects` call. */
  rect(index: number): TextRect | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(32);
      if (m._FPDFText_GetRect(this.handle, index, p, p + 8, p + 16, p + 24) === 0) return null;
      return {
        left: heap.f64(p),
        top: heap.f64(p + 8),
        right: heap.f64(p + 16),
        bottom: heap.f64(p + 24),
      };
    });
  }

  /** `TextPage::bounded_text`: the text inside a page-space rectangle. */
  boundedText(left: number, top: number, right: number, bottom: number): string {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const len = m._FPDFText_GetBoundedText(this.handle, left, top, right, bottom, 0, 0);
      if (len <= 0) return "";
      const bufLen = len + 1;
      const buf = s.alloc(bufLen * 2);
      const written = m._FPDFText_GetBoundedText(
        this.handle,
        left,
        top,
        right,
        bottom,
        buf,
        bufLen
      );
      if (written <= 0) return "";
      const end = heap.m.HEAPU16[(buf >> 1) + written - 1] === 0 ? written - 1 : written;
      return heap.utf16(buf, end);
    });
  }

  /** `TextPage::get_text`. */
  getText(start: number, count: number): string {
    if (count <= 0) return "";
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const buf = s.alloc((count + 1) * 2);
      const written = m._FPDFText_GetText(this.handle, start, count, buf);
      if (written <= 0) return "";
      const end = heap.m.HEAPU16[(buf >> 1) + written - 1] === 0 ? written - 1 : written;
      return heap.utf16(buf, end);
    });
  }

  /** `TextChar::origin`: the glyph's origin in page space. */
  origin(index: number): [number, number] | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(16);
      if (m._FPDFText_GetCharOrigin(this.handle, index, p, p + 8) === 0) return null;
      return [heap.f64(p), heap.f64(p + 8)];
    });
  }

  unicode(index: number): number {
    return this.lib.m._FPDFText_GetUnicode(this.handle, index) >>> 0;
  }

  /** The raw character code from the content stream; meaningful for non-generated characters only. */
  charCode(index: number): number {
    return this.lib.m._FPDFText_GetCharCode(this.handle, index) >>> 0;
  }

  fontSize(index: number): number {
    return this.lib.m._FPDFText_GetFontSize(this.handle, index);
  }

  fontWeight(index: number): number {
    return this.lib.m._FPDFText_GetFontWeight(this.handle, index);
  }

  /** `TextChar::font_info`: the font name and flags. */
  fontInfo(index: number): [string, number] | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const flags = s.alloc(4);
      const len = m._FPDFText_GetFontInfo(this.handle, index, 0, 0, flags) >>> 0;
      if (len === 0) return null;
      const buf = s.alloc(len);
      const written = m._FPDFText_GetFontInfo(this.handle, index, buf, len, flags) >>> 0;
      if (written === 0) return null;
      const strLen = heap.m.HEAPU8[buf + written - 1] === 0 ? written - 1 : written;
      return [new TextDecoder().decode(heap.m.HEAPU8.subarray(buf, buf + strLen)), heap.i32(flags)];
    });
  }

  /** Angle in radians; -1 on error. */
  angle(index: number): number {
    return this.lib.m._FPDFText_GetCharAngle(this.handle, index);
  }

  /** The text object (FPDF_PAGEOBJECT) of a character, or null. */
  textObject(index: number): number | null {
    const obj = this.lib.m._FPDFText_GetTextObject(this.handle, index);
    return obj === 0 ? null : obj;
  }

  /** `TextChar::font_space_width`: the advance of an ASCII space in this character's font, per em. */
  fontSpaceWidth(index: number): number | null {
    const obj = this.textObject(index);
    if (obj === null) return null;
    const font = Font.fromTextObject(this.lib, obj);
    if (font === null) return null;
    const w = font.glyphWidthFromCharCode(0x20, 1);
    if (w !== null && w > 0) return w;
    const u = font.glyphWidth(0x20, 1);
    return u !== null && u > 0 ? u : null;
  }

  strokeColor(index: number): Color | null {
    return this.color(index, "_FPDFText_GetStrokeColor");
  }

  fillColor(index: number): Color | null {
    return this.color(index, "_FPDFText_GetFillColor");
  }

  private color(
    index: number,
    fn: "_FPDFText_GetStrokeColor" | "_FPDFText_GetFillColor"
  ): Color | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(16);
      if (m[fn](this.handle, index, p, p + 4, p + 8, p + 12) === 0) return null;
      // `as u8` keeps the low byte.
      return {
        r: heap.u32(p) & 0xff,
        g: heap.u32(p + 4) & 0xff,
        b: heap.u32(p + 8) & 0xff,
        a: heap.u32(p + 12) & 0xff,
      };
    });
  }

  /** The raw FPDF_TEXT_RENDERMODE of the character's text object (3 is invisible), or null. */
  textRenderMode(index: number): number | null {
    const obj = this.textObject(index);
    if (obj === null) return null;
    const mode = this.lib.m._FPDFTextObj_GetTextRenderMode(obj);
    return mode >= 0 ? mode : null;
  }

  /** The marked content id of the character's text object, or null. */
  markedContentId(index: number): number | null {
    const obj = this.textObject(index);
    if (obj === null) return null;
    const mcid = this.lib.m._FPDFPageObj_GetMarkedContentID(obj);
    return mcid >= 0 ? mcid : null;
  }

  charBox(index: number): CharBox | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(32);
      if (m._FPDFText_GetCharBox(this.handle, index, p, p + 8, p + 16, p + 24) === 0) return null;
      return {
        left: heap.f64(p),
        right: heap.f64(p + 8),
        bottom: heap.f64(p + 16),
        top: heap.f64(p + 24),
      };
    });
  }

  looseCharBox(index: number): RectF | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(16);
      if (m._FPDFText_GetLooseCharBox(this.handle, index, p) === 0) return null;
      return {
        left: heap.f32(p),
        top: heap.f32(p + 4),
        right: heap.f32(p + 8),
        bottom: heap.f32(p + 12),
      };
    });
  }

  matrix(index: number): Matrix | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(24);
      if (m._FPDFText_GetMatrix(this.handle, index, p) === 0) return null;
      return {
        a: heap.f32(p),
        b: heap.f32(p + 4),
        c: heap.f32(p + 8),
        d: heap.f32(p + 12),
        e: heap.f32(p + 16),
        f: heap.f32(p + 20),
      };
    });
  }

  isGenerated(index: number): boolean {
    return this.lib.m._FPDFText_IsGenerated(this.handle, index) === 1;
  }

  /** A hyphen pdfium found at the end of a line; its unicode reads as 0x02. */
  isHyphen(index: number): boolean {
    return this.lib.m._FPDFText_IsHyphen(this.handle, index) === 1;
  }

  hasUnicodeMapError(index: number): boolean {
    return this.lib.m._FPDFText_HasUnicodeMapError(this.handle, index) === 1;
  }

  close(): void {
    this.lib.m._FPDFText_ClosePage(this.handle);
  }
}
