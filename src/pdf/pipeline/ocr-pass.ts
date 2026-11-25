// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/parser.rs (crates-v2.21.2, Apache-2.0): the OCR loop of parse_resolved, and recognize_rasters.

// The Rust keeps a window of in-flight recognitions and renders the next page as soon as one
// ends, so renders overlap recognition. One thread runs this port, so the pass renders a page,
// recognizes it, and moves on: the same rasters and outcomes in the same order.

import type { OcriaEngine } from "../../ocria/ocr/engine.js";
import type { PageOcrOutcome } from "../../ocria/ocr-merge/types.js";
import type { Page } from "../../ocria/types/page.js";
import type { Document } from "../pdfium/document.js";
import type { OcrRaster, OcrRenderOptions } from "../ocr-render/render.js";
import { renderPagesForOcr } from "../ocr-render/render.js";

/** `recognize_rasters` for one raster: the engine's output, or its error message (the merge counts failures). */
async function recognize(engine: OcriaEngine, raster: OcrRaster): Promise<PageOcrOutcome> {
  const base = {
    page_number: raster.page_number,
    dpi: raster.dpi,
    has_native_text: raster.has_native_text,
    image_rects: raster.image_rects,
    replace_native: raster.replace_native,
  };
  try {
    const { data, width, height } = raster.image;
    return { ...base, results: await engine.run(data, width, height) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Render every page that needs OCR and recognize it, in page order. */
export async function ocrPages(
  document: Document,
  pages: readonly Page[],
  engine: OcriaEngine,
  options: OcrRenderOptions
): Promise<PageOcrOutcome[]> {
  const outcomes: PageOcrOutcome[] = [];
  let scanStart = 0;
  while (scanStart < pages.length) {
    // One page per round, as `OcrWindow::render_next`.
    const round = renderPagesForOcr(document, pages, scanStart, options, 1);
    scanStart = round.nextStart;
    for (const raster of round.rasters) outcomes.push(await recognize(engine, raster));
  }
  return outcomes;
}
