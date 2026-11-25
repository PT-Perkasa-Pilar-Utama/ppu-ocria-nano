// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): page_math_spans and math_item.

import { f32 } from "../../ocria/rust.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { textItem } from "../../ocria/types/text-item.js";
import type { GlyphResolver } from "../glyph-resolver/index.js";
import { resolveGlyphName } from "../glyph-names/index.js";
import { Font } from "../pdfium/font.js";
import { imageObjects } from "../pdfium/page-images.js";
import type { PathObject } from "../pdfium/page-paths.js";
import type { Page } from "../pdfium/page.js";
import { transformBounds, transformPoint } from "../pdfium/page.js";
import type { TextPage } from "../pdfium/text-page.js";
import type { RectF } from "../pdfium/types.js";
import { TextClip } from "../text-clip/index.js";
import type { MathSpan, RawChar, RawText, Rule } from "../tex-math/index.js";
import { emitted, isTexMathFont, pageMath, ruleFromBox } from "../tex-math/index.js";
import {
  CharInfoChunks,
  hasUnicodeMapError,
  isGenerated,
  strictCharBox,
  textObject,
  textRenderMode,
} from "./chars.js";
import { isControl } from "../../ocria/rust-extra.js";
import { GlyphDecoder } from "./glyph-decoder.js";
import { adjustAngleForRotation, decomposeScale } from "./misc.js";

/** The math items to splice into a page's text, and the char indices they replace. */
export type PageMath = { items: TextItem[]; consumed: Set<number> };

/** Font facts of one text object. */
type ObjInfo = {
  fontName: string;
  size: number;
  descent: number;
  /** The font, when it has no ToUnicode. */
  noToUnicodeFont: Font | null;
};

/** `math_item`: the text item a math span is spliced in as. */
function mathItem(span: MathSpan): TextItem {
  return textItem({
    text: `$${span.tex}$`,
    x: span.x0,
    y: span.top,
    width: f32(span.x1 - span.x0),
    height: f32(span.bottom - span.top),
    font_size: span.size,
    font_height: span.size,
    math: true,
  });
}

/** The font name of a char: the text object's font, else the char's own font info. */
function charFontName(textPage: TextPage, i: number, font: Font | null): string | null {
  return font?.baseName() ?? textPage.fontInfo(i)?.[0] ?? null;
}

/** Whether any text object of the page uses a TeX math font: most pages have none. */
function hasTexFont(page: Page, textPage: TextPage, charCountN: number): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < charCountN; i++) {
    const obj = textPage.textObject(i);
    const key = obj ?? 0;
    if (seen.has(key)) continue;
    seen.add(key);
    const font = obj === null ? null : Font.fromTextObject(page.lib, obj);
    const name = charFontName(textPage, i, font);
    if (name !== null && isTexMathFont(name)) return true;
  }
  return false;
}

/** The single non-control character a glyph name resolves to, if it resolves to exactly one. */
function namedChar(font: Font, code: number): string | null {
  const name = font.charGlyphName(code);
  const resolved = name === null ? null : resolveGlyphName(name);
  if (resolved === null) return null;
  const cs = Array.from(resolved);
  return cs.length === 1 && !isControl(cs[0]) ? cs[0] : null;
}

/** `page_math_spans`: math spans for a page, or null when the page isn't set in TeX. */
function pageMathSpans(
  page: Page,
  textPage: TextPage,
  viewBox: RectF,
  paths: readonly PathObject[],
  resolver: GlyphResolver | null,
  keepClippedText: boolean
): MathSpan[] | null {
  const charCountN = textPage.charCount();
  if (charCountN <= 0) return null;
  // Most pages have no TeX math font: check each text object's font once before paying for
  // glyph boxes and decoding.
  if (!hasTexFont(page, textPage, charCountN)) return null;
  const clips = new TextClip(page, textPage, keepClippedText);
  const pageRotation = page.rotation();
  const vp = page.viewportTransform(viewBox);
  const [, pageH] = page.viewportSize(viewBox);
  const chunks = new CharInfoChunks(textPage);
  // The same glyph-name recovery as the text pass: a Symbol font with no ToUnicode otherwise
  // reads as Latin ("t" for tau).
  const glyphDecoder = new GlyphDecoder(page.lib, new Set(), resolver);
  const objs = new Map<number, ObjInfo>();
  // (font handle, char code) to glyph-name text.
  const names = new Map<string, string | null>();
  const chars: RawChar[] = [];
  const twoPi = f32(2 * f32(Math.PI));
  for (let i = 0; i < charCountN; i++) {
    const rec = chunks.record(i);
    if (rec === undefined) continue;
    if (isGenerated(rec) || textRenderMode(rec) === 3 || clips.hides(i)) continue;
    // Upright glyphs only.
    const angle = adjustAngleForRotation(Math.max(textPage.angle(i), 0), pageRotation);
    if (angle > f32(0.01) && angle < f32(twoPi - f32(0.01))) continue;
    const obj = textObject(rec);
    const key = obj ?? 0;
    let info = objs.get(key);
    if (info === undefined) {
      const font = obj === null ? null : Font.fromTextObject(page.lib, obj);
      const fs = f32(textPage.fontSize(i));
      const m = textPage.matrix(i);
      const scale = m === null ? 1 : decomposeScale(m)[1];
      const descent = font?.descent(fs) ?? 0;
      info = {
        fontName: charFontName(textPage, i, font) ?? "",
        size: f32(fs * scale),
        descent: f32(descent * scale),
        noToUnicodeFont: font !== null && !font.hasToUnicode() ? font : null,
      };
      objs.set(key, info);
    }
    const unicode = rec.unicode;
    // With no ToUnicode, the encoding's glyph name is the truth: a Symbol font under
    // WinAnsiEncoding + Differences names "tau" for the code PDFium reads as "t".
    let named: string | null = null;
    if (info.noToUnicodeFont !== null) {
      const k = `${info.noToUnicodeFont.handle}:${rec.charCode}`;
      if (!names.has(k)) names.set(k, namedChar(info.noToUnicodeFont, rec.charCode));
      named = names.get(k) ?? null;
    }
    const recovered = glyphDecoder.decode(rec, unicode);
    const decoded = named ?? (recovered === null ? null : (Array.from(recovered)[0] ?? null));
    let text: RawText;
    if (decoded !== null) {
      text = { Unicode: decoded };
    } else if (hasUnicodeMapError(rec) || unicode < 0x20) {
      text = { Code: rec.charCode };
    } else {
      const c =
        unicode <= 0x10ffff && !(unicode >= 0xd800 && unicode <= 0xdfff)
          ? String.fromCodePoint(unicode)
          : null;
      if (c === null) continue;
      text = { Unicode: c };
    }
    const origin = textPage.origin(i);
    if (origin === null) continue;
    const [, originY] = transformPoint(vp, f32(origin[0]), f32(origin[1]));
    const vpLoose = transformBounds(vp, rec.looseBox);
    const ink = transformBounds(vp, strictCharBox(rec));
    chars.push({
      index: i,
      text,
      font_name: info.fontName,
      size: info.size > 0 ? info.size : f32(vpLoose.bottom - vpLoose.top),
      descent: info.descent,
      origin_y: originY,
      x0: vpLoose.left,
      x1: vpLoose.right,
      ink: [ink.top, ink.bottom],
      loose: [vpLoose.top, vpLoose.bottom],
    });
  }
  // Note: PDFium pads a stroked path's bounds by the stroke width on every side (a 0.6pt
  // fraction bar reads 1.2pt tall); take the geometric line.
  const rules: Rule[] = [];
  for (const p of paths) {
    const pad = p.is_stroked ? Math.max(p.stroke_width, 0) : 0;
    const b = p.bbox;
    const x0 = f32(b.left + pad);
    const x1 = Math.max(f32(b.right - pad), x0);
    const top = f32(b.top + pad);
    const bottom = Math.max(f32(b.bottom - pad), top);
    const rule = ruleFromBox(x0, x1, top, bottom, pageH);
    if (rule !== null) rules.push(rule);
  }
  // Note: some PDFs draw rules as stretched 1x1 images.
  for (const { bounds: b } of imageObjects(page, 0, Infinity).images) {
    const rule = ruleFromBox(b.x, f32(b.x + b.width), b.y, f32(b.y + b.height), pageH);
    if (rule !== null) rules.push(rule);
  }
  return pageMath(chars, rules, pageH);
}

/** The `extract_text` closure's math half: math items for a TeX page, and the chars they consume. */
export function pageMathItems(
  page: Page,
  textPage: TextPage,
  viewBox: RectF,
  paths: readonly PathObject[],
  resolver: GlyphResolver | null,
  keepClippedText: boolean
): PageMath {
  const spans = pageMathSpans(page, textPage, viewBox, paths, resolver, keepClippedText) ?? [];
  const [kept, consumed] = emitted(spans);
  return { items: kept.map(mathItem), consumed };
}
