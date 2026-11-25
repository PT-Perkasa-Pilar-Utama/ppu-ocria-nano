// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/output/json.rs (crates-v2.21.2, Apache-2.0): format_json, format_json_with_text_metadata and format_json_result.

import type { ParsedPage } from "../types/page.js";
import { buildJson } from "./build-json.js";
import { parseResultValue } from "./json-values.js";
import { toStringPretty } from "./serde-json.js";
import type { ParseResult } from "./types.js";

/**
 * Format complete parse output, including extracted-image metadata and
 * document-level fields (form type, XFA packets). Pixel bytes are written
 * separately by the CLI's `--image-output-dir` option.
 */
export function formatJsonResult(result: ParseResult, extractTextMetadata: boolean): string {
  const json = buildJson(result.pages, extractTextMetadata);
  json.total_pages = result.total_pages;
  json.images = result.images.map((image) => ({
    id: image.id,
    name: image.name,
    ...(image.path == null ? {} : { path: image.path }),
    page: image.page,
    bbox: image.bbox,
    width: image.width,
    height: image.height,
    rotation: image.rotation,
    format: image.format,
    ...(image.duplicate_of == null ? {} : { duplicate_of: image.duplicate_of }),
  }));
  json.page_errors = result.page_errors;
  json.image_error_count = result.image_error_count;
  if (result.form_type != null) json.form_type = result.form_type;
  if (result.xfa_packets != null) json.xfa_packets = result.xfa_packets;
  return toStringPretty(parseResultValue(json));
}

/** Format parsed pages as JSON, optionally including rich PDF text metadata. */
export function formatJsonWithTextMetadata(
  pages: readonly ParsedPage[],
  extractTextMetadata: boolean
): string {
  return toStringPretty(parseResultValue(buildJson(pages, extractTextMetadata)));
}

/** Format parsed pages as pretty-printed JSON string. */
export function formatJson(pages: readonly ParsedPage[]): string {
  return formatJsonWithTextMetadata(pages, false);
}
