// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/types.rs (crates-v2.21.2, Apache-2.0): TextItem.

/** One word's box within a TextItem, in the parent item's viewport space. */
export type WordBox = { text: string; x: number; y: number; width: number; height: number };

/**
 * A single text item on a page: content, position, size, rotation and font
 * metadata. Viewport space (top-left origin, 72 DPI), f32. Optional fields are
 * the Rust `Option`s; `null` stands for `None` where serde writes it.
 */
export type TextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees counter-clockwise, adjusted for page rotation. */
  rotation: number;
  font_name?: string | null;
  font_size?: number | null;
  /** Font size * scale_y from the text matrix. */
  font_height?: number | null;
  font_ascent?: number | null;
  font_descent?: number | null;
  font_weight?: number | null;
  font_flags?: number | null;
  /** Sum of glyph widths. */
  text_width?: number | null;
  font_is_buggy: boolean;
  has_unicode_map_error: boolean;
  mcid?: number | null;
  /** ARGB hex, e.g. "ff000000". */
  fill_color?: string | null;
  stroke_color?: string | null;
  char_codes: number[];
  trailing_space_generated: boolean;
  /** A space followed the last glyph of this left-to-right item. */
  followed_by_space: boolean;
  /** OCR confidence 0..1; absent for native PDF text. */
  confidence?: number | null;
  link?: string | null;
  strike: boolean;
  underline: boolean;
  sup: boolean;
  sub: boolean;
  /** The pieces an item was merged from when their emphasis differs. Internal. */
  style_pieces: TextItem[];
  /** A super/subscript run's own glyph box `(y, height)`. Internal. */
  script_geom?: [number, number] | null;
  /** LaTeX rebuilt from TeX math fonts. */
  math: boolean;
  words: WordBox[];
  /** Read by ocria-nano's faint-token pass. Internal. */
  ocr_faint: boolean;
};

/** `TextItem::default()` with the given fields. */
export function textItem(fields: Partial<TextItem>): TextItem {
  return {
    text: "",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    font_is_buggy: false,
    has_unicode_map_error: false,
    char_codes: [],
    trailing_space_generated: false,
    followed_by_space: false,
    strike: false,
    underline: false,
    sup: false,
    sub: false,
    style_pieces: [],
    math: false,
    words: [],
    ocr_faint: false,
    ...fields,
  };
}
