// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): GlyphDecoder.

// Per-page glyph-name-based unicode recovery. When a font has no /ToUnicode CMap, PDFium derives
// unicode from the encoding alone: garbage for custom or Identity encodings, and guessed
// control-code expansions for ligatures. The PostScript glyph name the font assigns to the
// charcode, resolved against the Adobe Glyph List, is the authoritative signal in both cases.

import { reverseCmap } from "../font-cmap/index.js";
import type { CharInfo } from "../pdfium/text-page.js";
import { Font } from "../pdfium/font.js";
import type { Library } from "../pdfium/library.js";
import { presentationFormExpansion, resolveGlyphName } from "../glyph-names/index.js";
import type { GlyphResolver } from "../glyph-resolver/index.js";
import { GLYPH_RESOLVER_FONT_SIZE } from "../glyph-resolver/index.js";
import { charFromU32, hasUnicodeMapError, textObject } from "./chars.js";
import { isControl } from "../../ocria/rust-extra.js";
import { isBuggyFont } from "./font-flags.js";

type FontGlyphInfo = {
  font: Font;
  /**
   * No /ToUnicode and no standard base encoding (or the prescan flagged the ToUnicode as garbage):
   * PDFium's unicode values for this font are untrusted, so every charcode gets a recovery try.
   */
  untrusted: boolean;
  /**
   * The font's name matches the buggy-subset heuristic while it declares a standard base encoding:
   * the encoding is a lie, so glyph names derived from it are as wrong as the unicode.
   */
  encodingLies: boolean;
  /** charcode to resolved replacement text (null: unrecoverable). */
  cache: Map<number, string | null>;
  /** glyph_index to unicode from the embedded font program; undefined until built, null when unavailable. */
  reverseCmap: Map<number, number> | null | undefined;
};

const STANDARD_ENCODINGS = new Set([
  "WinAnsiEncoding",
  "MacRomanEncoding",
  "MacExpertEncoding",
  "StandardEncoding",
]);

export class GlyphDecoder {
  private readonly fonts = new Map<number, FontGlyphInfo>();
  /** Chars arrive in runs per text object: the last object's font key skips FPDFTextObj_GetFont. */
  private lastObj = 0;
  private lastKey = 0;

  constructor(
    private readonly lib: Library,
    /** Font handles whose /ToUnicode the prescan flagged as garbage. */
    private readonly garbageFonts: ReadonlySet<number>,
    /** Last-resort recovery hook for glyphs the built-in recovery could not decode. */
    private readonly resolver: GlyphResolver | null
  ) {}

  /**
   * Replacement text for this char when its glyph name resolves and the current unicode is
   * suspicious (control/PUA/sentinel/map-error) or the font's unicode mapping is untrusted altogether.
   */
  decode(rec: CharInfo, unicode: number): string | null {
    const cheapSuspicious =
      unicode === 0 ||
      unicode === 0xfffe ||
      unicode === 0xffff ||
      (unicode < 0x20 && unicode !== 0x09 && unicode !== 0x0a && unicode !== 0x0d) ||
      (unicode >= 0xe000 && unicode <= 0xf8ff);

    const objPtr = textObject(rec);
    if (objPtr === null) return null;
    let key: number;
    if (objPtr === this.lastObj) {
      key = this.lastKey;
    } else {
      const font = Font.fromTextObject(this.lib, objPtr);
      if (font === null) return null;
      key = font.handle;
      if (!this.fonts.has(key))
        this.fonts.set(key, this.fontInfo(font, this.garbageFonts.has(key)));
      this.lastObj = objPtr;
      this.lastKey = key;
    }
    const info = this.fonts.get(key);
    if (info === undefined) return null;

    // The map-error check is the expensive part of "suspicious": consult it last.
    if (!info.untrusted && !cheapSuspicious && !hasUnicodeMapError(rec)) return null;

    const charCode = rec.charCode;
    let resolved = info.cache.get(charCode);
    if (resolved === undefined) {
      resolved = this.recover(info, charCode, unicode);
      info.cache.set(charCode, resolved);
    }
    // Do not double-expand a ligature PDFium already split: with no /ToUnicode PDFium derives
    // per-char unicodes from the glyph names itself, so a clean char that is part of the resolved
    // string means PDFium did the expansion. Suspicious-char recoveries still expand.
    if (resolved !== null && [...resolved].length > 1 && !cheapSuspicious) {
      const u = charFromU32(unicode);
      if (u !== null && resolved.includes(u)) return null;
    }
    return resolved;
  }

  private fontInfo(font: Font, garbage: boolean): FontGlyphInfo {
    const hasToUnicode = font.hasToUnicode();
    const encoding = font.encoding();
    // Embedded subset fonts whose name matches the buggy-font heuristic routinely lie about their
    // encoding: PDFium's unicode for them looks plausible, so flag the whole font untrusted.
    const baseName = font.baseName();
    const nameBuggy =
      font.isEmbedded() && baseName !== null && isBuggyFont(baseName, font.fontType());
    const untrusted =
      garbage ||
      nameBuggy ||
      (!hasToUnicode && !(encoding !== null && STANDARD_ENCODINGS.has(encoding)));
    return { font, untrusted, encodingLies: nameBuggy, cache: new Map(), reverseCmap: undefined };
  }

  private recover(info: FontGlyphInfo, charCode: number, unicode: number): string | null {
    const { font } = info;
    const name = font.charGlyphName(charCode);
    // Glyph names of buggy-subset fonts derive from a lying base encoding, so name recovery is
    // skipped for them and the embedded-cmap / outline-hash resolver get the chance to correct the glyph.
    let resolved: string | null = null;
    if (!info.encodingLies && name !== null) {
      const r = resolveGlyphName(name);
      if (r !== null && [...r].every((c) => !isControl(c))) resolved = r;
    }
    resolved ??= this.reverseCmapText(info, charCode, unicode);
    resolved ??= this.resolveByOutline(font, charCode);
    return resolved;
  }

  /** Reverse-map the glyph index through the embedded font program's own cmap table. */
  private reverseCmapText(info: FontGlyphInfo, charCode: number, unicode: number): string | null {
    const glyph = info.font.charGlyphIndex(charCode);
    if (glyph === null) return null;
    if (info.reverseCmap === undefined) {
      const data = info.font.fontData();
      info.reverseCmap = data === null ? null : reverseCmap(data);
    }
    if (info.reverseCmap === null) return null;
    const u = info.reverseCmap.get(glyph);
    if (u === undefined) return null;
    if (u >= 0xe000 && u <= 0xf8ff) return null;
    // Synthetic subset cmaps just echo the charcode back (charcode-identity, not semantic unicode).
    if (u === charCode && u !== unicode) return null;
    const c = charFromU32(u);
    if (c === null || isControl(c)) return null;
    return presentationFormExpansion(c) ?? c;
  }

  /** Last resort: hand the glyph's vector outline to the injected resolver. */
  private resolveByOutline(font: Font, charCode: number): string | null {
    if (this.resolver === null) return null;
    const segments = font.glyphPathSegments(charCode, GLYPH_RESOLVER_FONT_SIZE);
    if (segments === null) return null;
    const text = this.resolver.resolve(segments);
    if (text === null || text === "" || [...text].some(isControl)) return null;
    return text;
  }
}
