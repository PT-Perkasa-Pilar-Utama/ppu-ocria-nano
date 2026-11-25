// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * @module
 *
 * PDF input for OCRia-nano: LiteParse's PDF path in TypeScript. Each page keeps its text layer
 * where there is one, and is OCR'd where it has none (scans), where the layer is garbled, or
 * where embedded images carry text. Tables, layout blocks and markdown follow the image path.
 * pdfium is LiteParse's own build, linked to WebAssembly and shipped with this entry.
 *
 * @example
 * ```ts
 * import { OcriaNanoService } from "ppu-ocria-nano";
 * import { convertPdf } from "ppu-ocria-nano/pdf";
 *
 * const service = new OcriaNanoService();
 * await service.initialize();
 * const pages = await convertPdf(service, pdfBytes);
 * console.log(pages.map((p) => p.markdown).join("\n\n-----\n\n"));
 * ```
 */

import { toPage } from "../core/page.js";
import type { Page } from "../core/page.js";
import { isPdf } from "../core/is-pdf.js";
import type { ParseModels } from "../ocria/pipeline/parse-image.js";
import type { GlyphResolver } from "./glyph-resolver/index.js";
import type { LoadPdfiumOptions } from "./pdfium/module.js";
import { Library } from "./pdfium/library.js";
import { hostFonts } from "./host-fonts.js";
import type { SystemFont } from "./pdfium/system-fonts.js";
import { parsePdf } from "./pipeline/parse-pdf.js";

export { isPdf } from "../core/is-pdf.js";
export type { GlyphResolver } from "./glyph-resolver/index.js";
export type { SystemFont } from "./pdfium/system-fonts.js";
export { hostFonts } from "./host-fonts.js";

/** LiteParse's `max_pages` default. */
const DEFAULT_MAX_PAGES = 1000;

/** OCRia-nano's render resolution for OCR (LiteParse's `OCRIA_NANO_DPI`). */
const DEFAULT_PDF_DPI = 250;

export type PdfOptions = {
  /** Resolution, in dpi, of the page renders that go to OCR. Default 250. */
  dpi?: number;
  /** Read at most this many pages, counted from the first. Default 1000, as LiteParse. */
  maxPages?: number;
  /** Password of an encrypted PDF. */
  password?: string;
  /** Keep page headers and footers in the markdown. Default: the service's `keepHeadersFooters`. */
  keepHeadersFooters?: boolean;
  /** Where `pdfium.wasm` is served, for a browser or a bundler that moves it. */
  wasmUrl?: string | URL;
  /**
   * Fonts pdfium substitutes for the standard-14 fonts a PDF uses without embedding them: named
   * `Arial`, `Arial Bold`, `Arial Italic`, `Arial Bold Italic`, `Times New Roman` (the same four
   * styles) and `Courier New` (the same four), as TrueType files. LiteParse ran with these three
   * families installed, and every text box depends on their ascent, descent and advances: Arial
   * itself reproduces LiteParse's boxes exactly (tests/ocria/pdf-*.test.ts check it against the
   * goldens); a metric-compatible font (Liberation Sans, Liberation Serif, Liberation Mono) under
   * those names should come close, and is not tested. Default on Node, Bun and Deno: the host's
   * own files (`hostFonts()`), as a native LiteParse reads them; in a browser, none. Pass `[]` for
   * pdfium's built-in fonts, whose boxes differ by a fraction of a point. Applied when the pdfium
   * instance is first loaded.
   */
  fonts?: readonly SystemFont[];
  /** A last-resort glyph recovery hook for fonts whose glyph names and cmap are both unusable. */
  glyphResolver?: GlyphResolver;
};

/** What `convertPdf` needs of the service: its loaded models. */
export type PdfService = { readonly models: ParseModels; readonly keepHeadersFooters: boolean };

// One pdfium instance serves every call: instances hold no document between calls, and loading
// the 4 MB module costs more than parsing a small PDF. A different `wasmUrl` is a different instance.
const libraries = new Map<string, Promise<Library>>();

/** Instantiate pdfium; a failed load must not stay cached. */
async function initLibrary(key: string, options: LoadPdfiumOptions): Promise<Library> {
  try {
    return await Library.init(options);
  } catch (error) {
    libraries.delete(key);
    throw error;
  }
}

/** The shared pdfium instance for this wasm location. */
export function loadPdfium(options: LoadPdfiumOptions = {}): Promise<Library> {
  const fonts = (options.fonts ?? []).map((f) => `${f.name}:${f.data.length}`).join(",");
  const key = `${options.wasmUrl === undefined ? "" : String(options.wasmUrl)}|${fonts}`;
  let library = libraries.get(key);
  if (library === undefined) {
    library = initLibrary(key, options);
    libraries.set(key, library);
  }
  return library;
}

/**
 * Convert a PDF: pages in order, each as the image path's `Page`. Throws for bytes that are not a
 * PDF, for a PDF pdfium cannot open (including a wrong or missing password), and for an OCR
 * failure on every page that needed OCR.
 */
export async function convertPdf(
  service: PdfService,
  bytes: ArrayBuffer | Uint8Array,
  options: PdfOptions = {}
): Promise<Page[]> {
  // read first: before initialize() the error names initialize(), not the PDF
  const models = service.models;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPdf(data)) throw new Error("not a PDF: the bytes do not start with %PDF-");
  const fonts = options.fonts ?? (await hostFonts());
  const lib = await loadPdfium({ wasmUrl: options.wasmUrl, fonts });
  const parsed = await parsePdf(models, lib, data, {
    dpi: options.dpi ?? DEFAULT_PDF_DPI,
    maxPages: options.maxPages && options.maxPages > 0 ? options.maxPages : DEFAULT_MAX_PAGES,
    password: options.password ?? null,
    keepHeadersFooters: options.keepHeadersFooters ?? service.keepHeadersFooters,
    glyphResolver: options.glyphResolver ?? null,
  });
  return parsed.pages.map((page, i) => toPage(page, page.markdown, parsed.dpis[i]));
}
