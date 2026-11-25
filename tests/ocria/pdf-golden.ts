// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Shared setup of the PDF golden tests: the ten PDF fixtures, one pdfium instance, and the
// extract stage run with the configuration the goldens record.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OcriaNanoService } from "../../src/index.js";
import type { Page, ParsedPage } from "../../src/ocria/types/page.js";
import { defaultExtractionOutputOptions } from "../../src/pdf/extract/options.js";
import type { Document } from "../../src/pdf/pdfium/document.js";
import { Library } from "../../src/pdf/pdfium/library.js";
import type { SystemFont } from "../../src/pdf/pdfium/system-fonts.js";
import { parsePdf } from "../../src/pdf/pipeline/parse-pdf.js";
import { extract, open } from "../../src/pdf/stages/index.js";

export const PDF_GOLDENS: readonly string[] = [
  "borderless",
  "digital",
  "legacy-font",
  "multipage",
  "rotate-90",
  "rtl-text",
  "scanned",
  "sideways",
  "structured",
  "vertical-text",
];

const PAGES_DIR = join(import.meta.dir, "../fixtures/pages");

export function pdfBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(PAGES_DIR, `${name}.pdf`)));
}

// The goldens come from a native macOS pdfium, which substitutes these system fonts for the
// standard-14 fonts. With them installed the wasm build reproduces every golden checkpoint; on a
// host without them the tests fall back to what the substituted fonts do not change.
// PDF_TEST_FONT_DIR points at another folder of the same files (or at none, to test the fallback).
const FONT_DIR = process.env.PDF_TEST_FONT_DIR ?? "/System/Library/Fonts/Supplemental";
const FONT_NAMES = ["Arial", "Times New Roman", "Courier New"].flatMap((family) => [
  family,
  `${family} Bold`,
  `${family} Italic`,
  `${family} Bold Italic`,
]);

const fontFiles = FONT_NAMES.map((name) => ({ name, path: join(FONT_DIR, `${name}.ttf`) }));

/** Whether the system fonts the goldens were made with are on this host. */
export const HAS_NATIVE_FONTS: boolean = fontFiles.every((f) => existsSync(f.path));

function nativeFonts(): SystemFont[] {
  return HAS_NATIVE_FONTS
    ? fontFiles.map((f) => ({ name: f.name, data: new Uint8Array(readFileSync(f.path)) }))
    : [];
}

let library: Promise<Library> | undefined;

/** One pdfium instance for the whole test file. */
export function pdfiumLibrary(): Promise<Library> {
  library ??= Library.init({ fonts: nativeFonts() });
  return library;
}

/** `open` with no corrections. */
export async function openPdf(name: string): Promise<Document> {
  return open(await pdfiumLibrary(), pdfBytes(name), null, []);
}

/**
 * The extract stage as `parse_resolved` runs it for the goldens' configuration: Markdown output
 * (links on, word boxes on for the block extraction), no optional outputs.
 */
export function extractGoldenPages(document: Document): Page[] {
  return extract(document, {
    targetPages: null,
    maxPages: 1000,
    extractLinks: true,
    glyphResolver: null,
    output: { ...defaultExtractionOutputOptions(), emit_word_boxes: true, split_scripts: true },
  }).pages;
}

/** The OCR render resolution of the goldens' runs (LiteParse's `DEFAULT_DPI`; the package default is 250). */
export const GOLDEN_DPI = 150;

/** Every stage value of one parse, under the checkpoint names of the goldens, and the parse's output. */
export type PdfRun = {
  checkpoints: Map<string, unknown>;
  pages: ParsedPage[];
  markdown: string;
};

let service: Promise<OcriaNanoService> | undefined;

/** The models, loaded once for the whole test file. */
export function ocriaService(): Promise<OcriaNanoService> {
  service ??= (async () => {
    const s = new OcriaNanoService();
    await s.initialize();
    return s;
  })();
  return service;
}

const runs = new Map<string, Promise<PdfRun>>();

/** `parsePdf` on one fixture with the goldens' configuration, once per fixture. */
export function runPdf(name: string): Promise<PdfRun> {
  let run = runs.get(name);
  if (run === undefined) {
    run = (async () => {
      const checkpoints = new Map<string, unknown>();
      const parsed = await parsePdf(
        (await ocriaService()).models,
        await pdfiumLibrary(),
        pdfBytes(name),
        {
          dpi: GOLDEN_DPI,
          maxPages: 1000,
          password: null,
          keepHeadersFooters: false,
          glyphResolver: null,
          observe: (k, v) => checkpoints.set(k, v),
        }
      );
      const markdown = parsed.pages.map((p) => p.markdown).join("\n\n-----\n\n");
      return { checkpoints, pages: parsed.pages, markdown };
    })();
    runs.set(name, run);
  }
  return run;
}
