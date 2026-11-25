// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/output/json.rs (crates-v2.21.2, Apache-2.0): the JSON output structs.

import type { LayoutBlock } from "../layout/types.js";
import type { DocumentAnnotation, FormField, PageError, StructureTree } from "../types/document.js";
import type { Rect, VectorGraphics } from "../types/geometry.js";
import type { XfaPacket } from "./types.js";

// A field with `skip_serializing_if` is optional here; the printer omits it when absent.

export type JsonTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  font_name?: string;
  font_size?: number;
  font_height?: number;
  font_ascent?: number;
  font_descent?: number;
  font_weight?: number;
  text_width?: number;
  font_is_buggy?: boolean;
  mcid?: number;
  fill_color?: string;
  stroke_color?: string;
  char_codes: number[];
  trailing_space_generated: boolean;
  confidence?: number;
};

export type JsonPage = {
  page: number;
  /** The document's `/PageLabels` label for this page, omitted when the PDF defines none. */
  page_label?: string;
  width: number;
  height: number;
  content_bounds?: Rect;
  text: string;
  text_items: JsonTextItem[];
  vector_graphics?: VectorGraphics;
  annotations?: DocumentAnnotation[];
  form_fields?: FormField[];
  structure_tree?: StructureTree;
  blocks?: LayoutBlock[];
};

export type JsonImage = {
  id: string;
  name: string;
  path?: string;
  page: number;
  bbox: Rect;
  width: number;
  height: number;
  rotation: number;
  format: string;
  duplicate_of?: string;
};

export type ParseResultJson = {
  total_pages: number;
  pages: JsonPage[];
  page_errors: PageError[];
  images: JsonImage[];
  image_error_count: number;
  form_type?: number;
  /** Raw XFA packets, present only when `extract_xfa_packets` was requested. */
  xfa_packets?: XfaPacket[];
};
