// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/types.rs and parser.rs (crates-v2.21.2, Apache-2.0): the result types the output stage reads.

import type { Rect } from "../types/geometry.js";
import type { PageError } from "../types/document.js";
import type { ParsedPage } from "../types/page.js";

/**
 * A raster image extracted from a page. `bytes` (not serialized in Rust) is not
 * modelled: the output stage never reads pixel data.
 */
export type ExtractedImage = {
  id: string;
  name: string;
  path?: string | null;
  page: number;
  bbox: Rect;
  width: number;
  height: number;
  rotation: number;
  format: string;
  duplicate_of?: string | null;
};

/** One raw packet from an XFA form document's `/XFA` array. */
export type XfaPacket = {
  index: number;
  name?: string | null;
  content_length: number;
  content?: string | null;
};

/**
 * The fields of `ParseResult` that `format_json_result` reads. The other fields
 * (`text`, `outline`, `screenshots`, `creator`, `producer`, `doc_meta`) never
 * reach the JSON output.
 */
export type ParseResult = {
  total_pages: number;
  pages: ParsedPage[];
  page_errors: PageError[];
  images: ExtractedImage[];
  image_error_count: number;
  form_type?: number | null;
  xfa_packets?: XfaPacket[] | null;
};
