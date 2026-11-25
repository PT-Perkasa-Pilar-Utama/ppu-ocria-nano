// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of LiteParse::parse_resolved in liteparse crates/liteparse/src/parser.rs (crates-v2.21.2, Apache-2.0),
// for a PDF with the configuration the goldens record (see docs/port-progress/pdf.md).

// The stages run in parse_resolved's order: open, outline, extract, table inputs, OCR render and
// recognition, OCR merge, projection, LayoutNet, blocks and markdown. After the OCR merge the
// chain is the one of src/ocria/pipeline/parse-image.ts.

import { mergeOcrResults } from "../../ocria/ocr-merge/index.js";
import { projectPagesForMarkdown } from "../../ocria/projection/index.js";
import type { ProjSignals } from "../../ocria/projection/signals.js";
import { resegmentByModelBlocks } from "../../ocria/resegment/index.js";
import { applyLayoutBlocks } from "../../ocria/stages/apply-layout-join.js";
import { documentSignals } from "../../ocria/stages/document-signals.js";
import { extractBlocks } from "../../ocria/stages/extract-blocks.js";
import { rotateBackOcrDeskew } from "../../ocria/stages/rotate-back.js";
import { isWhitespace } from "../../ocria/rust.js";
import type { PageInput } from "../../ocria/table-model/index.js";
import { defaultDecodeOptions, runPage } from "../../ocria/table-model/index.js";
import { hasImg } from "../../ocria/table-model/net-onnx.js";
import type { ParseModels } from "../../ocria/pipeline/parse-image.js";
import type { ParsedPage, Page } from "../../ocria/types/page.js";
import type { GlyphResolver } from "../glyph-resolver/index.js";
import { defaultExtractionOutputOptions } from "../extract/options.js";
import type { Library } from "../pdfium/library.js";
import { outline, extract, open } from "../stages/index.js";
import { attachRender, pageInput } from "../table-inputs/index.js";
import type { Document } from "../pdfium/document.js";
import type { OcrRenderOptions } from "../ocr-render/render.js";
import { ocrPages } from "./ocr-pass.js";

export type ParsePdfOptions = {
  /** OCR render resolution. */
  dpi: number;
  /** Pages extracted, counted from the first. */
  maxPages: number;
  password: string | null;
  /** Keep page headers and footers in the markdown. */
  keepHeadersFooters: boolean;
  glyphResolver: GlyphResolver | null;
  /** Receives a copy of each stage's value under the checkpoint names of the goldens (tests only). */
  observe?: (checkpoint: string, value: unknown) => void;
};

/** A parsed PDF: its pages, each with the resolution its OCR raster was rendered at (null when none was). */
export type ParsedPdf = {
  pages: ParsedPage[];
  /** `dpis[i]` belongs to `pages[i]`. */
  dpis: Array<number | null>;
};

/** `ocr_render_options` for a full parse. */
function renderOptions(dpi: number, reflattenPages: ReadonlySet<number>): OcrRenderOptions {
  return {
    dpi,
    reflattenPages,
    maxLongEdge: null,
    selection: null,
    despeckleScans: true,
    continueOnPageError: false,
  };
}

/** The table inputs, built from the document extraction has already run on (its character boxes differ from a fresh one's). */
function buildTableInputs(
  document: Document,
  pages: readonly Page[],
  render: boolean,
  withImg: boolean
): Array<[number, PageInput]> {
  const inputs: Array<[number, PageInput]> = [];
  for (const p of pages) {
    const page = document.page(p.page_number - 1);
    try {
      const input = pageInput(page, render, render && withImg);
      if (input !== null) inputs.push([p.page_number, input]);
    } finally {
      page.close();
    }
  }
  return inputs;
}

/** `render_table_inputs`: add the page renders the model reads its ruling lines and image from. */
function renderTableInputs(
  document: Document,
  inputs: Array<[number, PageInput]>,
  withImg: boolean
): void {
  for (const [pageNumber, input] of inputs) {
    const page = document.page(pageNumber - 1);
    try {
      attachRender(input, page, true, withImg);
    } finally {
      page.close();
    }
  }
}

/**
 * A page whose text is now mostly OCR (an invisible old OCR layer or a garbled layer replaced by
 * fresh OCR) is an OCR page for the table model too: built from the PDF's characters, its units
 * would rebuild tables out of the discarded layer.
 */
function markOcrPages(inputs: Array<[number, PageInput]>, pages: readonly Page[]): void {
  for (const [pageNumber, input] of inputs) {
    if (input.ocr) continue;
    const page = pages.find((p) => p.page_number === pageNumber);
    if (page === undefined) continue;
    let ocr = 0;
    let all = 0;
    for (const item of page.text_items) {
      const n = Array.from(item.text).filter((c) => !isWhitespace(c)).length;
      all += n;
      if (item.confidence != null) ocr += n;
    }
    if (all > 0 && ocr * 5 >= all * 4) {
      input.ocr = true;
      input.units = [];
    }
  }
}

/** Parse a PDF: text layer, OCR where needed, tables, layout blocks and markdown. */
export async function parsePdf(
  models: ParseModels,
  lib: Library,
  bytes: Uint8Array,
  options: ParsePdfOptions
): Promise<ParsedPdf> {
  const put = (checkpoint: string, value: unknown): void =>
    options.observe?.(checkpoint, structuredClone(value));
  const net = models.layout;
  let pages: Page[];
  let outlineTargets: ReturnType<typeof outline>;
  let tableInputs: Array<[number, PageInput]> = [];
  let reflatten: ReadonlySet<number> = new Set();
  const document = open(lib, bytes, options.password, []);
  try {
    outlineTargets = outline(document);
    const extracted = extract(document, {
      targetPages: null,
      maxPages: options.maxPages,
      extractLinks: true,
      glyphResolver: options.glyphResolver,
      // Markdown output turns word boxes and script runs on.
      output: { ...defaultExtractionOutputOptions(), emit_word_boxes: true, split_scripts: true },
    });
    pages = extracted.pages;
    reflatten = new Set(extracted.flattened_page_numbers);
    put("extract.pages", pages);
    // The units come from this document, which extraction has run on (PDFium reports slightly
    // different character boxes on a page it has extracted). The page renders are made later from
    // a reopened document, overlapping OCR in the Rust, unless extraction flattened something: a
    // reopened document renders the same only when it flattened nothing.
    const deferRenders = !extracted.flattened_form_widgets;
    if (net) tableInputs = buildTableInputs(document, pages, !deferRenders, hasImg(net));
    put("table.inputs", tableInputs);
  } finally {
    document.close();
  }
  // Each OCR round reopens the input, so its renders do not see what extraction did to the document.
  const ocrDocument = open(lib, bytes, options.password, []);
  let outcomes;
  try {
    outcomes = await ocrPages(
      ocrDocument,
      pages,
      models.engine,
      renderOptions(options.dpi, reflatten)
    );
    if (net && reflatten.size === 0) renderTableInputs(ocrDocument, tableInputs, hasImg(net));
  } finally {
    ocrDocument.close();
  }
  put("merge.input", { pages, outcomes, ocr_failure_fatal: true, emit_word_boxes: true });
  mergeOcrResults(pages, outcomes, true, true);
  put("merge.pages", pages);
  markOcrPages(tableInputs, pages);

  const signals = new Map<number, ProjSignals>();
  const parsed = projectPagesForMarkdown(pages, tableInputs.length > 0 ? signals : undefined);
  if (tableInputs.length > 0) {
    put("project.pages", parsed);
    put("project.signals", Object.fromEntries(signals));
    put("table.inputs.final", tableInputs);
  }
  if (net) {
    for (const [pageNumber, input] of tableInputs) {
      const pm = await runPage(
        net,
        null,
        input,
        signals.get(pageNumber) ?? null,
        defaultDecodeOptions()
      );
      const pp = parsed.find((p) => p.page_number === pageNumber);
      if (pp === undefined) continue;
      pp.model_tables = pm.tables;
      pp.model_classes = pm.classes;
      pp.model_blocks = pm.blocks;
      // split lines the projection ran across two of the model's blocks (narrow gutters)
      resegmentByModelBlocks(pp);
    }
  }
  const docSignals = documentSignals(parsed, options.keepHeadersFooters);
  const blockOptions = {
    outline: outlineTargets,
    image_mode: "placeholder" as const,
    keep_headers_footers: options.keepHeadersFooters,
  };
  const blocks = parsed.map((p) => extractBlocks(p, docSignals, blockOptions));
  applyLayoutBlocks(parsed, blocks, { wantsMarkdown: true, extractBlocks: true });
  // last geometry stage: projection and layout ran on upright OCR items
  rotateBackOcrDeskew(parsed);
  const dpis = parsed.map(
    (p) => outcomes.find((o) => o.page_number === p.page_number)?.dpi ?? null
  );
  return { pages: parsed, dpis };
}
