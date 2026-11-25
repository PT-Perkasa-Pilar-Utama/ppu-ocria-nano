// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): rotated text.

import { rectUnion } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { TextItem } from "../../types/text-item.js";
import { chars, isWhitespace } from "../../rust.js";

/**
 * Returns true if any span on the line is rotated more than ~5° off
 * horizontal — used to exclude sidebar / margin-stamp text (arXiv banners,
 * watermarks, vertical legends) from the body-size and heading-size
 * histograms so it doesn't compete with normal-flow text for heading slots.
 */
export function isRotatedLine(line: ProjectedLine): boolean {
  return line.spans.some((s) => isSideways(s.rotation));
}

/**
 * Whether text at `rotation` degrees reads more than ~5° off the horizontal
 * axes. 0° and 180° are both horizontal text.
 */
export function isSideways(rotation: number): boolean {
  const r = Math.abs(rotation) % 360;
  return !(r < 5 || (r >= 175 && r <= 185) || (r >= 355 && r <= 360));
}

function nonSpaceChars(s: TextItem): number {
  return chars(s.text).filter((c) => !isWhitespace(c)).length;
}

/**
 * `line` without its sideways spans, when they carry less than half of its
 * non-whitespace characters: OCR read one glyph or speck of a horizontal row
 * at 90°, and projection put it on the row. `null` when the line has no
 * sideways span, or is mostly sideways text and so stays margin furniture.
 * Text, box and indent are rebuilt from the upright spans the way projection
 * builds them; the line's other aggregates are kept.
 */
export function withoutStraySideways(line: ProjectedLine): ProjectedLine | null {
  const sideways = line.spans.filter((s) => isSideways(s.rotation));
  const upright = line.spans.filter((s) => !isSideways(s.rotation));
  const sidewaysChars = sideways.reduce((n, s) => n + nonSpaceChars(s), 0);
  if (sidewaysChars === 0 || sidewaysChars >= upright.reduce((n, s) => n + nonSpaceChars(s), 0)) {
    return null;
  }
  const pieces = upright.map((s) => s.text);
  if (line.rtl) pieces.reverse();
  let text = "";
  for (const piece of pieces) {
    if (text !== "" && !text.endsWith(" ")) text += " ";
    text += piece;
  }
  // The stray glyph's item leaves with it; unaligned indices are dropped rather than guessed.
  const spanItemIndices =
    line.span_item_indices.length === line.spans.length
      ? line.span_item_indices.filter((_, i) => !isSideways(line.spans[i].rotation))
      : [];
  let bbox: Rect | null = null;
  for (const s of upright) {
    const r: Rect = { x: s.x, y: s.y, width: s.width, height: s.height };
    bbox = bbox === null ? r : rectUnion(bbox, r);
  }
  if (bbox === null) return null;
  return {
    ...line,
    text,
    indent_x: bbox.x,
    bbox,
    spans: upright,
    span_item_indices: spanItemIndices,
  };
}

/**
 * Whether the page's rotated lines are its content rather than margin furniture: they carry at
 * least 30% of its non-whitespace characters. Banners, stamps and vertical legends are a sliver
 * of a page; a table or figure set sideways is most of it.
 */
export function rotatedTextIsContent(page: ParsedPage): boolean {
  let rotated = 0;
  let all = 0;
  for (const line of page.projected_lines) {
    const n = chars(line.text).filter((c) => !isWhitespace(c)).length;
    all += n;
    if (isRotatedLine(line)) rotated += n;
  }
  return all > 0 && rotated * 10 >= all * 3;
}
