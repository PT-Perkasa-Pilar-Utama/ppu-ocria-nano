// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): ObjTextMeta and ObjMetaCache.

// Text metadata that is constant across one text object, captured once and reused by every segment
// that starts inside it.

import { f32 } from "../../ocria/rust.js";
import { Font } from "../pdfium/font.js";
import type { Library } from "../pdfium/library.js";
import type { TextPage } from "../pdfium/text-page.js";
import { isBuggyFont } from "./font-flags.js";
import { colorToArgbHex, decomposeScale } from "./misc.js";

export type ObjTextMeta = {
  fontName: string | null;
  fontFlags: number | null;
  fontWeight: number | null;
  /** Raw pdfium font size for the object; <= 0 means unavailable (the segment falls back to its loose-box height). */
  fontSize: number;
  /** Ascent and descent at `fontSize`; null when the font is missing or `fontSize <= 0`. */
  fontAscent: number | null;
  fontDescent: number | null;
  /** Vertical scale of the char matrix (`font_height = font_size * scale_y`). */
  scaleY: number | null;
  fontIsEmbedded: boolean;
  /** Buggy-by-name verdict (embedded and a known-bad name or type). */
  fontNameIsBuggy: boolean;
  font: Font | null;
  fillColor: string | null;
  strokeColor: string | null;
  mcid: number | null;
  /** Advance width of the ASCII space in this object's font, per em. */
  fontSpaceWidth: number | null;
};

/** Font-level constants shared by every text object using the same font, keyed by FPDF_FONT handle. */
type FontMeta = {
  baseName: string | null;
  /** The name from FPDFText_GetFontInfo, used only when the font exposes no base name. */
  infoName: string | null;
  flags: number | null;
  weight: number | null;
  isEmbedded: boolean;
  nameIsBuggy: boolean;
  spaceWidthPerEm: number | null;
};

export class ObjMetaCache {
  private lastObj = 0;
  private last: ObjTextMeta | null = null;
  private readonly fonts = new Map<number, FontMeta>();
  /** `handle:font_size` to `[ascent, descent]`. */
  private readonly metrics = new Map<string, [number | null, number | null]>();

  constructor(
    private readonly lib: Library,
    private readonly textPage: TextPage
  ) {}

  /** `meta_for`: the metadata of char `index`, whose text object is `objPtr`. */
  metaFor(index: number, objPtr: number | null): ObjTextMeta {
    const key = objPtr ?? 0;
    if (key !== 0 && key === this.lastObj && this.last !== null) return this.last;
    const meta = this.build(index, objPtr);
    this.lastObj = key;
    this.last = meta;
    return meta;
  }

  private fontMeta(f: Font, index: number): FontMeta {
    const cached = this.fonts.get(f.handle);
    if (cached) return cached;
    const tp = this.textPage;
    const baseName = f.baseName();
    let isEmbedded = false;
    let nameIsBuggy = false;
    if (baseName !== null) {
      isEmbedded = f.isEmbedded();
      nameIsBuggy = isEmbedded && isBuggyFont(baseName, f.fontType());
    }
    const info = tp.fontInfo(index);
    const weight = tp.fontWeight(index);
    // Same probe order as `TextChar::font_space_width`.
    let spaceWidthPerEm = f.glyphWidthFromCharCode(0x20, 1);
    if (spaceWidthPerEm === null || !(spaceWidthPerEm > 0)) {
      const w = f.glyphWidth(0x20, 1);
      spaceWidthPerEm = w !== null && w > 0 ? w : null;
    }
    const meta: FontMeta = {
      baseName,
      infoName: info ? info[0] : null,
      flags: info ? info[1] : null,
      weight: weight > 0 ? weight : null,
      isEmbedded,
      nameIsBuggy,
      spaceWidthPerEm,
    };
    this.fonts.set(f.handle, meta);
    return meta;
  }

  private build(index: number, objPtr: number | null): ObjTextMeta {
    const tp = this.textPage;
    const font = objPtr === null ? null : Font.fromTextObject(this.lib, objPtr);
    const fs = f32(tp.fontSize(index));
    let fontName: string | null = null;
    let fontFlags: number | null = null;
    let fontWeight: number | null;
    let fontSpaceWidth: number | null;
    let fontIsEmbedded = false;
    let fontNameIsBuggy = false;
    let fontAscent: number | null = null;
    let fontDescent: number | null = null;
    if (font !== null) {
      const fm = this.fontMeta(font, index);
      fontName = fm.baseName ?? fm.infoName;
      fontFlags = fm.flags;
      fontWeight = fm.weight;
      fontIsEmbedded = fm.isEmbedded;
      fontNameIsBuggy = fm.nameIsBuggy;
      fontSpaceWidth = fm.spaceWidthPerEm;
      if (fs > 0) {
        const mk = `${font.handle}:${fs}`;
        let am = this.metrics.get(mk);
        if (am === undefined) {
          am = [font.ascent(fs), font.descent(fs)];
          this.metrics.set(mk, am);
        }
        [fontAscent, fontDescent] = am;
      }
    } else {
      const info = tp.fontInfo(index);
      if (info) [fontName, fontFlags] = info;
      const weight = tp.fontWeight(index);
      fontWeight = weight > 0 ? weight : null;
      fontSpaceWidth = null;
    }
    let scaleY: number | null = null;
    if (objPtr !== null) {
      const m = tp.matrix(index);
      if (m) scaleY = decomposeScale(m)[1];
    }
    const stroke = tp.strokeColor(index);
    const fill = tp.fillColor(index);
    return {
      fontName,
      fontFlags,
      fontWeight,
      fontSize: fs,
      fontAscent,
      fontDescent,
      scaleY,
      fontIsEmbedded,
      fontNameIsBuggy,
      font,
      fillColor: fill ? colorToArgbHex(fill) : null,
      strokeColor: stroke ? colorToArgbHex(stroke) : null,
      mcid: tp.markedContentId(index),
      fontSpaceWidth,
    };
  }
}
