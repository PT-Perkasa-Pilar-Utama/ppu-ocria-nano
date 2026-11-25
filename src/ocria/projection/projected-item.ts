// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): value semantics the Rust gets from `Clone`.

import { f32 } from "../rust.js";
import type { TextItem } from "../types/text-item.js";
import type { ProjectedTextItem } from "./types.js";

/**
 * `TextItem::clone`: a deep copy. Projection mutates the `item` of every
 * `ProjectedTextItem`, while `detect_figure_rects` later reads the page's own
 * `text_items`, so the two must not share objects, arrays or nested pieces.
 */
export function cloneTextItem(it: TextItem): TextItem {
  return {
    ...it,
    char_codes: [...it.char_codes],
    style_pieces: it.style_pieces.map(cloneTextItem),
    script_geom: it.script_geom ? [it.script_geom[0], it.script_geom[1]] : it.script_geom,
    words: it.words.map((w) => ({ ...w })),
  };
}

/** The fresh projection state `project_pages` gives each text item. */
export function newProjectedItem(item: TextItem): ProjectedTextItem {
  return {
    orig_x: item.x,
    orig_y: item.y,
    orig_width: item.width,
    orig_height: item.height,
    orig_rotation: item.rotation,
    item: cloneTextItem(item),
    snap: "Left",
    anchor: "Left",
    is_dup: false,
    rendered: false,
    num_spaces: 0,
    force_unsnapped: false,
    is_margin_line_number: false,
    rotated: false,
    d: 0,
  };
}

/** `iter.sum::<f32>()`: a left fold that rounds to f32 after each add, starting from 0. */
export function sumF32(values: Iterable<number>): number {
  let acc = 0;
  for (const v of values) acc = f32(acc + v);
  return acc;
}
