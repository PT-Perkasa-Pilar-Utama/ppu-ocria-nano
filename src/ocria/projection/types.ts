// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of ProjectedTextItem in liteparse crates/liteparse/src/types.rs (crates-v2.21.2, Apache-2.0).

import type { Anchor, Snap } from "../types/geometry.js";
import type { TextItem } from "../types/text-item.js";

/** A text item with the grid projection's working state. `item` is mutated by projection; `orig_*` keep the input box. */
export type ProjectedTextItem = {
  item: TextItem;
  snap: Snap;
  anchor: Anchor;
  is_dup: boolean;
  rendered: boolean;
  num_spaces: number;
  force_unsnapped: boolean;
  is_margin_line_number: boolean;
  rotated: boolean;
  d: number;
  orig_x: number;
  orig_y: number;
  orig_width: number;
  orig_height: number;
  orig_rotation: number;
};

/** `AnchorMap`: anchor key (x * 4, rounded) to `(line index, item index)` pairs. */
export type AnchorMap = Map<number, Array<[number, number]>>;
