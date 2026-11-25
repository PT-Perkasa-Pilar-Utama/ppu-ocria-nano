// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): ExtractionOutputOptions.

/** Which optional outputs the extract stage produces, and how it reads the text layer. */
export type ExtractionOutputOptions = {
  continue_on_page_error: boolean;
  extract_content_bounds: boolean;
  extract_text_metadata: boolean;
  extract_images: boolean;
  extract_vector_graphics: boolean;
  extract_annotations: boolean;
  extract_form_fields: boolean;
  extract_structure_tree: boolean;
  emit_word_boxes: boolean;
  /** Split items at a superscript or subscript run, so markdown can mark it. */
  split_scripts: boolean;
  /** Keep native text hidden by rectangular clips (overflow in a fixed-height cell). */
  keep_clipped_text: boolean;
};

/** `ExtractionOutputOptions::default()`. */
export function defaultExtractionOutputOptions(): ExtractionOutputOptions {
  return {
    continue_on_page_error: false,
    extract_content_bounds: false,
    extract_text_metadata: false,
    extract_images: false,
    extract_vector_graphics: false,
    extract_annotations: false,
    extract_form_fields: false,
    extract_structure_tree: false,
    emit_word_boxes: false,
    split_scripts: false,
    keep_clipped_text: false,
  };
}
