// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): splitting a merged description row.

import { remEuclidF32 } from "../../../rust-extra.js";
import { asUsize, chars, clamp, f32, isWhitespace, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { TextItem, WordBox } from "../../../types/text-item.js";
import { splitWordsAtXAnchors, verifiedWords } from "../borderless/index.js";
import type { TableCell } from "../types.js";
import { DESC_LIST_TRACK_TOL_PT } from "./constants.js";

/**
 * Split a merged description row at an established column anchor. Complete,
 * verified word boxes are authoritative: if no word starts near the anchor,
 * do not guess a boundary in otherwise continuous text. When word geometry
 * is missing or unusable, preserve the existing character-based fallback.
 * `cell` must be the sole result of `split_cells(line)`, so verifying each
 * nonempty span also verifies the full cell text.
 */
export function splitDescriptionCellAtAnchor(
  line: ProjectedLine,
  cell: TableCell,
  anchorX: number
): [string, string] | null {
  // Word order and increasing x do not describe the same boundaries in RTL
  // lines; preserve the existing path until that layout is handled explicitly.
  if (line.rtl) return splitMergedAtAnchor(cell.text, cell.start_x, cell.end_x, anchorX);
  const spans: TextItem[] = line.spans.filter((span) => trim(span.text) !== "");
  spans.sort((a, b) => totalCmp(a.x, b.x));
  const words: WordBox[] = [];
  for (const span of spans) {
    // Projection can rotate/reposition spans without transforming their word
    // boxes. Do not compare those boxes with projected track anchors.
    const rotation = remEuclidF32(span.rotation, 360.0);
    if (!(rotation <= 5.0 || rotation >= 355.0)) {
      return splitMergedAtAnchor(cell.text, cell.start_x, cell.end_x, anchorX);
    }
    const verified = verifiedWords(span);
    if (verified == null) return splitMergedAtAnchor(cell.text, cell.start_x, cell.end_x, anchorX);
    words.push(...verified);
  }
  if (words.length === 0 || words.some((w, i) => i + 1 < words.length && w.x > words[i + 1].x)) {
    return splitMergedAtAnchor(cell.text, cell.start_x, cell.end_x, anchorX);
  }
  // A miss with verified geometry is evidence against a column boundary.
  // Propagate it rather than guessing a split that could turn prose into a row.
  const pieces = splitWordsAtXAnchors(words, [anchorX], DESC_LIST_TRACK_TOL_PT);
  if (pieces == null) return null;
  return [pieces[0], pieces[1]];
}

/** Legacy character-position estimate for callers without usable word boxes. */
export function splitMergedAtAnchor(
  text: string,
  startX: number,
  endX: number,
  anchorX: number
): [string, string] | null {
  const width = Math.max(f32(endX - startX), 1.0);
  const ratio = clamp(f32(f32(anchorX - startX) / width), 0.0, 1.0);
  const cs = chars(text);
  if (cs.length === 0) return null;
  const target = asUsize(f32(f32(cs.length) * ratio));
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < cs.length; i++) {
    if (isWhitespace(cs[i])) {
      const d = Math.abs(i - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  if (best == null) return null;
  const left = trim(cs.slice(0, best).join(""));
  const right = trim(cs.slice(best + 1).join(""));
  if (left === "" || right === "") return null;
  return [left, right];
}
