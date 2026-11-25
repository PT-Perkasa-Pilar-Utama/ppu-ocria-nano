// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/types.rs (crates-v2.21.2, Apache-2.0): Page and ParsedPage.

import type { LayoutBlock } from "../layout/types.js";
import type { ModelBlock, ModelTable, UnitClass } from "../table-model/types.js";
import type {
  DocumentAnnotation,
  FormField,
  ImageRef,
  StructNode,
  StructureTree,
} from "./document.js";
import type { Anchor, GraphicPrimitive, Rect, Region, VectorGraphics } from "./geometry.js";
import type { TextItem } from "./text-item.js";

/** One page's extracted content, before projection. */
export type Page = {
  page_number: number;
  /** Tilt (degrees) the OCR merge removed from this page's OCR items. */
  ocr_deskew?: number | null;
  /** The document's `/PageLabels` entry for this page. */
  page_label?: string | null;
  page_width: number;
  page_height: number;
  /** Union bbox of the page's top-level content objects. */
  content_bounds?: Rect | null;
  text_items: TextItem[];
  graphics: GraphicPrimitive[];
  vector_graphics?: VectorGraphics | null;
  struct_nodes: StructNode[];
  image_refs: ImageRef[];
  annotations?: DocumentAnnotation[] | null;
  form_fields?: FormField[] | null;
  structure_tree?: StructureTree | null;
};

/** Per-line structural metadata derived during grid projection. */
export type ProjectedLine = {
  text: string;
  bbox: Rect;
  anchor: Anchor;
  indent_x: number;
  dominant_font_size: number;
  /** `dominant_font_size` came from the bbox height, not a real font size. */
  font_size_is_estimated: boolean;
  /** Matrix-derived size for heading detection only. */
  heading_font_size: number | null;
  dominant_font_name: string | null;
  all_bold: boolean;
  all_italic: boolean;
  all_mono: boolean;
  all_strike: boolean;
  spans: TextItem[];
  /** Index of each span's source item in the page's `text_items`. */
  span_item_indices: number[];
  /** The line's base direction is right-to-left. */
  rtl: boolean;
  /** Path from the region-tree root to the leaf holding this line. */
  region_path: number[];
  mcid: number | null;
  /** The line falls inside a detected figure region. */
  in_figure: boolean;
};

/** A page with its projected text layout. */
export type ParsedPage = {
  page_number: number;
  page_label?: string | null;
  page_width: number;
  page_height: number;
  content_bounds?: Rect | null;
  text: string;
  markdown: string;
  text_items: TextItem[];
  projected_lines: ProjectedLine[];
  regions: Region;
  graphics: GraphicPrimitive[];
  vector_graphics?: VectorGraphics | null;
  figures: Rect[];
  /** `(projected, original)` geometry of every text item, when the two differ for one. */
  projected_item_frames: Array<[Rect, Rect]>;
  model_tables: ModelTable[];
  model_classes: UnitClass[];
  model_blocks: ModelBlock[];
  struct_nodes: StructNode[];
  image_refs: ImageRef[];
  annotations?: DocumentAnnotation[] | null;
  form_fields?: FormField[] | null;
  structure_tree?: StructureTree | null;
  /** Classified layout blocks, when block extraction is on. */
  blocks?: LayoutBlock[] | null;
  /** Tilt carried from `Page.ocr_deskew` until the boxes are rotated back. */
  ocr_deskew?: number | null;
};
