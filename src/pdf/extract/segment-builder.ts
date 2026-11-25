// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): SegmentBuilder.

import { isRtlChar } from "../../ocria/bidi.js";
import { f32, isAlphabetic, trim } from "../../ocria/rust.js";
import type { Font } from "../pdfium/font.js";
import type { CharInfo, TextPage } from "../pdfium/text-page.js";
import type { RectF } from "../pdfium/types.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { hasUnicodeMapError, isGenerated } from "./chars.js";
import { isBuggyCodepoint } from "./font-flags.js";
import { adjustAngleForRotation, PI32, toDegrees } from "./misc.js";
import type { ObjTextMeta } from "./obj-meta.js";
import { clampedVerticalBounds, countsAsUnmapped } from "./segment-bounds.js";
import { WordTracker } from "./segment-words.js";
import { segmentItem } from "./segment-item.js";
import { placeRtlMark } from "./segment-rtl.js";

const F32_MAX = 3.4028234663852886e38;

/** Accumulates characters into a single TextItem segment. */
export class SegmentBuilder extends WordTracker {
  text = "";
  // Viewport-space bounding box (union of loose bounds, top-left origin)
  vpLeft: number = F32_MAX;
  vpRight: number = -F32_MAX;
  vpTop: number = F32_MAX;
  vpBottom: number = -F32_MAX;
  // Right edge of the last char's strict bounds (gap calculation), and of its LOOSE bounds (advance-relative gap)
  lastCharRight: number = -F32_MAX;
  lastCharLooseRight: number = -F32_MAX;
  // Left edges of the same boxes: right-to-left runs advance leftward, so their trailing edge is the LEFT one.
  lastCharLeft: number = F32_MAX;
  lastCharLooseLeft: number = F32_MAX;
  /** Writing direction latched from the first strong-direction character; leading neutrals leave it null. */
  dirRtl: boolean | null = null;
  lastCharBottom: number = -F32_MAX;
  /** Viewport-space baseline (glyph origin y) of the last char, when PDFium reports one. */
  lastCharBaseline: number | null = null;
  lastCharLooseHeight: number = 0;
  /** Count of non-space characters (for the average width). */
  charCount: number = 0;
  /** Characters whose Unicode came from PDFium's char-code fallback (no usable ToUnicode or glyph-name mapping). */
  unmappedCharCount: number = 0;
  fontName: string | null = null;
  fontSize: number = 0;
  fontHeight: number | null = null;
  fontAscent: number | null = null;
  fontDescent: number | null = null;
  fontWeight: number | null = null;
  fontFlags: number | null = null;
  fontIsBuggy: boolean = false;
  fontIsEmbedded: boolean = false;
  font: Font | null = null;
  rotationDeg: number = 0;
  textWidth: number = 0;
  mcid: number | null = null;
  fillColor: string | null = null;
  strokeColor: string | null = null;
  charCodes: number[] = [];
  pendingSpaceCharCodes: number[] = [];
  pendingSpaceGenerated: boolean = false;
  hasContent: boolean = false;
  pendingSpace: boolean = false;
  rtlSpans: Array<[number, number, number]> = [];
  /** Set on a run split off at a size step into smaller raised or lowered type: the host segment's `[top, bottom]`. */
  hostBand: [number, number] | null = null;
  /** The last run that took a host band: `[top, bottom, right edge]`. */
  lastScript: [number, number, number] | null = null;

  constructor(
    emitWords: boolean,
    readonly extractTextMetadata: boolean
  ) {
    super(emitWords);
  }

  /** `*self = Self::new(..)`. */
  private reset(): void {
    const fresh = new SegmentBuilder(this.emitWords, this.extractTextMetadata);
    Object.assign(this, fresh);
  }

  /**
   * Gap from the segment's last character to the incoming one, along the writing direction against
   * the previous char's trailing edge. Positive means further along the line, negative means doubled back.
   */
  gapTo(vpStrict: RectF, c: string): number {
    if (this.dirIsRtl(c)) return f32(this.lastCharLeft - vpStrict.right);
    return f32(vpStrict.left - this.lastCharRight);
  }

  /** As `gapTo` against the previous char's LOOSE box, which subtracts out kerning and overhang. */
  looseGapTo(vpStrict: RectF, c: string): number {
    if (this.dirIsRtl(c)) return f32(this.lastCharLooseLeft - vpStrict.right);
    return f32(vpStrict.left - this.lastCharLooseRight);
  }

  private dirIsRtl(c: string): boolean {
    return this.dirRtl ?? isRtlChar(c);
  }

  private noteDirection(c: string): void {
    if (isRtlChar(c)) this.dirRtl = true;
    else if (isAlphabetic(c)) this.dirRtl = false;
  }

  /** Average width of non-space characters: glyph widths when known, else the bbox width. */
  avgCharWidth(): number {
    if (this.charCount === 0) return 5;
    if (this.textWidth > 0) return f32(this.textWidth / f32(this.charCount));
    return f32(f32(this.vpRight - this.vpLeft) / f32(this.charCount));
  }

  /** Start a new segment with the character at `index`; `meta` carries the text-object-level metadata. */
  start(
    c: string,
    vpLoose: RectF,
    vpStrict: RectF,
    baseline: number | null,
    tp: TextPage,
    index: number,
    rec: CharInfo,
    recovered: boolean,
    pageRotation: number,
    meta: ObjTextMeta
  ): void {
    // A run in smaller raised or lowered type keeps its host's band past a space or other break
    // while it stays in that type on that line; full-size type ends it.
    const smallInside = (top: number, bottom: number): boolean => {
      const mid = f32(f32(vpLoose.top + vpLoose.bottom) * f32(0.5));
      return (
        mid > top &&
        mid < bottom &&
        Math.abs(f32(vpLoose.bottom - vpLoose.top)) < f32(f32(0.85) * Math.abs(f32(bottom - top)))
      );
    };
    let band: [number, number] | null = this.hostBand;
    if (band !== null && !smallInside(band[0], band[1])) band = null;
    if (band === null && this.lastScript !== null) {
      const [top, bottom, right] = this.lastScript;
      const near =
        vpLoose.left >= f32(right - 1) &&
        f32(vpLoose.left - right) < f32(2 * Math.abs(f32(bottom - top)));
      band = near && smallInside(top, bottom) ? [top, bottom] : null;
    }
    this.hostBand = band;

    this.text = c;
    this.rtlSpans = [];
    if (isRtlChar(c)) this.rtlSpans.push([this.text.length, vpLoose.left, vpLoose.right]);
    // A run's first glyph keeps its loose box even when its metrics are pathological; glyphs joining a run are clamped in `pushChar`.
    this.vpLeft = vpLoose.left;
    this.vpRight = vpLoose.right;
    this.vpTop = vpLoose.top;
    this.vpBottom = vpLoose.bottom;
    this.lastCharRight = vpStrict.right;
    this.lastCharLooseRight = vpLoose.right;
    this.lastCharLeft = vpStrict.left;
    this.lastCharLooseLeft = vpLoose.left;
    this.lastCharBottom = vpStrict.bottom;
    this.lastCharBaseline = baseline;
    this.lastCharLooseHeight = Math.abs(f32(vpLoose.bottom - vpLoose.top));
    this.dirRtl = null;
    this.noteDirection(c);
    this.charCount = 1;
    this.unmappedCharCount = countsAsUnmapped(recovered, hasUnicodeMapError(rec)) ? 1 : 0;
    this.hasContent = true;
    this.pendingSpace = false;
    if (this.extractTextMetadata) this.pendingSpaceCharCodes = [];
    this.pendingSpaceGenerated = false;
    this.words = [];
    this.wordHas = false;
    this.addWordChar(c, vpLoose);
    this.textWidth = 0;
    if (this.extractTextMetadata) this.charCodes = [rec.charCode];
    this.fontIsBuggy = false;
    this.fontIsEmbedded = false;
    this.font = null;

    // Font info (object/font-level, precomputed in `meta`)
    this.fontName = meta.fontName;
    this.fontFlags = meta.fontFlags;
    const fs = meta.fontSize;
    this.fontSize = fs > 0 ? fs : Math.abs(f32(vpLoose.bottom - vpLoose.top));
    this.fontWeight = meta.fontWeight;

    // PDFium's per-char angle ignores the sign of the font size: a negative `Tf` scales glyph space
    // by -1 on both axes, a 180 degree rotation, so fold the sign back in.
    const angleRad = tp.angle(index);
    if (angleRad >= 0) {
      const visual = meta.fontSize < 0 ? f32(angleRad + PI32) : angleRad;
      this.rotationDeg = toDegrees(adjustAngleForRotation(visual, pageRotation));
    } else {
      this.rotationDeg = 0;
    }

    // Font object for ascent, descent, glyph widths and buggy detection
    if (meta.font !== null) {
      this.fontIsEmbedded = meta.fontIsEmbedded;
      if (meta.fontNameIsBuggy) this.fontIsBuggy = true;
      if (fs > 0) {
        this.fontAscent = meta.fontAscent;
        this.fontDescent = meta.fontDescent;
      } else {
        // Metrics scale with the effective size, which fell back to this segment's loose-box height.
        this.fontAscent = meta.font.ascent(this.fontSize);
        this.fontDescent = meta.font.descent(this.fontSize);
      }
      const w = meta.font.glyphWidthFromCharCode(rec.charCode, this.fontSize);
      if (w !== null) this.textWidth = f32(this.textWidth + w);
      this.font = meta.font;
    }

    // fontHeight = fontSize * scaleY
    if (meta.scaleY !== null) this.fontHeight = f32(this.fontSize * meta.scaleY);

    this.strokeColor = meta.strokeColor;
    this.fillColor = meta.fillColor;
    this.mcid = meta.mcid;

    if (!this.fontIsBuggy && this.fontIsEmbedded && isBuggyCodepoint(rec.unicode))
      this.fontIsBuggy = true;
  }

  /** Add a visible character to the current segment. */
  pushChar(
    c: string,
    vpLoose: RectF,
    vpStrict: RectF,
    baseline: number | null,
    rec: CharInfo,
    recovered: boolean
  ): void {
    if (placeRtlMark(this, c, vpLoose)) {
      // The box still covers the mark; the trailing-edge fields stay on the last letter, so the next char's gap is measured from it.
      this.vpLeft = Math.min(this.vpLeft, vpLoose.left);
      this.vpRight = Math.max(this.vpRight, vpLoose.right);
      this.vpTop = Math.min(this.vpTop, vpLoose.top);
      this.vpBottom = Math.max(this.vpBottom, vpLoose.bottom);
      this.charCount += 1;
      return;
    }
    this.text += c;
    if (isRtlChar(c)) this.rtlSpans.push([this.text.length, vpLoose.left, vpLoose.right]);
    const [effTop, effBottom] = clampedVerticalBounds(vpLoose, vpStrict);
    this.addWordChar(c, {
      left: vpLoose.left,
      top: effTop,
      right: vpLoose.right,
      bottom: effBottom,
    });
    this.vpLeft = Math.min(this.vpLeft, vpLoose.left);
    this.vpRight = Math.max(this.vpRight, vpLoose.right);
    this.vpTop = Math.min(this.vpTop, effTop);
    this.vpBottom = Math.max(this.vpBottom, effBottom);
    this.lastCharRight = vpStrict.right;
    this.lastCharLooseRight = vpLoose.right;
    this.lastCharLeft = vpStrict.left;
    this.lastCharLooseLeft = vpLoose.left;
    this.lastCharBottom = vpStrict.bottom;
    this.lastCharBaseline = baseline;
    this.lastCharLooseHeight = Math.abs(f32(vpLoose.bottom - vpLoose.top));
    this.noteDirection(c);
    this.charCount += 1;
    if (this.extractTextMetadata) this.charCodes.push(rec.charCode);
    if (countsAsUnmapped(recovered, hasUnicodeMapError(rec))) this.unmappedCharCount += 1;

    // Accumulate glyph width
    if (this.font !== null) {
      const w = isGenerated(rec)
        ? this.font.glyphWidth(rec.unicode, this.fontSize)
        : this.font.glyphWidthFromCharCode(rec.charCode, this.fontSize);
      if (w !== null) this.textWidth = f32(this.textWidth + w);
    }

    // Check codepoint for buggy encoding on subsequent chars
    if (!this.fontIsBuggy && this.fontIsEmbedded && isBuggyCodepoint(rec.unicode))
      this.fontIsBuggy = true;
  }

  /** Append extra characters to the segment text (ligature expansion); boxes and char count stay. */
  appendLigatureTail(tail: string): void {
    this.text += tail;
    if (this.wordHas) this.curWord += tail;
  }

  /** Whether the segment contains any characters that are not dots or spaces. */
  hasNonDotContent(): boolean {
    for (const c of this.text) if (c !== "." && c !== " " && c !== "·" && c !== "•") return true;
    return false;
  }

  /** Record that a space was seen. */
  markPendingSpace(generated: boolean, charCode: number): void {
    if (!this.hasContent) return;
    this.pendingSpace = true;
    if (this.extractTextMetadata) {
      this.pendingSpaceGenerated = generated;
      this.pendingSpaceCharCodes.push(charCode);
    }
  }

  /** Commit a pending space into the segment text. */
  commitPendingSpace(): void {
    if (!this.pendingSpace) return;
    this.breakWord();
    this.text += " ";
    if (this.extractTextMetadata) {
      this.charCodes.push(...this.pendingSpaceCharCodes);
      this.pendingSpaceCharCodes = [];
    }
    this.pendingSpace = false;
    this.pendingSpaceGenerated = false;
  }

  /** Append the open word-break space the missing-space recovery inserts. */
  insertWordSpace(): void {
    this.text += " ";
    this.breakWord();
  }

  /** Flush the current segment into `items` and reset. */
  flush(items: TextItem[]): void {
    if (!this.hasContent) return;
    this.breakWord();
    if (this.extractTextMetadata) {
      this.charCodes.push(...this.pendingSpaceCharCodes);
      this.pendingSpaceCharCodes = [];
    }
    const trimmed = trim(this.text);
    if (trimmed !== "") items.push(segmentItem(this, trimmed));
    // `*self = Self::new(..)`: the next segment starts from scratch (last_script included).
    this.reset();
  }
}
