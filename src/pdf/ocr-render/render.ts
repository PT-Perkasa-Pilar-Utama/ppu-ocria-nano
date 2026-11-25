// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): render_pages_for_ocr_capped, fitting_dpi, mask_native_text.

// Not ported, because `PdfOptions` cannot reach it: caller-supplied page images, grayscale
// rasters (the OCRia engine takes RGB), form-field rendering, request fields.

import { f32, trim } from "../../ocria/rust.js";
import { garbledScope } from "../../ocria/ocr-merge/garbled-scope.js";
import { isUnusableNative, nativeTextLength } from "../../ocria/ocr-merge/native.js";
import { pageIsGarbled } from "../../ocria/ocr-merge/garbled-scope.js";
import type { Rect } from "../../ocria/types/geometry.js";
import type { Page } from "../../ocria/types/page.js";
import type { Document } from "../pdfium/document.js";
import { imageObjects } from "../pdfium/page-images.js";
import { flattenFormWidgets } from "../pdfium/page-widgets.js";
import {
  MAX_IMAGE_PAGE_COVERAGE,
  MIN_IMAGE_SIZE_PT,
  MIN_NATIVE_TEXT_LEN,
  calculatePageComplexity,
} from "./complexity.js";
import { DESPECKLE_MIN_DPI, despeckle, isBilevelScan } from "./despeckle.js";

/** The long edge, in pixels, a render for OCR is capped at. */
export const MAX_OCR_RENDER_LONG_EDGE_PX = 4096;

/** Interleaved 8-bit RGB pixels. */
export type OcrImage = { data: Uint8Array; width: number; height: number };

/** `OcrRaster`: a page image and the page facts the merge needs to judge the engine's output. */
export type OcrRaster = {
  /** 1-based source page number. */
  page_number: number;
  image: OcrImage;
  /** DPI the page was rendered at; pixel to point scale is `72 / dpi`. */
  dpi: number;
  /** The page has real native text (it was not sent to OCR as scanned, blank or garbled). */
  has_native_text: boolean;
  /** Embedded raster figure rects (viewport pt, excluding full-page backgrounds). */
  image_rects: Rect[];
  /** The page's native text is an invisible OCR layer the new OCR replaces. */
  replace_native: boolean;
};

/** The parts of `OcrRenderOptions` a PDF parse sets. */
export type OcrRenderOptions = {
  /** Requested render resolution. */
  dpi: number;
  /** Largest long edge, in pixels, a raster may have; null leaves `dpi` alone. */
  maxLongEdge: number | null;
  /** Explicit 1-based page selection; null lets the page-complexity scoring decide. */
  selection: ReadonlySet<number> | null;
  despeckleScans: boolean;
  continueOnPageError: boolean;
  /**
   * Pages extraction flattened widget annotations on, which must be flattened again on this
   * (reopened) document so the raster shows what extraction saw. Never flatten any other page:
   * flattening hides a page's non-widget annotations from the raster.
   */
  reflattenPages: ReadonlySet<number>;
};

/** `fitting_dpi`: `dpi`, lowered so the long edge is at most `maxLongEdge` pixels. */
export function fittingDpi(
  width: number,
  height: number,
  dpi: number,
  maxLongEdge: number
): number {
  const longEdgePt = Math.max(width, height);
  if (maxLongEdge === 0 || longEdgePt <= 0) return dpi;
  return Math.min(dpi, f32(f32(maxLongEdge * 72) / longEdgePt));
}

/**
 * `mask_native_text`: paint the boxes of the native text items the merge keeps white in an RGB
 * raster of `page`, widened by one point, so OCR only sees what the text layer does not cover.
 */
export function maskNativeText(
  pixels: Uint8Array,
  width: number,
  height: number,
  page: Page
): void {
  const MASK_MARGIN_PT = 1;
  const channels = 3;
  if (page.page_width <= 0 || page.page_height <= 0) return;
  const sx = f32(width / page.page_width);
  const sy = f32(height / page.page_height);
  for (const item of page.text_items) {
    if (isUnusableNative(item) || trim(item.text) === "") continue;
    const x0 = Math.max(Math.floor(f32(f32(item.x - MASK_MARGIN_PT) * sx)), 0);
    const y0 = Math.max(Math.floor(f32(f32(item.y - MASK_MARGIN_PT) * sy)), 0);
    const x1 = Math.min(
      Math.max(Math.ceil(f32(f32(f32(item.x + item.width) + MASK_MARGIN_PT) * sx)), 0),
      width
    );
    const y1 = Math.min(
      Math.max(Math.ceil(f32(f32(f32(item.y + item.height) + MASK_MARGIN_PT) * sy)), 0),
      height
    );
    if (x0 >= x1 || y0 >= y1) continue;
    for (let y = y0; y < y1; y++)
      pixels.fill(255, (y * width + x0) * channels, (y * width + x1) * channels);
  }
}

/** `render_pages_for_ocr_capped`'s per-page body: the raster of one page, or null when it needs no OCR. */
function renderPage(document: Document, page: Page, options: OcrRenderOptions): OcrRaster | null {
  const pageIndex = page.page_number - 1;
  const pageObj = options.reflattenPages.has(page.page_number)
    ? (flattenFormWidgets(document, pageIndex) ?? document.page(pageIndex))
    : document.page(pageIndex);
  try {
    // `has_native_text` drives the merge's artifact filters: true when the page was not sent to
    // OCR as scanned, blank, garbled or annotation-only. With an explicit selection the OCR gate
    // is the caller's, so the signal comes from the text items alone.
    let replaceNative = false;
    let hasNativeText: boolean;
    if (options.selection !== null) {
      hasNativeText = nativeTextLength(page) >= MIN_NATIVE_TEXT_LEN && !pageIsGarbled(page);
    } else {
      const complexity = calculatePageComplexity(page, pageObj);
      if (!complexity.needs_ocr) return null;
      replaceNative = complexity.reasons.includes("invisible-text-layer");
      hasNativeText = !complexity.reasons.some(
        (r) =>
          r === "scanned" ||
          r === "no-text" ||
          r === "garbled" ||
          r === "annotation-text" ||
          r === "invisible-text-layer"
      );
    }
    // A page whose native text the merge keeps as is: blank that text out of the raster, since
    // the merge drops every OCR line overlapping kept native text. Pages where OCR replaces
    // native text keep the whole raster.
    const maskNative = hasNativeText && !replaceNative && garbledScope(page).kind === "None";

    // Fit the caller's cap, then clamp so the long edge stays within the raster budget.
    const longEdgePt = Math.max(page.page_width, page.page_height);
    let effDpi = fittingDpi(
      page.page_width,
      page.page_height,
      options.dpi,
      options.maxLongEdge ?? 0
    );
    if (longEdgePt > 0) {
      const maxDpi = f32(f32(MAX_OCR_RENDER_LONG_EDGE_PX * 72) / longEdgePt);
      if (effDpi > maxDpi) effDpi = maxDpi;
    }
    const bitmap = pageObj.render(effDpi);
    let image: OcrImage;
    try {
      image = { data: bitmap.toRgb(), width: bitmap.width(), height: bitmap.height() };
    } finally {
      bitmap.destroy();
    }
    // A 1-bit scan on a dotted or dithered background: drop the specks before OCR, which at the
    // scan's resolution read as diacritics and stray punctuation.
    if (options.despeckleScans && effDpi >= DESPECKLE_MIN_DPI && isBilevelScan(pageObj)) {
      despeckle(image.data, image.width, image.height, 3, effDpi);
    }
    if (maskNative) maskNativeText(image.data, image.width, image.height, page);

    const imageRects: Rect[] = [];
    if (hasNativeText) {
      for (const { bounds: b } of imageObjects(pageObj, MIN_IMAGE_SIZE_PT, Infinity).images) {
        if (
          !(
            b.width > f32(page.page_width * MAX_IMAGE_PAGE_COVERAGE) &&
            b.height > f32(page.page_height * MAX_IMAGE_PAGE_COVERAGE)
          )
        ) {
          imageRects.push({ x: b.x, y: b.y, width: b.width, height: b.height });
        }
      }
    }
    return {
      page_number: page.page_number,
      image,
      dpi: effDpi,
      has_native_text: hasNativeText,
      image_rects: imageRects,
      replace_native: replaceNative,
    };
  } finally {
    pageObj.close();
  }
}

/** The rasters of one render round, and the page index to resume scanning from. */
export type RenderedRound = { rasters: OcrRaster[]; nextStart: number };

/**
 * Render the pages in `pages[start..]` that need OCR from an open document, stopping once
 * `maxRasters` (0 = no limit) have been rendered. Returns the rasters and the index to resume from.
 */
export function renderPagesForOcr(
  document: Document,
  pages: readonly Page[],
  start: number,
  options: OcrRenderOptions,
  maxRasters: number
): RenderedRound {
  const rasters: OcrRaster[] = [];
  let nextStart = pages.length;
  for (let idx = start; idx < pages.length; idx++) {
    const page = pages[idx];
    if (options.selection !== null && !options.selection.has(page.page_number)) continue;
    let raster: OcrRaster | null;
    try {
      raster = renderPage(document, page, options);
    } catch (error) {
      // The page already extracted, so a tolerant parse keeps its native text and forgoes OCR.
      if (!options.continueOnPageError) throw error;
      continue;
    }
    if (raster === null) continue;
    rasters.push(raster);
    if (maxRasters > 0 && rasters.length >= maxRasters) {
      nextStart = idx + 1;
      break;
    }
  }
  return { rasters, nextStart };
}
