// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): calculate_page_complexity and its helpers.

import { f32, isWhitespace } from "../../ocria/rust.js";
import { pageIsGarbled } from "../../ocria/ocr-merge/garbled-scope.js";
import { isUnusableNative } from "../../ocria/ocr-merge/native.js";
import { utf8Len } from "../../ocria/rust-extra.js";
import type { Page } from "../../ocria/types/page.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { isControl } from "../../ocria/rust-extra.js";
import { CharInfoChunks, isGenerated, textRenderMode } from "../extract/chars.js";
import type { ImageBounds } from "../pdfium/page-images.js";
import { imageObjects } from "../pdfium/page-images.js";
import { PageObject } from "../pdfium/page-object.js";
import { filledPathBounds, formImageBounds, hasAnnotationText } from "../pdfium/page-scan.js";
import type { Page as PdfPage } from "../pdfium/page.js";
import { charFromU32 } from "../extract/chars.js";

/** Below this many bytes of usable native text a page counts as having no text of its own. */
export const MIN_NATIVE_TEXT_LEN = 20;
/** Dark filled-path area (pt²) not covered by native text before a page is sent to OCR: roughly one word. */
export const UNCOVERED_VECTOR_AREA_THRESHOLD = 400;
/** Native characters at which a sparse, raster-free page's text layer is taken as its content. */
const SPARSE_TEXT_TRUSTED_LEN = 500;
/** Minimum side length (pt) for a raster image object to count toward image coverage. */
export const MIN_IMAGE_SIZE_PT = 25;
/** A single image at or above this fraction of the page is a full-page background. */
export const MAX_IMAGE_PAGE_COVERAGE: number = f32(0.9);
/** Share of visible-glyph characters at or above which the text counts as an invisible layer. */
const INVISIBLE_LAYER_MIN_SHARE: number = f32(0.9);

/** `ComplexityReason`, in its serde kebab-case form. */
export type ComplexityReason =
  | "scanned"
  | "no-text"
  | "sparse-text"
  | "embedded-images"
  | "garbled"
  | "vector-text"
  | "annotation-text"
  | "invisible-text-layer";

/** `PageComplexityStats` without the layout half (`include_complexity` is not reachable). */
export type PageComplexityStats = {
  page_number: number;
  text_length: number;
  text_coverage: number;
  has_substantial_images: boolean;
  image_block_count: number;
  image_coverage: number;
  largest_image_coverage: number;
  full_page_image: boolean;
  uncovered_vector_area: number | null;
  is_garbled: boolean;
  page_area: number;
  needs_ocr: boolean;
  reasons: ComplexityReason[];
};

/** Share of the page's top-level text objects painted before its first full-page raster. */
function hiddenUnderScanShare(page: PdfPage): number {
  const pw = page.width();
  const ph = page.height();
  let textBefore = 0;
  let textTotal = 0;
  let seenScan = false;
  const count = PageObject.count(page);
  for (let i = 0; i < count; i++) {
    const obj = PageObject.at(page, i);
    if (obj === null) continue;
    const kind = obj.kind();
    if (kind === "Image" && !seenScan) {
      const b = obj.bounds();
      if (b !== null) {
        seenScan =
          f32(b.right - b.left) > f32(pw * MAX_IMAGE_PAGE_COVERAGE) &&
          Math.abs(f32(b.top - b.bottom)) > f32(ph * MAX_IMAGE_PAGE_COVERAGE);
      }
    } else if (kind === "Text") {
      textTotal += 1;
      if (!seenScan) textBefore += 1;
    }
  }
  return !seenScan || textTotal === 0 ? 0 : f32(textBefore / textTotal);
}

/** Fraction of the page's characters drawn invisibly (text render mode 3). */
function invisibleTextShare(page: PdfPage): number {
  const tp = page.text();
  try {
    const n = tp.charCount();
    const chunks = new CharInfoChunks(tp);
    let invisible = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const rec = chunks.record(i);
      if (rec === undefined) continue;
      const c = charFromU32(rec.unicode);
      if (isGenerated(rec) || c === null || isWhitespace(c) || isControl(c)) continue;
      total += 1;
      if (textRenderMode(rec) === 3) invisible += 1;
    }
    return total === 0 ? 0 : f32(invisible / total);
  } finally {
    tp.close();
  }
}

/** Total area of filled vector paths not accounted for by native text items. */
export function uncoveredPathArea(
  paths: readonly ImageBounds[],
  items: readonly TextItem[]
): number {
  let uncovered = 0;
  for (const p of paths) {
    const pArea = f32(p.width * p.height);
    if (pArea <= 0) continue;
    let covered = 0;
    for (const item of items) {
      const ix = f32(
        Math.min(f32(p.x + p.width), f32(item.x + item.width)) - Math.max(p.x, item.x)
      );
      const iy = f32(
        Math.min(f32(p.y + p.height), f32(item.y + item.height)) - Math.max(p.y, item.y)
      );
      if (ix > 0 && iy > 0) {
        covered = f32(covered + f32(ix * iy));
        if (covered >= pArea) break;
      }
    }
    uncovered = f32(uncovered + Math.max(f32(pArea - covered), 0));
  }
  return uncovered;
}

/** `calculate_page_complexity`: does the page need OCR, and why. Reads page objects through pdfium. */
export function calculatePageComplexity(page: Page, pageObj: PdfPage): PageComplexityStats {
  // Count only usable native text: corrupt encodings produce long "text" that is unreadable.
  let textLength = 0;
  for (const item of page.text_items) if (!isUnusableNative(item)) textLength += utf8Len(item.text);
  const pw = page.page_width;
  const ph = page.page_height;
  const allImages = imageObjects(pageObj, MIN_IMAGE_SIZE_PT, Infinity).images.map((i) => i.bounds);
  const isFullPage = (b: ImageBounds): boolean =>
    b.width > f32(pw * MAX_IMAGE_PAGE_COVERAGE) && b.height > f32(ph * MAX_IMAGE_PAGE_COVERAGE);
  // Only a top-level scan gates OCR; a scan inside a form XObject only relabels a textless page.
  const topLevelScan = allImages.some(isFullPage);
  const fullPageImage =
    topLevelScan || formImageBounds(pageObj, MIN_IMAGE_SIZE_PT).some(isFullPage);
  const imageBounds = allImages.filter((b) => !isFullPage(b));
  const hasImages = imageBounds.length > 0;
  const pageArea = f32(pw * ph);

  let imageAreaSum = 0;
  let largestImageArea = 0;
  for (const b of imageBounds) {
    const area = f32(Math.max(b.width, 0) * Math.max(b.height, 0));
    imageAreaSum = f32(imageAreaSum + area);
    largestImageArea = Math.max(largestImageArea, area);
  }
  const imageCoverage = pageArea > 0 ? Math.min(f32(imageAreaSum / pageArea), 1) : 0;
  const largestImageCoverage = pageArea > 0 ? Math.min(f32(largestImageArea / pageArea), 1) : 0;
  let textBboxArea = 0;
  for (const item of page.text_items) {
    if (!isUnusableNative(item)) textBboxArea = f32(textBboxArea + f32(item.width * item.height));
  }
  const textCoverage = pageArea > 0 ? f32(textBboxArea / pageArea) : 0;

  // Low spatial coverage only signals a scan or sparse page when there is not much native text too.
  const sparseText = textLength < 2000 && textCoverage < f32(0.15);
  const isGarbled = pageIsGarbled(page);

  const reasons: ComplexityReason[] = [];
  if (textLength < MIN_NATIVE_TEXT_LEN) {
    reasons.push(fullPageImage ? "scanned" : "no-text");
    // Text painted by an annotation appearance renders (so OCR gets it) but is never tokenized.
    if (hasAnnotationText(pageObj)) reasons.push("annotation-text");
  } else if (sparseText && (topLevelScan || textLength < SPARSE_TEXT_TRUSTED_LEN)) {
    reasons.push("sparse-text");
  }
  if (hasImages) reasons.push("embedded-images");
  if (isGarbled) reasons.push("garbled");
  if (
    topLevelScan &&
    textLength >= MIN_NATIVE_TEXT_LEN &&
    (invisibleTextShare(pageObj) >= INVISIBLE_LAYER_MIN_SHARE ||
      hiddenUnderScanShare(pageObj) >= INVISIBLE_LAYER_MIN_SHARE)
  ) {
    reasons.push("invisible-text-layer");
  }
  let needsOcr = reasons.length > 0;

  // Text drawn as filled vector outlines lives outside the text layer: measure the filled path
  // area that native text does not account for. Checked last so the walk runs only when the
  // cheap predicates all pass.
  let uncoveredVectorArea: number | null = null;
  if (!needsOcr) {
    const uncovered = uncoveredPathArea(filledPathBounds(pageObj, 3, f32(0.9)), page.text_items);
    if (uncovered >= UNCOVERED_VECTOR_AREA_THRESHOLD) {
      needsOcr = true;
      reasons.push("vector-text");
    }
    uncoveredVectorArea = uncovered;
  }
  return {
    page_number: page.page_number,
    text_length: textLength,
    text_coverage: textCoverage,
    has_substantial_images: hasImages,
    image_block_count: imageBounds.length,
    image_coverage: imageCoverage,
    largest_image_coverage: largestImageCoverage,
    full_page_image: fullPageImage,
    uncovered_vector_area: uncoveredVectorArea,
    is_garbled: isGarbled,
    page_area: pageArea,
    needs_ocr: needsOcr,
    reasons,
  };
}
