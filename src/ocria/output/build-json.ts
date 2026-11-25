// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/output/json.rs and types.rs (crates-v2.21.2, Apache-2.0): build_json and TextItem::text_metadata.

import { f32 } from "../rust.js";
import type { ParsedPage } from "../types/page.js";
import type { TextItem } from "../types/text-item.js";
import type { JsonPage, JsonTextItem, ParseResultJson } from "./json-types.js";

/**
 * The `TextItem` fields governed by `extract_text_metadata`, pre-gated by `textMetadata`. Every
 * field is absent when extraction is off, even the plain-bool fields on `TextItem`.
 */
export type TextMetadata = {
  font_height?: number;
  font_ascent?: number;
  font_descent?: number;
  font_weight?: number;
  text_width?: number;
  font_is_buggy?: boolean;
  mcid?: number;
  fill_color?: string;
  stroke_color?: string;
  char_codes?: number[];
  trailing_space_generated?: boolean;
};

/** `TextItem::text_metadata`: real values when `enabled`, all absent otherwise. */
export function textMetadata(item: TextItem, enabled: boolean): TextMetadata {
  if (!enabled) return {};
  return {
    ...(item.font_height == null ? {} : { font_height: item.font_height }),
    ...(item.font_ascent == null ? {} : { font_ascent: item.font_ascent }),
    ...(item.font_descent == null ? {} : { font_descent: item.font_descent }),
    ...(item.font_weight == null ? {} : { font_weight: item.font_weight }),
    ...(item.text_width == null ? {} : { text_width: item.text_width }),
    font_is_buggy: item.font_is_buggy,
    ...(item.mcid == null ? {} : { mcid: item.mcid }),
    ...(item.fill_color == null ? {} : { fill_color: item.fill_color }),
    ...(item.stroke_color == null ? {} : { stroke_color: item.stroke_color }),
    char_codes: item.char_codes,
    trailing_space_generated: item.trailing_space_generated,
  };
}

function jsonTextItem(item: TextItem, extractTextMetadata: boolean): JsonTextItem {
  const meta = textMetadata(item, extractTextMetadata);
  return {
    text: item.text,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    // Not part of TextMetadata: the API surfaces always expose rotation; only
    // the CLI JSON gates it to keep the default output byte-stable.
    ...(extractTextMetadata ? { rotation: item.rotation } : {}),
    ...(item.font_name == null ? {} : { font_name: item.font_name }),
    ...(item.font_size == null ? {} : { font_size: item.font_size }),
    ...meta,
    char_codes: meta.char_codes ?? [],
    trailing_space_generated: meta.trailing_space_generated ?? false,
    confidence: item.confidence ?? f32(1),
  };
}

function jsonPage(page: ParsedPage, extractTextMetadata: boolean): JsonPage {
  return {
    page: page.page_number,
    ...(page.page_label == null ? {} : { page_label: page.page_label }),
    width: page.page_width,
    height: page.page_height,
    ...(page.content_bounds == null ? {} : { content_bounds: page.content_bounds }),
    text: page.text,
    text_items: page.text_items.map((item) => jsonTextItem(item, extractTextMetadata)),
    ...(page.vector_graphics == null ? {} : { vector_graphics: page.vector_graphics }),
    ...(page.annotations == null ? {} : { annotations: page.annotations }),
    ...(page.form_fields == null ? {} : { form_fields: page.form_fields }),
    ...(page.structure_tree == null ? {} : { structure_tree: page.structure_tree }),
    ...(page.blocks == null ? {} : { blocks: page.blocks }),
  };
}

/**
 * Build structured JSON output from parsed pages.
 *
 * ponytail: `ParsedPage::complexity` is not on the TS `ParsedPage`, so `JsonPage.complexity` is
 * never written; add it with the type and `parseResultValue` when a caller sets
 * `include_complexity`.
 */
export function buildJson(
  pages: readonly ParsedPage[],
  extractTextMetadata: boolean
): ParseResultJson {
  return {
    total_pages: Math.min(pages.length, 0xffffffff),
    images: [],
    page_errors: [],
    image_error_count: 0,
    pages: pages.map((page) => jsonPage(page, extractTextMetadata)),
  };
}
