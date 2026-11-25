// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/types.rs (crates-v2.21.2, Apache-2.0): document-level types.

import type { Rect } from "./geometry.js";

/** One PDF page annotation, in viewport space. */
export type DocumentAnnotation = {
  subtype: string;
  contents?: string;
  created?: string;
  modified?: string;
  title?: string;
  rect?: Rect;
  quadpoint_rects: Rect[];
  uri?: string;
};

/** Scalar value from a tagged-PDF structure element's `/A` dictionary (serde untagged). */
export type StructureAttributeValue = boolean | number | string;

export type StructureTree = { roots: StructureTreeElement[] };

export type StructureTreeElement = {
  type: string;
  id?: string;
  actual_text?: string;
  alt_text?: string;
  title?: string;
  attributes: Record<string, StructureAttributeValue>;
  marked_content_ids: number[];
  children: StructureTreeElement[];
  annotations: DocumentAnnotation[];
};

/** One AcroForm widget and its resolved field metadata. */
export type FormField = {
  id: string;
  type: string;
  page: number;
  annotation_index: number;
  widget_index: number;
  object_number?: number;
  name?: string;
  alternate_name?: string;
  value?: string;
  export_value?: string;
  field_flags: number;
  control_count?: number;
  control_index?: number;
  checked?: boolean;
  rect?: Rect;
  options: string[];
  selected_options: string[];
};

/** One entry in the document outline; `y_pdf` is in PDF user space (bottom-left origin). */
export type OutlineTarget = {
  level: number;
  title: string;
  page_index: number;
  y_pdf: number | null;
};

/** One structure-tree node of a tagged page, pre-flattened in pre-order. */
export type StructNode = {
  role: string;
  mcids: number[];
  bbox: Rect | null;
  alt_text: string | null;
};

/** One embedded raster image on a page; `id` is the markdown link target slug. */
export type ImageRef = {
  id: string;
  bbox: Rect;
  obj_index: number;
  format: string;
  pixel_width: number;
  pixel_height: number;
  rotation: number;
  bits_per_pixel: number;
  colorspace: number;
};

/** A page that could not be extracted while tolerant page errors were enabled. */
export type PageError = { page: number; message: string };
