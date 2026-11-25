// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// visual_to_logical from liteparse crates/liteparse/src/ocr/ocria/rec.rs: the
// RTL recognizer writes lines in visual order, and the reference reorders them
// with unicode-bidi 0.3.18 (`BidiInfo::new(s, Some(Level::rtl()))`, then
// `reorder_line` per paragraph). bidi-js runs the same Unicode Bidirectional
// Algorithm (rules L1 and L2, no mirroring, as `reorder_line`).
// ponytail: bidi-js, not a port of unicode-bidi; port the crate if a golden
// shows the two disagree.

import bidiFactory from "bidi-js";

let bidi: ReturnType<typeof bidiFactory> | undefined;

/** Reorder a visual-order reading into logical order, with an RTL paragraph level. */
export function visualToLogical(s: string): string {
  bidi ??= bidiFactory();
  const levels = bidi.getEmbeddingLevels(s, "rtl");
  const units = s.split("");
  for (const [start, end] of bidi.getReorderSegments(s, levels)) {
    const part = units.slice(start, end + 1).reverse();
    units.splice(start, part.length, ...part);
  }
  // bidi-js works on UTF-16 code units: a reversed surrogate pair is put back in order
  for (let i = 0; i + 1 < units.length; i++) {
    const lo = units[i].charCodeAt(0);
    const hi = units[i + 1].charCodeAt(0);
    if (lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff) {
      units[i] = String.fromCharCode(hi);
      units[i + 1] = String.fromCharCode(lo);
      i++;
    }
  }
  return units.join("");
}
