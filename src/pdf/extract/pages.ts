// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): extract_pages_and_images, extract_single_page, extract_page_image_refs.

// What is not ported, because `PdfOptions` cannot reach it: annotations, form fields, the structure
// tree, embedded image bytes, vector graphics and content bounds. `extractPagesAndImages` rejects
// the options that ask for them. Flattening of AcroForm widgets (to read the text of filled fields)
// is ported: LiteParse does it for every document with a form, whatever the options.

import type { Page as LitePage } from "../../ocria/types/page.js";
import type { ImageRef, PageError } from "../../ocria/types/document.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { f32, trim } from "../../ocria/rust.js";
import type { Document } from "../pdfium/document.js";
import { imageObjects } from "../pdfium/page-images.js";
import { pageLinks } from "../pdfium/page-links.js";
import { pathObjects } from "../pdfium/page-paths.js";
import {
  flattenFormWidgets,
  formWidgetTextRects,
  textObjectsOverlap,
} from "../pdfium/page-widgets.js";
import type { Page } from "../pdfium/page.js";
import { structTree } from "../pdfium/struct-tree.js";
import type { RectF } from "../pdfium/types.js";
import type { GlyphResolver } from "../glyph-resolver/index.js";
import { assignLinks, assignStrikethrough, assignUnderline } from "./annotate.js";
import { extractLayoutGraphics } from "./graphics.js";
import { pageMathItems } from "./math-spans.js";
import type { ExtractionOutputOptions } from "./options.js";
import { extractPageTextItems } from "./page-text.js";

/** Smallest image side kept as an `ImageRef`, in points. */
const IMAGE_MIN_SIZE_PT = 25;
/** Images covering more than this share of the page in both dimensions are backgrounds, not figures. */
const IMAGE_MAX_COVERAGE = 0.9;

/** The extract stage's request (`stages::ExtractRequest`). */
export type ExtractRequest = {
  /** 1-based pages to extract; null means every page. */
  targetPages: readonly number[] | null;
  /** Upper bound on extracted pages, applied after `targetPages`. */
  maxPages: number;
  /** Resolve link annotations onto the text items they cover. */
  extractLinks: boolean;
  glyphResolver: GlyphResolver | null;
  output: ExtractionOutputOptions;
};

/** `ExtractedPages`, without the image payloads that are not extracted. */
export type ExtractedPages = {
  pages: LitePage[];
  page_errors: PageError[];
  image_error_count: number;
  /**
   * Whether any page was flattened to recover form-widget text. Flattening mutates the open
   * document, so a consumer that needs the original must reopen the input.
   */
  flattened_form_widgets: boolean;
  /** The pages flattened: a reopened document must flatten exactly these to match what extraction saw. */
  flattened_page_numbers: number[];
};

/** The options of `ExtractionOutputOptions` that have no port. */
const UNPORTED_OUTPUTS = [
  "extract_content_bounds",
  "extract_images",
  "extract_vector_graphics",
  "extract_annotations",
  "extract_form_fields",
  "extract_structure_tree",
] as const;

/** `ExtractedImageRefs`. */
type PageImageRefs = { refs: ImageRef[]; errorCount: number };

/** `extract_page_image_refs` with `include_data = false`: one `ImageRef` per placed image. */
function pageImageRefs(page: Page, pageNumber: number): PageImageRefs {
  const extracted = imageObjects(page, IMAGE_MIN_SIZE_PT, IMAGE_MAX_COVERAGE);
  const refs = extracted.images.map((image, i) => ({
    // 1-based image number to match the platform extractor's `img_p%d_%d` naming.
    id: `p${pageNumber}_${i + 1}`,
    bbox: { ...image.bounds },
    obj_index: image.object_index,
    format: "png",
    pixel_width: 0,
    pixel_height: 0,
    rotation: 0,
    bits_per_pixel: 0,
    colorspace: 0,
  }));
  return { refs, errorCount: extracted.error_count };
}

/** `PageExtraction`: what one extracted page contributes. */
type PageExtraction = {
  page: LitePage;
  imageErrorCount: number;
  flattenedFormWidgets: boolean;
};

/** `extract_single_page`. */
function extractSinglePage(
  document: Document,
  pageIndex: number,
  pageNumber: number,
  request: ExtractRequest,
  documentHasForm: boolean
): PageExtraction {
  let page = document.page(pageIndex);
  // The page handle is closed before flattening, which can throw before a new one is loaded.
  let pageOpen = true;
  try {
    const rawWidth = page.width();
    const rawHeight = page.height();
    const viewBox: RectF = page.viewBox() ?? {
      left: 0,
      top: rawHeight,
      right: rawWidth,
      bottom: 0,
    };
    // All extracted geometry is in the rotation-adjusted viewport space, so the page size is too.
    const [pageWidth, pageHeight] = page.viewportSize(viewBox);
    const links = request.extractLinks ? pageLinks(page, viewBox) : [];
    const paths = pathObjects(page, viewBox);
    const graphics = extractLayoutGraphics(paths);
    const structNodes = structTree(page, viewBox).map((n) => ({
      role: n.role,
      mcids: n.mcids,
      bbox:
        n.bbox === null
          ? null
          : {
              x: n.bbox.left,
              y: n.bbox.top,
              width: f32(n.bbox.right - n.bbox.left),
              height: f32(n.bbox.bottom - n.bbox.top),
            },
      alt_text: n.alt_text,
    }));
    const imageRefs = pageImageRefs(page, pageNumber);
    // PDFium's text API reads only the page content stream. Filled form values commonly live in
    // widget appearance streams, so promote only those widget appearances into page content and
    // reload before text extraction. `widgetRects` is empty for nearly every page: a document
    // with no AcroForm never reaches the annotation walk.
    let flattenedFormWidgets = false;
    const widgetRects = documentHasForm ? formWidgetTextRects(page, viewBox) : [];
    let textItems: TextItem[];
    if (widgetRects.length === 0) {
      textItems = pageTextItems(page, viewBox, paths, request);
    } else {
      // PDFium's text layer keeps only one of two runs that start at essentially the same point,
      // so a flattened appearance can suppress page text it lands on. Usually widget rects sit
      // over blank space, and this bounds-only probe says so without the text API; only when a
      // widget covers existing text do we extract twice and put back what was suppressed.
      const before = textObjectsOverlap(page, viewBox, widgetRects)
        ? pageTextItems(page, viewBox, paths, request)
        : null;
      page.close();
      pageOpen = false;
      const flattened = flattenFormWidgets(document, pageIndex);
      page = flattened ?? document.page(pageIndex);
      pageOpen = true;
      textItems = pageTextItems(page, viewBox, paths, request);
      if (flattened !== null) {
        flattenedFormWidgets = true;
        if (before !== null) restoreFlattenedOverText(textItems, before, widgetRects);
      }
    }
    assignLinks(textItems, links);
    assignStrikethrough(textItems, graphics);
    assignUnderline(textItems, graphics);
    return {
      page: {
        page_number: pageNumber,
        page_label: document.pageLabel(pageIndex),
        page_width: pageWidth,
        page_height: pageHeight,
        text_items: textItems,
        graphics,
        struct_nodes: structNodes,
        image_refs: imageRefs.refs,
      },
      imageErrorCount: imageRefs.errorCount,
      flattenedFormWidgets,
    };
  } finally {
    if (pageOpen) page.close();
  }
}

/**
 * `restore_flattened_over_text`: put back page text that flattening suppressed. When the two runs
 * carry the same string (a producer that wrote the value into both the content stream and the
 * appearance) the dedup is right and the trimmed text matches; when they differ, such as a
 * pre-printed label where the value is typed, dropping one is data loss, so the pre-flatten copy
 * is restored. Recovers one direction only: if the collision goes the other way PDFium can
 * suppress the appearance text, and the field value is lost.
 */
function restoreFlattenedOverText(
  items: TextItem[],
  before: readonly TextItem[],
  widgetRects: readonly RectF[]
): void {
  const surviving = new Set<string>();
  for (const item of items) {
    const text = trim(item.text);
    if (text !== "") surviving.add(text);
  }
  const restored = before.filter((item) => {
    const text = trim(item.text);
    return (
      text !== "" && !surviving.has(text) && widgetRects.some((r) => rectContainsCenter(r, item))
    );
  });
  items.push(...restored);
}

function rectContainsCenter(rect: RectF, item: TextItem): boolean {
  const cx = f32(item.x + f32(item.width / 2));
  const cy = f32(item.y + f32(item.height / 2));
  return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
}

/** The `extract_text` closure: math spans, the text pass, then the math items spliced in. */
function pageTextItems(
  page: Page,
  viewBox: RectF,
  paths: ReturnType<typeof pathObjects>,
  request: ExtractRequest
): TextItem[] {
  const textPage = page.text();
  try {
    const math = pageMathItems(
      page,
      textPage,
      viewBox,
      paths,
      request.glyphResolver,
      request.output.keep_clipped_text
    );
    const items = extractPageTextItems(
      page,
      textPage,
      viewBox,
      request.glyphResolver,
      request.output,
      math.consumed
    );
    items.push(...math.items);
    return items;
  } finally {
    textPage.close();
  }
}

/** `extract_pages_and_images`: extract the selected pages of an open document. */
export function extractPagesAndImages(document: Document, request: ExtractRequest): ExtractedPages {
  for (const flag of UNPORTED_OUTPUTS) {
    if (request.output[flag]) throw new Error(`extract: ${flag} is not supported in this port`);
  }
  const pageCount = document.pageCount();
  const pages: LitePage[] = [];
  const pageErrors: PageError[] = [];
  let imageErrorCount = 0;
  const flattenedPageNumbers: number[] = [];
  // Read at load, not now: an earlier page's flattening drops `/AcroForm` for the whole document.
  const documentHasForm = document.formTypeAtLoad() !== 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const pageNumber = pageIndex + 1;
    if (request.targetPages !== null && !request.targetPages.includes(pageNumber)) continue;
    if (pages.length + pageErrors.length >= request.maxPages) break;
    try {
      const extraction = extractSinglePage(
        document,
        pageIndex,
        pageNumber,
        request,
        documentHasForm
      );
      if (extraction.flattenedFormWidgets) flattenedPageNumbers.push(pageNumber);
      pages.push(extraction.page);
      imageErrorCount += extraction.imageErrorCount;
    } catch (error) {
      if (!request.output.continue_on_page_error) throw error;
      pageErrors.push({
        page: pageNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    pages,
    page_errors: pageErrors,
    image_error_count: imageErrorCount,
    flattened_form_widgets: flattenedPageNumbers.length > 0,
    flattened_page_numbers: flattenedPageNumbers,
  };
}
