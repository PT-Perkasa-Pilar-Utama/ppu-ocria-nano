// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Types, model pins and the pure LiteParse stages, shared by the node, web
// and mobile entries. The stages take and return LiteParse's own serde-shaped
// types (`ParsedPage`, `ExtractedPage`, ...); `Page.parsed` is one.

export type { BatchItemResult } from "./core/batch.js";
export type { ImageInput, PageImage, Pixels } from "./core/ocria-nano.service.js";
export type { BlockCell, Box, Page, PageBlock, PageItem } from "./core/page.js";
export { toPage } from "./core/page.js";
export type { BatchOptions, ModelSources, OcriaNanoOptions, SessionOptions } from "./interface.js";
export {
  BASE_FILES,
  MODEL_BASE_URL,
  MODEL_FILES,
  MODEL_MIRROR_BASE_URL,
  MODEL_REVISION,
  MODEL_VERSION,
  RECOGNIZER_FILES,
  defaultModelUrl,
  mirrorModelUrl,
  verifyModelFile,
} from "./model-catalogue.js";
export type { ModelFile, PinnedFile, RecognizerFiles } from "./model-catalogue.js";

// the OCR stage
export type { Detection } from "./ocria/ocr/det.js";
export type { Pt, Quad } from "./ocria/ocr/img.js";
export type { OcrResult, OcrWord } from "./ocria/ocr/types.js";
export { imagePage, imageRaster, ocrImageDpi, readImageDpi } from "./ocria/image-page.js";

// the stages after OCR, in pipeline order
export { mergeOcrResults } from "./ocria/ocr-merge/index.js";
export type { PageOcrOutcome } from "./ocria/ocr-merge/index.js";
export { projectPagesForMarkdown, projectPagesToGrid } from "./ocria/projection/index.js";
export type { ProjSignalItem, ProjSignals } from "./ocria/projection/signals.js";
export { defaultDecodeOptions, runPage } from "./ocria/table-model/index.js";
export type { DecodeOptions, PageInput, PageModel, TableNet } from "./ocria/table-model/index.js";
export { resegmentByModelBlocks } from "./ocria/resegment/index.js";
export { documentSignals } from "./ocria/stages/document-signals.js";
export type { DocumentSignals } from "./ocria/stages/document-signals.js";
export { extractBlocks } from "./ocria/stages/extract-blocks.js";
export type { BlockOptions } from "./ocria/stages/extract-blocks.js";
export { renderPageMarkdown } from "./ocria/stages/render-page-markdown.js";
export { layoutBlocks } from "./ocria/stages/layout-blocks.js";
export { rotateBackOcrDeskew } from "./ocria/stages/rotate-back.js";
export { formatJson, formatText } from "./ocria/output/index.js";
export { parseImage } from "./ocria/pipeline/parse-image.js";
export type { ParseModels, ParsedImage } from "./ocria/pipeline/parse-image.js";

// LiteParse's types
export type { LayoutBlock, LayoutCell } from "./ocria/layout/types.js";
export type { Block, PositionedBlock } from "./ocria/markdown-layout/block-types.js";
export type { Rect } from "./ocria/types/geometry.js";
export type { Page as ExtractedPage, ParsedPage, ProjectedLine } from "./ocria/types/page.js";
export type { TextItem } from "./ocria/types/text-item.js";
