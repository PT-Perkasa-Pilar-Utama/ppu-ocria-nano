// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): span pieces.

import { f32, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { TextItem, WordBox } from "../../../types/text-item.js";
import { collapseWhitespace } from "../../paragraphs/index.js";
import type { SpanPiece } from "../types.js";
import {
  SPAN_GUTTER_MIN_ORDINARY_EM,
  SPAN_GUTTER_MIN_PT,
  SPAN_GUTTER_MIN_RATIO,
} from "./constants.js";

/**
 * A run's own word boxes, in reading order, but only when they reconstruct the
 * run's text exactly. Anything less and the boxes can't be used to slice the
 * text, because the split points wouldn't correspond to it.
 *
 * The x-filter matters: projection can append a merged neighbour's word boxes
 * onto a run without re-slicing the text, making `span.words` a superset.
 */
export function verifiedWords(span: TextItem): WordBox[] | null {
  const x1 = f32(span.x + Math.max(span.width, 0));
  const words = span.words.filter((w) => {
    const centre = f32(w.x + f32(Math.max(w.width, 0) / 2));
    return trim(w.text) !== "" && centre >= f32(span.x - 1) && centre <= f32(x1 + 1);
  });
  if (words.length === 0) return null;
  const rebuilt = collapseWhitespace(words.map((w) => trim(w.text)).join(" "));
  return rebuilt === collapseWhitespace(trim(span.text)) ? words : null;
}

export function pieceFromWords(words: WordBox[], span: TextItem): SpanPiece {
  const first = words[0];
  const last = words[words.length - 1];
  const x = first ? first.x : span.x;
  const endX = last ? f32(last.x + Math.max(last.width, 0)) : f32(span.x + Math.max(span.width, 0));
  return {
    x,
    end_x: endX,
    text: collapseWhitespace(words.map((w) => trim(w.text)).join(" ")),
    span,
    words: [...words],
    item_index: null,
  };
}

/**
 * Split one PDFium run into column pieces at its internal gutters.
 *
 * PDFium routinely emits a whole table row (several cells) as a single run,
 * which is the root of the track chicken-and-egg: the detector needs tracks to
 * split runs, but the runs are where the track evidence lives. Word boxes
 * break the cycle, because the gutter is plainly visible in the geometry
 * before any table hypothesis exists.
 *
 * Detection is relative to the run itself, never a constant threshold: sort
 * the inter-word gaps, find the largest ratio jump, and accept the split only
 * when that jump clears `SPAN_GUTTER_MIN_RATIO`. A fixed gap threshold cannot
 * work here: the same 4pt gap is a gutter in 6pt type and an ordinary space in
 * 12pt type.
 *
 * Returns a single piece covering the whole run when it has no word boxes,
 * fewer than three words, or no bimodal gap.
 */
export function splitSpanAtGutters(span: TextItem): SpanPiece[] {
  // Unverified word boxes leave `words` empty, so `whole()` then carries no
  // word geometry, exactly as the `SpanPiece.words` contract requires.
  const words = verifiedWords(span) ?? [];
  const whole = (): SpanPiece[] => [
    {
      x: span.x,
      end_x: f32(span.x + Math.max(span.width, 0)),
      text: collapseWhitespace(trim(span.text)),
      span,
      words: [...words],
      item_index: null,
    },
  ];
  // Two words give exactly one gap, which is trivially "the largest": no
  // ratio to test against, so there is no evidence of bimodality. The piece
  // still carries its words, so a track-driven split can use them later.
  if (words.length < 3) return whole();

  const gaps: number[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    gaps.push(f32(words[i + 1].x - f32(words[i].x + Math.max(words[i].width, 0))));
  }
  const sorted = [...gaps].sort(totalCmp);
  // Largest ratio jump between adjacent sorted gaps: the boundary between
  // "ordinary space" and "gutter", if there is one.
  const font = Math.max(span.font_size ?? span.height, 1);
  const loFloor = f32(font * SPAN_GUTTER_MIN_ORDINARY_EM);
  let cut: number | null = null;
  let bestRatio: number = SPAN_GUTTER_MIN_RATIO;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (hi < SPAN_GUTTER_MIN_PT) continue;
    const ratio = f32(hi / Math.max(lo, loFloor));
    if (ratio >= bestRatio) {
      bestRatio = ratio;
      cut = hi;
    }
  }
  if (cut === null) return whole();
  const threshold = cut;

  let pieces: SpanPiece[] = [];
  let current: WordBox[] = [words[0]];
  gaps.forEach((gap, i) => {
    if (gap >= threshold) {
      pieces.push(pieceFromWords(current, span));
      current = [];
    }
    current.push(words[i + 1]);
  });
  pieces.push(pieceFromWords(current, span));
  pieces = pieces.filter((p) => p.text !== "");
  if (pieces.length < 2) return whole();
  return pieces;
}

/**
 * All column pieces on a line, left to right. This is the tabular view of a
 * row: what PDFium calls a run is not what the page calls a cell.
 */
export function linePieces(line: ProjectedLine): SpanPiece[] {
  const pieces: SpanPiece[] = [];
  line.spans.forEach((s, i) => {
    if (trim(s.text) === "") return;
    const itemIndex = line.span_item_indices[i] ?? null;
    for (const piece of splitSpanAtGutters(s)) {
      piece.item_index = itemIndex;
      pieces.push(piece);
    }
  });
  return pieces.sort((a, b) => totalCmp(a.x, b.x));
}

/**
 * `linePieces` for every line up front. The detection scan tries most lines
 * as a seed and re-reads its neighbours' pieces for each try, so computing
 * them per call would redo the same splits O(lines x window) times.
 */
export function computeLinePieces(lines: ProjectedLine[]): SpanPiece[][] {
  return lines.map(linePieces);
}
