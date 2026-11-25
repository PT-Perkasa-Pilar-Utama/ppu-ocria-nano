// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): merge_ocr_outcomes.

import type { OcrResult } from "../ocr/types.js";
import { f32 } from "../rust.js";
import type { Page } from "../types/page.js";
import { textItem } from "../types/text-item.js";
import type { TextItem, WordBox } from "../types/text-item.js";
import { canonicalQuarter, ocrPageSkew, polygonRotationDeg, uprightRotatedScan } from "./deskew.js";
import { LiteParseError } from "./error.js";
import {
  cleanOcrTableArtifacts,
  isRuleArtifact,
  nativeWidthCoverage,
  overlapsExistingText,
  PARTIAL_NATIVE_COVERAGE,
} from "./filters.js";
import { garbledScope } from "./garbled-scope.js";
import { isUnusableNative, pageHasSparseNativeText } from "./native.js";
import { PageFrame } from "./page-frame.js";
import type { PageBox } from "./page-frame.js";
import { hypotF32, roundF32, splitWhitespace } from "../rust-extra.js";
import type { OcrMergeState } from "./state.js";
import type { PageOcrOutcome } from "./types.js";

/** Native items whose centre falls inside the box (a line that supersedes them once added). */
function nativesInside(natives: readonly TextItem[], ocr: PageBox): number[] {
  const [x, y, w, h] = ocr;
  const inside: number[] = [];
  natives.forEach((it, i) => {
    const cx = f32(it.x + f32(it.width / 2));
    const cy = f32(it.y + f32(it.height / 2));
    if (cx >= x && cx <= f32(x + w) && cy >= y && cy <= f32(y + h)) inside.push(i);
  });
  return inside;
}

/** The line's rotation: the engine's angle, else the polygon's point order. */
function ocrRotation(r: OcrResult): number {
  if (r.rotation != null) return canonicalQuarter(r.rotation);
  return r.polygon == null ? 0 : polygonRotationDeg(r.polygon);
}

/**
 * Word boxes of one result. Engine boxes move by their centres so the rotate-back after
 * layout restores each one. A count mismatch after cleaning keeps the line's own box.
 */
function wordBoxes(r: OcrResult, cleaned: string, frame: PageFrame): WordBox[] {
  const word = (text: string, [x, y, width, height]: PageBox): WordBox => ({
    text,
    x,
    y,
    width,
    height,
  });
  const texts = splitWhitespace(cleaned);
  if (texts.length === r.words.length) {
    return texts.map((text, i) => word(text, frame.toPage(r.words[i].bbox)));
  }
  return [word(cleaned, frame.toPage(r.bbox))];
}

/**
 * For native rotated text the font_size approximates line height, which for 90/270
 * rotations corresponds to the *narrow* screen dimension. Use the perpendicular extent
 * for rotated OCR text so downstream font-size heuristics stay sane. A tilted line's
 * axis-aligned box is taller than its glyphs (a 3 degree tilt over a 400 px line adds
 * 20 px), which reads as a larger font and promotes body lines to headings; the
 * polygon's own side is the line height.
 */
function fontSizeHint(r: OcrResult, rotation: number, w: number, h: number, scale: number): number {
  if (rotation === 90 || rotation === 270) return Math.max(w, 1);
  const p = r.polygon;
  if (p == null) return h;
  const polyH = f32(hypotF32(f32(p[3][0] - p[0][0]), f32(p[3][1] - p[0][1])) * scale);
  return polyH > 0 ? Math.min(polyH, h) : h;
}

/** Drop the page's untrustworthy native items so OCR can replace them. */
function dropUnusableNative(page: Page, replaceNative: boolean): boolean {
  // An invisible OCR layer on a scan steps aside for the new OCR (which came back
  // non-empty, so the page keeps text either way).
  const scope = replaceNative ? { kind: "WholePage" as const } : garbledScope(page);
  switch (scope.kind) {
    case "None":
      page.text_items = page.text_items.filter((item) => !isUnusableNative(item));
      return false;
    case "WholePage":
      page.text_items = [];
      return false;
    case "Fonts": {
      // Only the corrupt font's items go; text in the page's healthy fonts is still the
      // best source for its part of the page, and keeping it lets the overlap check
      // suppress redundant OCR there while OCR fills in what was dropped.
      const { fonts } = scope;
      page.text_items = page.text_items.filter(
        (item) => !fonts.has(item.font_name ?? null) && !isUnusableNative(item)
      );
      return true;
    }
  }
}

function mergeOutcome(
  page: Page,
  outcome: PageOcrOutcome,
  results: readonly OcrResult[],
  emitWordBoxes: boolean
): void {
  // Pixel -> PDF-point scale for the DPI this page was actually rendered at
  // (the long-edge cap can lower it below the configured DPI).
  const scale = f32(72 / outcome.dpi);
  // Some fonts dropped, the rest kept: OCR fills lines the dropped fonts held, and a kept
  // glyph inside such a line (a bullet, a drop cap) must not veto it.
  const partial = dropUnusableNative(page, outcome.replace_native);

  // Only check overlap against native (already-extracted) PDF text. Comparing each OCR
  // result against previously-accepted OCR results caused adjacent OCR lines whose
  // bounding boxes touched within tolerance to suppress each other, dropping every
  // second line on scanned pages.
  const nativeCount = page.text_items.length;
  // Kept native items an OCR line superseded on a partial page (see `partial`).
  const superseded = Array.from({ length: nativeCount }, () => false);
  // A skewed scan: when all of the page's text is OCR, rotate the items upright about the
  // page centre. Axis-aligned boxes of tilted lines overlap the lines above and below,
  // and the projection then merges and reorders them. The tilt is recorded on the page
  // and the output boxes are rotated back after layout.
  const deskew = nativeCount === 0 ? ocrPageSkew(results) : null;
  page.ocr_deskew = deskew;
  const frame = new PageFrame(deskew, scale, f32(page.page_width / 2), f32(page.page_height / 2));
  for (const r of results) {
    if (r.confidence <= f32(0.1)) continue;

    // The polygon's bounds give a rotated detection a tight upright box. The rotation
    // (the engine's angle, else the polygon's point order) sends rotated sidebar text
    // through the projector's rotation reading-order handler.
    const box = frame.pageBounds(r.bbox, r.polygon);
    const [ocrX, ocrY, ocrW, ocrH] = box;
    const rotation = ocrRotation(r);

    // On pages that already have native text, OCR only enriches: a bar-shaped single
    // glyph is a table border / rule misread (Tesseract reads vertical rules as `|`/`I`),
    // and a result with no letters or digits is decoration. Both would otherwise be glued
    // onto the adjacent native line by the projection's item-merge pass, corrupting cell text.
    if (outcome.has_native_text && isRuleArtifact(r.text, ocrW, ocrH)) continue;
    const natives = page.text_items.slice(0, nativeCount);
    let inside: number[] = [];
    let overlaps: boolean;
    if (partial) {
      // On a partial page the line is the kept text's only when kept native text covers
      // most of it; otherwise the native items inside it give way to it.
      const covered = nativeWidthCoverage(natives, ocrX, ocrY, ocrW, ocrH);
      if (covered < PARTIAL_NATIVE_COVERAGE) inside = nativesInside(natives, box);
      overlaps = covered >= PARTIAL_NATIVE_COVERAGE;
    } else {
      overlaps = overlapsExistingText(natives, ocrX, ocrY, ocrW, ocrH, 2);
    }
    if (overlaps) continue;

    const cleaned = cleanOcrTableArtifacts(r.text);
    if (cleaned === "") continue;

    page.text_items.push(
      textItem({
        text: cleaned,
        x: ocrX,
        y: ocrY,
        width: ocrW,
        height: ocrH,
        rotation,
        font_name: "OCR",
        font_size: fontSizeHint(r, rotation, ocrW, ocrH, scale),
        confidence: f32(f32(roundF32(f32(r.confidence * 1000))) / 1000),
        words: emitWordBoxes ? wordBoxes(r, cleaned, frame) : [],
        ocr_faint: r.faint,
      })
    );
    for (const i of inside) superseded[i] = true;
  }
  if (superseded.some((s) => s)) {
    page.text_items = page.text_items.filter((_, i) => i >= nativeCount || !superseded[i]);
  }
  if (!outcome.has_native_text) uprightRotatedScan(page);
}

export function mergeOcrOutcomes(
  pages: Page[],
  outcomes: readonly PageOcrOutcome[],
  emitWordBoxes: boolean,
  state: OcrMergeState
): void {
  state.totalTasks += outcomes.length;

  // A later page with the same number replaces an earlier one, as a collected HashMap does.
  const indexByPageNumber = new Map<number, number>();
  pages.forEach((page, idx) => indexByPageNumber.set(page.page_number, idx));

  for (const outcome of outcomes) {
    const idx = indexByPageNumber.get(outcome.page_number);
    if (idx === undefined) {
      throw new LiteParseError(
        "Other",
        `OCR outcome for page ${outcome.page_number} has no matching page among the ${pages.length} page(s) being merged`
      );
    }
    const page = pages[idx];
    if (outcome.error != null) {
      state.failedTasks += 1;
      state.failedSparseTextPage ||= pageHasSparseNativeText(page);
      if (state.firstError === null) {
        console.error(`[ocr] failed for page ${outcome.page_number}: ${outcome.error}`);
        state.firstError = outcome.error;
      }
      continue;
    }
    const results = outcome.results ?? [];
    if (results.length === 0) continue;
    mergeOutcome(page, outcome, results, emitWordBoxes);
  }
}
