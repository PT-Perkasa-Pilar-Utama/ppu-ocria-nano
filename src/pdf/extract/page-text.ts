// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): extract_page_text_items.

// Character-level text extraction. Instead of pdfium's rect API (which splits text at every font
// attribute change), characters are grouped by spatial proximity. This keeps words like "A-MEM"
// together even when internal characters have different font sizes (small-caps), and keeps
// punctuation attached to adjacent text. Segments break at line changes (large vertical shift),
// column breaks (large horizontal gap) and explicit newline characters.

import { f32, isWhitespace } from "../../ocria/rust.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import type { GlyphResolver } from "../glyph-resolver/index.js";
import type { Page } from "../pdfium/page.js";
import { transformBounds, transformPoint } from "../pdfium/page.js";
import type { TextPage } from "../pdfium/text-page.js";
import type { RectF } from "../pdfium/types.js";
import { TextClip } from "../text-clip/index.js";
import {
  CharInfoChunks,
  isAsciiAlphanumeric,
  isGenerated,
  strictCharBox,
  textObject,
  textRenderMode,
} from "./chars.js";
import { dedupOverlappingItems } from "./dedup.js";
import { GlyphDecoder } from "./glyph-decoder.js";
import { isCombiningMark, medianF32, normalizePunct } from "./misc.js";
import { mapUnicode } from "./unicode-map.js";
import { ObjMetaCache } from "./obj-meta.js";
import type { ExtractionOutputOptions } from "./options.js";
import { lamAlefOrder, prescanPageBatched } from "./prescan.js";
import { SegmentBuilder } from "./segment-builder.js";

/** Hard limit: gaps larger than this always cause a split (column breaks). */
const MAX_INLINE_GAP = 15;
/** Minimum genuine-space samples required before trusting per-font calibration. */
const MIN_SPACE_CAL_SAMPLES = 6;

const lastChar = (s: string): string | undefined => Array.from(s).at(-1);

/** Per-page state of the character loop. */
class PageTextPass {
  readonly items: TextItem[] = [];
  readonly seg: SegmentBuilder;
  readonly objMeta: ObjMetaCache;
  readonly glyphDecoder: GlyphDecoder;
  readonly clips: TextClip;
  readonly chunks: CharInfoChunks;
  readonly skipInvisible: boolean;
  readonly pageRotation: number;
  readonly vp: ReturnType<Page["viewportTransform"]>;
  /** Per-font space calibration: genuine inter-word gaps PDFium emitted (normalized by em height), for fonts that expose no space-glyph metric. */
  readonly fontSpaceCal = new Map<string, number[]>();

  constructor(
    readonly page: Page,
    readonly textPage: TextPage,
    viewBox: RectF,
    resolver: GlyphResolver | null,
    readonly options: ExtractionOutputOptions,
    readonly charCount: number,
    readonly mathChars: ReadonlySet<number>
  ) {
    this.chunks = new CharInfoChunks(textPage);
    // Pre-scan: if ALL text is invisible (render mode 3) it is likely an OCR text layer that is the
    // content; detect garbage-CMap fonts too.
    const prescan = prescanPageBatched(page.lib, this.chunks, charCount);
    this.skipInvisible = prescan.skipInvisible;
    this.clips = new TextClip(page, textPage, options.keep_clipped_text);
    this.pageRotation = page.rotation();
    this.vp = page.viewportTransform(viewBox);
    this.seg = new SegmentBuilder(options.emit_word_boxes, options.extract_text_metadata);
    this.objMeta = new ObjMetaCache(page.lib, textPage);
    this.glyphDecoder = new GlyphDecoder(page.lib, prescan.garbageFonts, resolver);
  }

  run(): void {
    const { seg, textPage, chunks, clips, items } = this;
    for (let i = 0; i < this.charCount; i++) {
      const rec = chunks.record(i);
      if (rec === undefined) continue;
      if (clips.hides(i) || this.mathChars.has(i)) {
        seg.flush(items);
        continue;
      }
      const unicode = lamAlefOrder(textPage, i, this.charCount, rec.unicode, rec.charCode);
      const generated = isGenerated(rec);

      // Skip invisible text only when the page also has visible text.
      if (this.skipInvisible && textRenderMode(rec) === 3) continue;

      // Glyph-name recovery: when the font's unicode mapping is missing or untrusted, resolve the
      // charcode's PostScript glyph name instead.
      const decoded = generated ? null : this.glyphDecoder.decode(rec, unicode);
      // A recovered glyph carries correct text even though PDFium still reports a /ToUnicode map
      // error for its raw char code: it does not count toward the item's unmapped-char tally.
      const recovered = decoded !== null;

      // Skip null / invalid sentinels (unless the glyph name recovered them)
      if (decoded === null && (unicode === 0 || unicode === 0xfffe || unicode === 0xffff)) continue;

      let c: string;
      let tail: string;
      if (decoded !== null) {
        const chars = Array.from(decoded);
        c = chars[0];
        tail = chars.slice(1).join("");
      } else {
        const mapped = mapUnicode(unicode);
        if (mapped === null) continue;
        [c, tail] = mapped;
      }
      c = normalizePunct(c);

      // Newlines flush the current segment
      if (c === "\n" || c === "\r") {
        seg.flush(items);
        continue;
      }

      // Whitespace: a pending-space state, keeping the source character code and PDFium's generated distinction.
      if (isWhitespace(c)) {
        seg.markPendingSpace(generated, rec.charCode);
        // PDFium-generated gaps stay item boundaries so the item can retain the trailing-space-generated distinction.
        if (generated && this.options.extract_text_metadata) seg.flush(items);
        continue;
      }

      // Skip non-space generated characters (synthetic glyphs)
      if (generated) continue;

      // Loose bounds in viewport space for the item bounding box
      const vpLoose = transformBounds(this.vp, rec.looseBox);
      // Skip zero-height characters (phantom dots from dot leader decorations)
      if (f32(vpLoose.bottom - vpLoose.top) < f32(0.5)) continue;
      // The strict char box drives the gap calculation (stays in viewport space)
      const vpStrict = transformBounds(this.vp, strictCharBox(rec));
      const origin = textPage.origin(i);
      const baseline = origin ? transformPoint(this.vp, f32(origin[0]), f32(origin[1]))[1] : null;

      this.place(i, c, tail, rec, recovered, vpLoose, vpStrict, baseline);
    }
    seg.flush(items);
  }

  private startSegment(
    i: number,
    c: string,
    rec: Parameters<SegmentBuilder["start"]>[6],
    recovered: boolean,
    vpLoose: RectF,
    vpStrict: RectF,
    baseline: number | null
  ): void {
    const meta = this.objMeta.metaFor(i, textObject(rec));
    this.seg.start(
      c,
      vpLoose,
      vpStrict,
      baseline,
      this.textPage,
      i,
      rec,
      recovered,
      this.pageRotation,
      meta
    );
  }

  /** Put char `c` in the open segment, or break to a new one, by the gap rules. */
  private place(
    i: number,
    c: string,
    tail: string,
    rec: Parameters<SegmentBuilder["start"]>[6],
    recovered: boolean,
    vpLoose: RectF,
    vpStrict: RectF,
    baseline: number | null
  ): void {
    const { seg, items } = this;
    if (!seg.hasContent) {
      this.startSegment(i, c, rec, recovered, vpLoose, vpStrict, baseline);
      seg.appendLigatureTail(tail);
      return;
    }
    // Use viewport-space coordinates for gap/overlap checks
    const yTolerance = 2;
    const yOverlap =
      vpLoose.top < f32(seg.vpBottom + yTolerance) && vpLoose.bottom > f32(seg.vpTop - yTolerance);

    // Gaps are measured along the segment's writing direction: positive means further along the
    // line, negative means doubled back.
    const gap = seg.gapTo(vpStrict, c);

    // Line change, by complementary checks: strict vertical separation; a line wrap (the char goes
    // back against the writing direction while its strict top is below the last char's bottom); a
    // very large backward jump (a long run that jumps back by more than half its width, or any run
    // that jumps back by more than three character widths, at least 1.5em); a baseline step.
    const strictBelow = vpStrict.top > seg.lastCharBottom;
    const largeBackwardJump = gap < -5;
    const segWidth = f32(seg.vpRight - seg.vpLeft);
    // `font_size` is the raw `Tf` operand, which is 1 when the size lives in `Tm`/CTM (TeX output):
    // take the larger of that and what the run measures on the page so the cutoff is in page units.
    const vpHeight = Math.abs(f32(seg.vpBottom - seg.vpTop));
    const em = Math.max(seg.fontSize, vpHeight);
    const vpCharW = seg.charCount > 0 ? f32(segWidth / f32(seg.charCount)) : 0;
    const charW = Math.max(seg.avgCharWidth(), vpCharW, f32(em * f32(0.5)));
    // Combining marks (a separately drawn acute over an earlier "e") jump back by design.
    const backwardJump = charW > 0 && gap < -f32(charW * 3) && !isCombiningMark(c);
    const veryLargeBackwardJump =
      (segWidth > 20 && gap < -f32(segWidth * f32(0.5))) || backwardJump;
    // Baseline step: the glyph sits on a baseline well above or below the previous glyph's, at a
    // size the strict boxes still overlap. Only upright horizontal runs at the run's own size.
    const curH = Math.abs(f32(vpLoose.bottom - vpLoose.top));
    const lastH = seg.lastCharLooseHeight;
    const sameSize = lastH > 0 && curH > f32(lastH * f32(0.9)) && lastH > f32(curH * f32(0.9));
    const baselineStep =
      Math.abs(seg.rotationDeg) < 1 &&
      sameSize &&
      !isCombiningMark(c) &&
      baseline !== null &&
      seg.lastCharBaseline !== null &&
      Math.abs(f32(baseline - seg.lastCharBaseline)) > f32(f32(0.4) * Math.min(curH, lastH));
    const lineChanged =
      vpStrict.top > f32(seg.lastCharBottom + yTolerance) ||
      (strictBelow && largeBackwardJump) ||
      veryLargeBackwardJump ||
      baselineStep;

    // Dot leader detection: break at the boundary between dots and non-dots.
    let dotLeaderBreak: boolean;
    if (seg.pendingSpace) {
      dotLeaderBreak =
        (c === "." && seg.hasNonDotContent()) ||
        (c !== "." && !seg.hasNonDotContent() && seg.charCount >= 3);
    } else {
      // Without a pending space: break when a dot follows non-dot content with a gap larger than
      // typical intra-word spacing (leader dots are spaced apart, unlike periods in "U.S."); the 2x
      // cutoff avoids shearing the period off abbreviations. Content right after a dot-only run is
      // a leader's value; 4+ dots so a "...word" ellipsis stays whole.
      dotLeaderBreak =
        (c === "." && seg.hasNonDotContent() && gap > f32(seg.avgCharWidth() * 2)) ||
        (c !== "." && !seg.hasNonDotContent() && seg.charCount >= 4);
    }

    // A size step with a baseline shift (a superscript or subscript run, or back from one) starts a
    // new item so projection can tell the raised or lowered run from the text it follows. A declared
    // size change alone is no script.
    let sizeBreak = false;
    if (this.options.split_scripts && seg.fontHeight !== null) {
      const sh = seg.fontHeight;
      const m = this.objMeta.metaFor(i, textObject(rec));
      const fh = m.fontSize > 0 && m.scaleY !== null ? f32(m.fontSize * m.scaleY) : null;
      const shifted =
        Math.abs(f32(vpStrict.bottom - seg.lastCharBottom)) >
        f32(
          f32(0.15) *
            Math.max(Math.abs(f32(seg.vpBottom - seg.vpTop)), f32(vpStrict.bottom - vpStrict.top))
        );
      sizeBreak =
        shifted &&
        fh !== null &&
        sh > 0 &&
        fh > 0 &&
        (fh < f32(sh * f32(0.78)) || sh < f32(fh * f32(0.78)));
    }

    if (!yOverlap || lineChanged || gap >= MAX_INLINE_GAP || dotLeaderBreak || sizeBreak) {
      // A break for the size step alone into smaller type: the run keeps its host's band.
      const host: [number, number] | null =
        sizeBreak &&
        yOverlap &&
        !lineChanged &&
        gap < MAX_INLINE_GAP &&
        !dotLeaderBreak &&
        Math.abs(f32(vpLoose.bottom - vpLoose.top)) <
          f32(f32(0.85) * Math.abs(f32(seg.vpBottom - seg.vpTop)))
          ? [seg.vpTop, seg.vpBottom]
          : null;
      seg.flush(items);
      this.startSegment(i, c, rec, recovered, vpLoose, vpStrict, baseline);
      seg.hostBand = host;
      seg.appendLigatureTail(tail);
    } else if (seg.pendingSpace) {
      const avgCw = seg.avgCharWidth();
      if (gap > f32(avgCw * f32(2.2))) {
        seg.flush(items);
        this.startSegment(i, c, rec, recovered, vpLoose, vpStrict, baseline);
        seg.appendLigatureTail(tail);
      } else {
        this.sampleSpace(c, vpLoose, vpStrict);
        seg.commitPendingSpace();
        seg.pushChar(c, vpLoose, vpStrict, baseline, rec, recovered);
        seg.appendLigatureTail(tail);
      }
    } else {
      this.recoverMissingSpace(i, c, vpLoose, vpStrict, rec);
      seg.pushChar(c, vpLoose, vpStrict, baseline, rec, recovered);
      seg.appendLigatureTail(tail);
    }
  }

  /** A genuine inline space PDFium emitted: sample its size (loose gap / em height) per font, alpha-alpha only, to calibrate the no-space-metric recovery. */
  private sampleSpace(c: string, vpLoose: RectF, vpStrict: RectF): void {
    const { seg } = this;
    if (seg.fontName === null) return;
    const prev = lastChar(seg.text);
    if (prev === undefined || !isAsciiAlphanumeric(prev) || !isAsciiAlphanumeric(c)) return;
    const emVp = Math.abs(f32(vpLoose.bottom - vpLoose.top));
    const looseGap = seg.looseGapTo(vpStrict, c);
    if (emVp > 0 && looseGap > 0) {
      const s = this.fontSpaceCal.get(seg.fontName) ?? [];
      if (s.length < 512) s.push(f32(looseGap / emVp));
      this.fontSpaceCal.set(seg.fontName, s);
    }
  }

  /**
   * Missing-space recovery: PDFium sometimes omits the space glyph between words ("of the" becomes
   * "ofthe"). Detect it from the advance-relative gap (against the previous char's LOOSE right edge)
   * compared to the font's ASCII-space advance. Only fires between two ASCII alphanumerics. When the
   * font exposes no space-glyph metric, fall back to the calibrated per-font ratio, else a fraction
   * of the rendered em height.
   */
  private recoverMissingSpace(
    i: number,
    c: string,
    vpLoose: RectF,
    vpStrict: RectF,
    rec: Parameters<SegmentBuilder["start"]>[6]
  ): void {
    const { seg } = this;
    const emVp = Math.abs(f32(vpLoose.bottom - vpLoose.top));
    const meta = this.objMeta.metaFor(i, textObject(rec));
    const spaceW = meta.fontSpaceWidth !== null ? f32(meta.fontSpaceWidth * emVp) : 0;
    const looseGap = seg.looseGapTo(vpStrict, c);
    const prev = lastChar(seg.text);
    const bothAlnum = isAsciiAlphanumeric(c) && prev !== undefined && isAsciiAlphanumeric(prev);
    let thresh: number;
    if (spaceW > 0) {
      thresh = f32(f32(0.7) * spaceW);
    } else {
      const samples = seg.fontName === null ? undefined : this.fontSpaceCal.get(seg.fontName);
      const ratio = samples && samples.length >= MIN_SPACE_CAL_SAMPLES ? medianF32(samples) : null;
      thresh = ratio !== null ? f32(f32(f32(0.7) * ratio) * emVp) : f32(f32(0.35) * emVp);
    }
    if (bothAlnum && thresh > 0 && looseGap > thresh) seg.insertWordSpace();
  }
}

/**
 * The text items of a page: segments of characters grouped by spatial proximity, clipped to the
 * page view, with duplicate and overpainted items removed.
 */
export function extractPageTextItems(
  page: Page,
  textPage: TextPage,
  viewBox: RectF,
  resolver: GlyphResolver | null,
  options: ExtractionOutputOptions,
  /** Chars a TeX math span consumed: the math item carries their text. */
  mathChars: ReadonlySet<number>
): TextItem[] {
  const charCount = textPage.charCount();
  if (charCount <= 0) return [];
  const pass = new PageTextPass(page, textPage, viewBox, resolver, options, charCount, mathChars);
  pass.run();
  // Drop items entirely outside the page view box: print-spread and imposed PDFs carry the
  // neighbouring page's text beyond the page edge. Partially visible items are kept.
  const [vbW, vbH] = page.viewportSize(viewBox);
  const onPage = pass.items.filter(
    (it) =>
      it.x < vbW &&
      f32(it.x + Math.max(it.width, f32(0.1))) > 0 &&
      it.y < vbH &&
      f32(it.y + Math.max(it.height, f32(0.1))) > 0
  );
  // Dedup: some PDFs (chart and figure annotations) produce duplicate text objects at the same position.
  return dedupOverlappingItems(onPage);
}
