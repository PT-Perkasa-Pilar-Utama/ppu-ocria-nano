// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/font.rs (crates-v2.21.2, Apache-2.0).

import type { Library } from "./library.js";

/** PDFium's FPDF_FONT_TYPE values (fpdf_edit.h). */
export type FontType =
  | "Unknown"
  | "Type1"
  | "TrueType"
  | "Type0"
  | "Type3"
  | "CidType0"
  | "CidType2";

const FONT_TYPES: ReadonlyMap<number, FontType> = new Map([
  [1, "Type1"],
  [2, "TrueType"],
  [3, "Type0"],
  [4, "Type3"],
  [5, "CidType0"],
  [6, "CidType2"],
]);

/** A borrowed font handle from a text object: it does not own the font. */
export class Font {
  private constructor(
    private readonly lib: Library,
    readonly handle: number
  ) {}

  /** `Font::from_text_object`: null when the object has no font. */
  static fromTextObject(lib: Library, obj: number): Font | null {
    const handle = lib.m._FPDFTextObj_GetFont(obj);
    return handle === 0 ? null : new Font(lib, handle);
  }

  /** A NUL-terminated byte string through pdfium's query-then-fill protocol. */
  private cstring(fn: (buf: number, len: number) => number): string | null {
    const { heap } = this.lib;
    return heap.scoped((s) => {
      const len = fn(0, 0) >>> 0;
      if (len === 0) return null;
      const buf = s.alloc(len);
      const written = fn(buf, len) >>> 0;
      if (written === 0) return null;
      const strLen = heap.m.HEAPU8[buf + written - 1] === 0 ? written - 1 : written;
      return new TextDecoder().decode(heap.m.HEAPU8.subarray(buf, buf + strLen));
    });
  }

  /** The base font name (PostScript name, subset prefix stripped by pdfium). */
  baseName(): string | null {
    return this.cstring((buf, len) => this.lib.m._FPDFFont_GetBaseFontName(this.handle, buf, len));
  }

  fontType(): FontType {
    return FONT_TYPES.get(this.lib.m._FPDFFont_GetType(this.handle)) ?? "Unknown";
  }

  isEmbedded(): boolean {
    return this.lib.m._FPDFFont_GetIsEmbedded(this.handle) !== 0;
  }

  private float(fn: (out: number) => number): number | null {
    const { heap } = this.lib;
    return heap.scoped((s) => {
      const out = s.alloc(4);
      return fn(out) !== 0 ? heap.f32(out) : null;
    });
  }

  ascent(fontSize: number): number | null {
    return this.float((out) => this.lib.m._FPDFFont_GetAscent(this.handle, fontSize, out));
  }

  descent(fontSize: number): number | null {
    return this.float((out) => this.lib.m._FPDFFont_GetDescent(this.handle, fontSize, out));
  }

  /** The glyph width for a raw character code. */
  glyphWidthFromCharCode(charCode: number, fontSize: number): number | null {
    return this.float((out) =>
      this.lib.m._FPDFFont_GetGlyphWidthFromCharCode(this.handle, charCode, fontSize, out)
    );
  }

  /** The glyph width for a Unicode code point. */
  glyphWidth(unicode: number, fontSize: number): number | null {
    return this.float((out) =>
      this.lib.m._FPDFFont_GetGlyphWidth(this.handle, unicode, fontSize, out)
    );
  }

  /**
   * `Font::glyph_path_segments`: `[segment_type, x, y]` per path segment of
   * the glyph for `charCode` (LINETO=0, BEZIERTO=1, MOVETO=2). null when the
   * font has no outline for it.
   */
  glyphPathSegments(charCode: number, fontSize: number): Array<[number, number, number]> | null {
    const { m, heap } = this.lib;
    const glyphPath = m._FPDFFont_GetGlyphPathFromCharCode(this.handle, charCode, fontSize);
    if (glyphPath === 0) return null;
    const count = m._FPDFGlyphPath_CountGlyphSegments(glyphPath);
    const segments: Array<[number, number, number]> = [];
    heap.scoped((s) => {
      const xy = s.alloc(8);
      for (let i = 0; i < count; i++) {
        const segment = m._FPDFGlyphPath_GetGlyphPathSegment(glyphPath, i);
        if (segment === 0) break;
        const type = m._FPDFPathSegment_GetType(segment);
        if (type === -1) continue;
        const ok = m._FPDFPathSegment_GetPoint(segment, xy, xy + 4) !== 0;
        segments.push([type, ok ? heap.f32(xy) : 0, ok ? heap.f32(xy + 4) : 0]);
      }
    });
    return segments;
  }

  /** Whether the font dictionary defines a /ToUnicode CMap. */
  hasToUnicode(): boolean {
    return this.lib.m._FPDFFont_HasToUnicode(this.handle) !== 0;
  }

  /** The /Encoding name ("WinAnsiEncoding", "Identity-H"), /BaseEncoding for a dict, or "Custom". */
  encoding(): string | null {
    return this.cstring((buf, len) => this.lib.m._FPDFFont_GetEncoding(this.handle, buf, len));
  }

  /** The PostScript glyph name the font assigns to a raw char code. */
  charGlyphName(charCode: number): string | null {
    return this.cstring((buf, len) =>
      this.lib.m._FPDFFont_GetCharGlyphName(this.handle, charCode, buf, len)
    );
  }

  /** The glyph index in the embedded font program for a raw char code. */
  charGlyphIndex(charCode: number): number | null {
    const idx = this.lib.m._FPDFFont_GetCharGlyphIndex(this.handle, charCode);
    return idx >= 0 ? idx : null;
  }

  /** The embedded font program bytes (decompressed FontFile stream, or the substitute font data). */
  fontData(): Uint8Array | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const outLen = s.alloc(4);
      if (m._FPDFFont_GetFontData(this.handle, 0, 0, outLen) === 0) return null;
      const size = heap.u32(outLen);
      if (size === 0) return null;
      const buf = s.alloc(size);
      if (m._FPDFFont_GetFontData(this.handle, buf, size, outLen) === 0) return null;
      const written = heap.u32(outLen);
      return written === 0 ? null : heap.bytes(buf, Math.min(written, size));
    });
  }
}
