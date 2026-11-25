// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of LiteParse::parse_resolved in liteparse crates/liteparse/src/parser.rs (crates-v2.21.2, Apache-2.0),
// for one image page with `ocr_page_images` (see docs/decisions, Q10).

// The stages run in parse_resolved's order with the configuration the
// goldens record: markdown output, block extraction on (so word boxes are
// emitted), OCR failure fatal, figures as placeholders.

import type { RawRaster } from "../image-page.js";
import { imagePage, imageRaster, ocrImageDpi } from "../image-page.js";
import { mergeOcrResults } from "../ocr-merge/index.js";
import type { OcriaEngine } from "../ocr/engine.js";
import type { Img } from "../ocr/img.js";
import { projectPagesForMarkdown } from "../projection/index.js";
import type { ProjSignals } from "../projection/signals.js";
import { resegmentByModelBlocks } from "../resegment/index.js";
import { applyLayoutBlocks } from "../stages/apply-layout-join.js";
import { documentSignals } from "../stages/document-signals.js";
import { extractBlocks } from "../stages/extract-blocks.js";
import { rotateBackOcrDeskew } from "../stages/rotate-back.js";
import type { PageInput, TableNet } from "../table-model/index.js";
import { defaultDecodeOptions, runPage } from "../table-model/index.js";
import { hasImg } from "../table-model/net-onnx.js";
import type { Page, ParsedPage } from "../types/page.js";

/** The models one parse runs: the OCR engine, and LayoutNet unless it is off. */
export type ParseModels = { engine: OcriaEngine; layout: TableNet | null };

export type ParseImageOptions = {
  /** Image resolution `[dpi_x, dpi_y]` (from the file's metadata, else 150). */
  dpi: readonly [number, number];
  /** Keep page headers and footers in the markdown. */
  keepHeadersFooters: boolean;
};

/** A parsed image page and its markdown. */
export type ParsedImage = { page: ParsedPage; markdown: string; dpi: number };

/** LayoutNet's input for an OCR page: no text-layer units, the image as the page render. */
function tableInput(page: Page, raw: RawRaster, net: TableNet): PageInput {
  return {
    units: [],
    wh: [page.page_width, page.page_height],
    rules: null,
    ocr: true,
    img: null,
    raw: { raw, rules: true, img: hasImg(net) },
  };
}

/** Parse one RGB image as one page: OCR, merge, projection, LayoutNet, blocks and markdown. */
export async function parseImage(
  models: ParseModels,
  rgb: Img,
  options: ParseImageOptions
): Promise<ParsedImage> {
  const page = imagePage(rgb.w, rgb.h, options.dpi);
  const dpi = ocrImageDpi(page, rgb.w, rgb.h);
  const net = models.layout;
  // built from the page as extracted, before the OCR merge can turn it upright (as
  // parse_resolved builds table inputs during extraction)
  const input = net ? tableInput(page, imageRaster(rgb, page), net) : null;
  const results = await models.engine.run(rgb.data, rgb.w, rgb.h);
  const pages = [page];
  mergeOcrResults(
    pages,
    [
      {
        page_number: 1,
        dpi,
        has_native_text: false,
        image_rects: [],
        replace_native: false,
        results,
      },
    ],
    true,
    true
  );
  const signals = new Map<number, ProjSignals>();
  const parsed = projectPagesForMarkdown(pages, input ? signals : undefined);
  if (net && input) {
    for (const pp of parsed) {
      const pm = await runPage(
        net,
        null,
        input,
        signals.get(pp.page_number) ?? null,
        defaultDecodeOptions()
      );
      pp.model_tables = pm.tables;
      pp.model_classes = pm.classes;
      pp.model_blocks = pm.blocks;
      // split lines the projection ran across two of the model's blocks (narrow gutters)
      resegmentByModelBlocks(pp);
    }
  }
  const docSignals = documentSignals(parsed, options.keepHeadersFooters);
  const blockOptions = {
    outline: [],
    image_mode: "placeholder" as const,
    keep_headers_footers: options.keepHeadersFooters,
  };
  const blocks = parsed.map((p) => extractBlocks(p, docSignals, blockOptions));
  const markdown =
    applyLayoutBlocks(parsed, blocks, { wantsMarkdown: true, extractBlocks: true }) ?? "";
  // last geometry stage: projection and layout ran on upright OCR items
  rotateBackOcrDeskew(parsed);
  return { page: parsed[0], markdown, dpi };
}
