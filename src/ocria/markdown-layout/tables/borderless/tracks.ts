// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): column tracks.

import {
  isAlphabetic,
  charCount,
  f32,
  isWhitespace,
  totalCmp,
  trim,
  chars,
} from "../../../rust.js";
import { isAsciiDigit } from "../../../rust-extra.js";
import type { ProjectedLine } from "../../../types/page.js";
import { isBoldItem } from "../../../projection/style.js";
import { collapseWhitespace } from "../../paragraphs/index.js";
import type { SpanPiece, TableCell } from "../types.js";
import type { CandidateRow } from "./row-types.js";
import { splitTextAtXAnchors, splitWordsAtXAnchors } from "./anchors.js";
import {
  TABLE_ROW_GAP_MULTIPLIER,
  TABLE_TRACK_INFERENCE_MAX_ROWS,
  TABLE_TRACK_TOLERANCE_PT,
} from "./constants.js";
import { isValueLike } from "./run-text.js";
import { linePieces } from "./span-pieces.js";

/**
 * Vertical-gap check for table rows. Looser than paragraph continuation
 * because table rows often have extra padding between them.
 */
export function tableRowsAdjacent(prev: ProjectedLine, cur: ProjectedLine): boolean {
  // Intentionally don't require region_path equality. Indented sub-group
  // rows (e.g. an indented "MEMORYBANK" row in a grouped academic results
  // table) sometimes land in a different XY-cut leaf than the rest of the
  // table - but the column-track alignment and y-gap checks below are
  // strong enough signals on their own to keep us from spuriously
  // bridging unrelated regions.
  const prevBottom = f32(prev.bbox.y + prev.bbox.height);
  const gap = f32(cur.bbox.y - prevBottom);
  const lineHeight = Math.max(Math.max(prev.bbox.height, cur.bbox.height), 1);
  return gap >= -lineHeight && gap <= f32(lineHeight * TABLE_ROW_GAP_MULTIPLIER);
}

/**
 * Coefficient of variation (std-dev / mean) of inter-row vertical gaps.
 * Returns 0 for runs with fewer than 2 gaps (nothing to compare). Used to
 * reject runs whose row spacing is too irregular to be a real table.
 */
export function rowSpacingCv(rows: readonly CandidateRow[]): number {
  if (rows.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    gaps.push(Math.abs(f32(rows[i + 1][1].bbox.y - rows[i][1].bbox.y)));
  }
  let sum = 0;
  for (const g of gaps) sum = f32(sum + g);
  const mean = f32(sum / gaps.length);
  if (mean <= 0) return Infinity;
  let sq = 0;
  for (const g of gaps) {
    const d = f32(g - mean);
    sq = f32(sq + f32(d * d));
  }
  const variance = f32(sq / gaps.length);
  return f32(f32(Math.sqrt(variance)) / mean);
}

/**
 * Test whether a candidate cell aligns with the column at index `k` in
 * `track_ranges`. Track ranges are the `(start_x, end_x)` of the header
 * (first-row) cell that defined the column. A body cell aligns to column `k`
 * if any of these hold:
 *
 * - its centroid sits inside the header cell's x-range (handles centered or
 *   wider body cells like `Offset Binary` under a narrower `OUTPUT FORMAT`);
 * - its start_x matches the header start_x within tolerance (left alignment);
 * - its end_x matches the header end_x within tolerance (right alignment).
 *
 * Accepting any of these (rather than start_x alone) recovers tables whose
 * body cells are center- or right-aligned within the column.
 */
export function cellAlignsTrack(cell: TableCell, trackRange: readonly [number, number]): boolean {
  const [ts, te] = trackRange;
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const center = f32(f32(cell.start_x + cell.end_x) * 0.5);
  if (center >= f32(ts - tol) && center <= f32(te + tol)) return true;
  if (Math.abs(f32(cell.start_x - ts)) <= tol) return true;
  if (Math.abs(f32(cell.end_x - te)) <= tol) return true;
  return false;
}

/**
 * All column tracks overlapped by `cell` (with tolerance). Contiguous, since
 * tracks are sorted and disjoint.
 */
export function spanningTrackIndices(
  cell: TableCell,
  trackRanges: ReadonlyArray<readonly [number, number]>
): number[] {
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const out: number[] = [];
  trackRanges.forEach(([s, e], i) => {
    if (cell.start_x <= f32(e + tol) && cell.end_x >= f32(s - tol)) out.push(i);
  });
  return out;
}

/**
 * Whether a header cell overlapping several tracks should name all of them,
 * like a year centered over `Mill. u$s | Part.` (#487). Overlap alone isn't
 * enough - an ordinary header bleeding past its column must not be copied
 * into the neighbor - so this requires a two-layer header, short
 * single-token text, and a center near the middle of the spanned band.
 */
export function spanningHeaderEligible(
  cell: TableCell,
  covered: readonly number[],
  trackRanges: ReadonlyArray<readonly [number, number]>,
  headerLines: number
): boolean {
  if (covered.length < 2 || headerLines < 2) return false;
  const text = trim(cell.text);
  if (text === "" || charCount(text) > 10 || chars(text).some(isWhitespace)) return false;
  const bandStart = trackRanges[covered[0]][0];
  const bandEnd = trackRanges[covered[covered.length - 1]][1];
  const center = f32(f32(cell.start_x + cell.end_x) * 0.5);
  return (
    Math.abs(f32(center - f32(f32(bandStart + bandEnd) * 0.5))) <=
    Math.max(TABLE_TRACK_TOLERANCE_PT, 8)
  );
}

/**
 * Whether `text` reads as part of a row label wrapped onto its own line
 * (short, word-like, not a sentence or a value).
 */
export function isLabelFragment(text: string): boolean {
  return (
    text !== "" &&
    charCount(text) <= 60 &&
    !/[.:;,]$/.test(text) &&
    isAlphaDominant(text) &&
    !isValueLike(text)
  );
}

/** `min_by` over a candidate list: the first of equal minima. */
function minIndexBy<T>(items: readonly T[], key: (t: T) => number): number | null {
  let best: number | null = null;
  let bestKey = 0;
  items.forEach((t, i) => {
    const k = key(t);
    if (best === null || totalCmp(k, bestKey) < 0) {
      best = i;
      bestKey = k;
    }
  });
  return best;
}

/**
 * Pick the best matching column index for `cell`, preferring center
 * containment, then start_x match, then end_x match. Returns null when no
 * column aligns.
 */
export function matchTrackIdx(
  cell: TableCell,
  trackRanges: ReadonlyArray<readonly [number, number]>
): number | null {
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const center = f32(f32(cell.start_x + cell.end_x) * 0.5);
  const indexed = trackRanges.map(([s, e], i): [number, number, number] => [i, s, e]);
  // Prefer centroid-in-range.
  const inRange = indexed.filter(([, s, e]) => center >= f32(s - tol) && center <= f32(e + tol));
  const a = minIndexBy(inRange, ([, s, e]) => Math.abs(f32(center - f32(f32(s + e) * 0.5))));
  if (a !== null) return inRange[a][0];
  // Fall back to nearest start_x within tolerance.
  const startMatches = indexed.filter(([, s]) => Math.abs(f32(cell.start_x - s)) <= tol);
  const b = minIndexBy(startMatches, ([, s]) => Math.abs(f32(cell.start_x - s)));
  if (b !== null) return startMatches[b][0];
  // Fall back to nearest end_x within tolerance (right-aligned cells).
  const endMatches = indexed.filter(([, , e]) => Math.abs(f32(cell.end_x - e)) <= tol);
  const c = minIndexBy(endMatches, ([, , e]) => Math.abs(f32(cell.end_x - e)));
  return c === null ? null : endMatches[c][0];
}

/**
 * Walk forward from `startIdx` collecting raw text-item start-x positions
 * across all adjacent rows, then single-link cluster them at
 * `TABLE_TRACK_TOLERANCE_PT`. Returns cluster centroids sorted ascending.
 *
 * Unlike `splitCells`-derived tracks, this is immune to the
 * `TABLE_CELL_GAP_FONT_MULTIPLIER` knife-edge that collapses tightly-kerned
 * numeric columns into a single cell (e.g. `$448 $427 7%` at 14pt with 13.9pt
 * inter-item gaps). It also surfaces tracks witnessed by even a single row
 * when other rows in the same table have PDFium-level merged spans that hide
 * the full column geometry.
 */
export function inferTracksFromRawItems(
  lines: ProjectedLine[],
  pieces: SpanPiece[][],
  startIdx: number
): number[] {
  const xs: number[] = [];
  const pushRowXs = (idx: number): void => {
    // Piece x's, not span x's: a row PDFium emitted as one merged run still
    // witnesses its columns through its internal gutters. Skip 0- or 1-item
    // rows: they don't carry column info and can introduce noise from
    // single-cell prose lines.
    if (pieces[idx].length >= 2) xs.push(...pieces[idx].map((p) => p.x));
  };
  pushRowXs(startIdx);
  let j = startIdx + 1;
  let rowsUsed = 1;
  while (j < lines.length && rowsUsed < TABLE_TRACK_INFERENCE_MAX_ROWS) {
    if (!tableRowsAdjacent(lines[j - 1], lines[j])) break;
    pushRowXs(j);
    j += 1;
    rowsUsed += 1;
  }
  xs.sort(totalCmp);
  // Each cluster carries its support = how many raw item x's fell into it. A
  // genuine column recurs once per body row, so its support is about the row
  // count; a header line sitting a few points off the data anchor (a centered
  // "Number of" above a right-aligned numeric column) injects a separate
  // cluster supported by a single item.
  let clusters: Array<[number, number]> = [];
  let currentSum = 0;
  let currentCount = 0;
  let currentAnchor = -Infinity;
  for (const x of xs) {
    if (currentCount === 0 || Math.abs(f32(x - currentAnchor)) <= TABLE_TRACK_TOLERANCE_PT) {
      currentSum = f32(currentSum + x);
      currentCount += 1;
      currentAnchor = f32(currentSum / currentCount);
    } else {
      clusters.push([f32(currentSum / currentCount), currentCount]);
      currentSum = x;
      currentCount = 1;
      currentAnchor = x;
    }
  }
  if (currentCount > 0) clusters.push([f32(currentSum / currentCount), currentCount]);
  // Prune single-item phantom tracks when there is a clear multi-row body
  // (some cluster supported by 3 or more items). Without this, header cells
  // offset from their data column manufacture extra close-spaced tracks that
  // collapse `min_gap` and force the inferred path to bail, dropping back to
  // the header-seeded path that silently discards an unaligned column.
  // Conservative: only prunes when a strong body signal exists, and only the
  // weakest (single-item) clusters, so small/sparse tables are untouched.
  const maxSupport = clusters.reduce((m, c) => Math.max(m, c[1]), 0);
  if (maxSupport >= 3) clusters = clusters.filter((c) => c[1] >= 2);
  return clusters.map((c) => c[0]);
}

/**
 * Build a row's cells against a fixed set of column anchors. Each raw item is
 * assigned to the track its x-extent covers; items that span multiple tracks
 * (PDFium-level merged spans like `$1,298 $1,263 5%` at one anchor reaching
 * past two more anchors) are split on internal whitespace at boundaries
 * closest to each crossed anchor.
 *
 * Returns cells of length `tracks.length` (some cells may have empty text), or
 * null if any item can't be assigned cleanly (out-of-band item, or a
 * multi-track item with no usable whitespace boundary).
 */
export function cellsFromRawItemsWithTracks(
  line: ProjectedLine,
  tracks: number[]
): TableCell[] | null {
  return cellsFromPieces(linePieces(line), tracks, false);
}

function pushText(dst: string, src: string): string {
  const s = trim(src);
  if (s === "") return dst;
  const sep = dst !== "" && !dst.endsWith(" ") ? " " : "";
  return `${dst}${sep}${s}`;
}

/**
 * `allowSinglePiece` admits a row holding one piece. Off by default: a single
 * piece spanning multiple tracks is almost always prose (a wrapped paragraph
 * whose x-range merely overlaps the track region), and shredding it at
 * whitespace anchors corrupts the body text. It is only safe where the row is
 * known to be inside a table already - a rule band whose second column is
 * blank, where every body row legitimately has one piece.
 */
export function cellsFromPieces(
  spans: SpanPiece[],
  tracks: number[],
  allowSinglePiece: boolean
): TableCell[] | null {
  if (spans.length < 2 && !(allowSinglePiece && spans.length === 1)) return null;
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const cells: TableCell[] = tracks.map((t) => ({
    start_x: t,
    end_x: t,
    text: "",
    bold: false,
    text_item_indices: [],
    item_x_ranges: [],
  }));
  for (const span of spans) {
    const x0 = span.x;
    const x1 = span.end_x;
    const covered: number[] = [];
    tracks.forEach((t, i) => {
      if (t >= f32(x0 - tol) && t <= f32(x1 + tol)) covered.push(i);
    });
    // For spans that cover multiple tracks (multi-column-spanning items we'd
    // want to split), the span's leftmost x must anchor at the leftmost
    // covered track within tolerance. Otherwise the item is non-tabular
    // content (a wrapped paragraph / footnote whose x-range merely happens to
    // overlap the track region) that we shouldn't shred at whitespace
    // boundaries.
    if (covered.length > 1 && Math.abs(f32(x0 - tracks[covered[0]])) > tol) return null;
    if (covered.length === 0) return null;
    if (covered.length === 1) {
      const cell = cells[covered[0]];
      cell.text = pushText(cell.text, span.text);
      cell.end_x = Math.max(cell.end_x, x1);
      if (span.item_index !== null) cell.text_item_indices.push(span.item_index);
      if (isBoldItem(span.span)) cell.bold = true;
      continue;
    }
    const anchors = covered.slice(1).map((i) => tracks[i]);
    // Real word x's first; the character-index estimate only when this piece
    // has no verified word geometry to cut on.
    const pieces =
      splitWordsAtXAnchors(span.words, anchors, tol) ??
      splitTextAtXAnchors(span.text, span.x, f32(span.end_x - span.x), anchors);
    if (pieces === null) return null;
    const bold = isBoldItem(span.span);
    for (let k = 0; k < Math.min(covered.length, pieces.length); k++) {
      if (pieces[k] === "") return null;
      const cell = cells[covered[k]];
      cell.text = pushText(cell.text, pieces[k]);
      if (span.item_index !== null) cell.text_item_indices.push(span.item_index);
      if (bold) cell.bold = true;
    }
  }
  for (const cell of cells) cell.text = collapseWhitespace(trim(cell.text));
  return cells;
}

/**
 * Letters strictly outnumber digits - discriminates word-like labels (group
 * headers) from merged numeric runs ("$448 $427 7%").
 */
export function isAlphaDominant(text: string): boolean {
  let letters = 0;
  let digits = 0;
  for (const c of text) {
    if (isAlphabetic(c)) letters++;
    if (isAsciiDigit(c)) digits++;
  }
  return letters > digits;
}
