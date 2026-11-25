// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): SegmentBuilder::flush (item construction).

import { f32 } from "../../ocria/rust.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { textItem } from "../../ocria/types/text-item.js";
import type { SegmentBuilder } from "./segment-builder.js";

/** The `TextItem` a segment flushes as. Records the host band of a script run in `s.lastScript`. */
export function segmentItem(s: SegmentBuilder, trimmed: string): TextItem {
  const width = f32(s.vpRight - s.vpLeft);
  const [bandTop, bandBottom] = s.hostBand ?? [s.vpTop, s.vpBottom];
  if (s.hostBand !== null) s.lastScript = [s.hostBand[0], s.hostBand[1], s.vpRight];
  const scriptGeom: [number, number] | null =
    s.hostBand === null ? null : [s.vpTop, f32(s.vpBottom - s.vpTop)];
  const height = f32(bandBottom - bandTop);
  return textItem({
    text: trimmed,
    x: s.vpLeft,
    y: bandTop,
    width,
    height,
    rotation: s.rotationDeg,
    font_name: s.fontName,
    font_size: s.fontSize > 0 ? s.fontSize : height,
    font_height: s.fontHeight,
    font_ascent: s.fontAscent,
    font_descent: s.fontDescent,
    font_weight: s.fontWeight,
    font_flags: s.fontFlags,
    text_width: s.textWidth > 0 ? s.textWidth : null,
    font_is_buggy: s.fontIsBuggy,
    // Majority vote: a stray mapped char (a space) inside an otherwise unmappable Type3 run must not rescue the item.
    has_unicode_map_error: s.unmappedCharCount * 2 >= Math.max(s.charCount, 1),
    mcid: s.mcid,
    fill_color: s.fillColor,
    stroke_color: s.strokeColor,
    char_codes: s.charCodes,
    trailing_space_generated: s.pendingSpaceGenerated,
    followed_by_space: s.pendingSpace && s.dirRtl !== true,
    script_geom: scriptGeom,
    words: s.words,
  });
}
