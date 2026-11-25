// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/text_clip.rs (crates-v2.21.2, Apache-2.0).

// Conservative glyph visibility under rectangular PDF graphics-state clips. Clip points already
// include the object's CTM; only ancestor form matrices remain. Unknown paths and transforms
// preserve text, including OCR text layers.
//
// Visibility is decided per word: a word with any glyph inside its clip is kept whole, so a mostly
// hidden line never loses just its low punctuation (`1234.56` -> `1234 56`). Only leader runs
// (`......`) are trimmed per glyph.

import { isWhitespace } from "../../ocria/rust.js";
import {
  CharInfoChunks,
  charFromU32,
  isGenerated,
  strictCharBox,
  textObject,
} from "../extract/chars.js";
import { IDENTITY, composeMatrix } from "../pdfium/page-paths.js";
import { PageObject } from "../pdfium/page-object.js";
import type { Page } from "../pdfium/page.js";
import type { CharInfo, TextPage } from "../pdfium/text-page.js";
import type { Matrix, RectF } from "../pdfium/types.js";
import { adjacent, emExtent, leaderRuns, rectangle, validMatrix } from "./clip-geometry.js";

/** Share of a glyph's em extent by which its ink box may miss a clip and still count as visible. */
const INK_MARGIN = 0.02;

/** A tiny tolerance prevents float rounding at a clip edge losing a glyph. */
const EPS = 0.001;

type Glyph = [index: number, c: string | null, hidden: boolean];

function sameRect(a: RectF | null, b: RectF | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/** Only objects whose complete path stack is understood have an entry. Bounds are y-up page coordinates; inverted bounds mean an empty intersection. */
class ObjectClips {
  readonly objects = new Map<number, RectF>();

  constructor(page: Page) {
    const n = PageObject.count(page);
    for (let index = 0; index < n; index++) {
      const object = PageObject.at(page, index);
      if (object !== null) this.walk(object, IDENTITY, null, 0);
    }
  }

  private walk(object: PageObject, parent: Matrix, inherited: RectF | null, depth: number): void {
    if (depth > 64) return;
    const paths = object.clipPaths();
    if (paths === null) return;
    let bounds = inherited;
    for (const path of paths) {
      const rect = rectangle(path, parent);
      if (rect === null) return;
      bounds =
        bounds === null
          ? rect
          : {
              left: Math.max(bounds.left, rect.left),
              right: Math.min(bounds.right, rect.right),
              bottom: Math.max(bounds.bottom, rect.bottom),
              top: Math.min(bounds.top, rect.top),
            };
    }
    const kind = object.kind();
    if (kind === "Text") {
      if (bounds !== null) this.objects.set(object.id(), bounds);
    } else if (kind === "Form") {
      const m = object.matrix();
      if (m === null) return;
      const matrix = composeMatrix(parent, m);
      if (!validMatrix(matrix)) return;
      const count = object.formObjectCount();
      if (count === null) return;
      for (let index = 0; index < count; index++) {
        const child = object.formObject(index);
        if (child !== null) this.walk(child, matrix, bounds, depth + 1);
      }
    }
  }

  /** The clip bounds of the glyph's text object, null when it is unclipped. */
  bounds(rec: CharInfo): RectF | null {
    const obj = textObject(rec);
    return obj === null ? null : (this.objects.get(obj) ?? null);
  }

  /**
   * Generated separators have no reliable source object and are preserved. A glyph is visible when
   * its ink box, widened by `INK_MARGIN` of its em extent, meets the clip; glyphs without ink are
   * judged by their loose box.
   */
  hides(rec: CharInfo): boolean {
    if (isGenerated(rec)) return false;
    const bounds = this.bounds(rec);
    if (bounds === null) return false;
    // The ink (strict) box decides: a loose box carries the font's side bearings and ascent, so it
    // can graze a clip edge while every pixel of the glyph lies outside. Whitespace and inkless
    // glyphs keep the loose box.
    const ch = charFromU32(rec.unicode);
    const inked = !(ch !== null && isWhitespace(ch));
    const loose = rec.looseBox;
    const strictBox = strictCharBox(rec);
    const ink =
      inked && strictBox.right > strictBox.left && strictBox.top > strictBox.bottom
        ? strictBox
        : null;
    const glyph = ink ?? loose;
    const margin = ink ? INK_MARGIN * emExtent(loose) : 0;
    if (![glyph.left, glyph.right, glyph.bottom, glyph.top].every(Number.isFinite)) return false;
    if (glyph.left > glyph.right || glyph.bottom > glyph.top) return false;
    const tol = EPS + margin;
    return (
      bounds.left > bounds.right ||
      bounds.bottom > bounds.top ||
      glyph.right < bounds.left - tol ||
      glyph.left > bounds.right + tol ||
      glyph.top < bounds.bottom - tol ||
      glyph.bottom > bounds.top + tol
    );
  }
}

/** A word with any visible glyph is kept whole, except a leader run inside it (`775……………`): leaders keep their own verdicts so one that overflows its cell is trimmed at the clip. */
function closeWord(glyphs: Glyph[], hidden: Set<number>): void {
  const visible = glyphs.some(([, , h]) => !h);
  const leaders = leaderRuns(glyphs.map(([, c]) => c));
  glyphs.forEach(([i, , h], k) => {
    if (h && (!visible || leaders[k])) hidden.add(i);
  });
  glyphs.length = 0;
}

/** Char indices of a text page hidden by rectangular clips. */
export class TextClip {
  private readonly hidden = new Set<number>();

  /** `keep` (the `keep_clipped_text` option) disables the filter. */
  constructor(page: Page, textPage: TextPage, keep: boolean) {
    if (keep) return;
    const clips = new ObjectClips(page);
    // Most pages clip no text: skip the char pass entirely.
    if (clips.objects.size === 0) return;
    const chunks = new CharInfoChunks(textPage);
    const glyphs: Glyph[] = [];
    // The loose box and clip of the word's last glyph.
    let last: RectF | null = null;
    let lastClip: RectF | null = null;
    const n = textPage.charCount();
    for (let i = 0; i < n; i++) {
      const rec = chunks.record(i);
      if (rec === undefined) continue;
      const c = charFromU32(rec.unicode);
      if (isGenerated(rec) || (c !== null && isWhitespace(c))) {
        closeWord(glyphs, this.hidden);
        last = null;
        // A space is judged on its own loose box.
        if (clips.hides(rec)) this.hidden.add(i);
        continue;
      }
      // pdfium emits no separator at every line break or between objects drawn over each other, so
      // a word also ends where its glyphs stop touching or its clip changes.
      const loose = rec.looseBox;
      const clip = clips.bounds(rec);
      if (
        glyphs.length > 0 &&
        (!sameRect(clip, lastClip) || (last !== null && !adjacent(last, loose)))
      ) {
        closeWord(glyphs, this.hidden);
      }
      last = loose;
      lastClip = clip;
      glyphs.push([i, c, clips.hides(rec)]);
    }
    closeWord(glyphs, this.hidden);
  }

  hides(index: number): boolean {
    return this.hidden.has(index);
  }
}
