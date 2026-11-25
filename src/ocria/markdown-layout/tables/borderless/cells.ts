// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): cells of a row.

import { charCount, f32, totalCmp, trim } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { Rect } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { TextItem } from "../../../types/text-item.js";
import { isBoldItem } from "../../../projection/style.js";
import type { Cell } from "../../block-types.js";
import { cellSourced } from "../../blocks/positioned.js";
import { collapseWhitespace } from "../../paragraphs/index.js";
import type { TableCell } from "../types.js";
import { TABLE_CELL_GAP_FONT_MULTIPLIER, TABLE_TRACK_TOLERANCE_PT } from "./constants.js";
import { splitTextAtXAnchors } from "./anchors.js";

/** Item indices and their x-ranges for one part of a split `TableCell`. */
export type ItemPart = [number[], Array<[number, number]>];

/**
 * `TableCell::partition_items`: the cell's items for each part of a split at
 * the x positions `cuts` (ascending; part `p` lies between `cuts[p - 1]` and
 * `cuts[p]`). An item goes to the part holding its centre, so none is lost,
 * and to every other part holding at least a quarter of its width, so a merged
 * run that straddles a cut feeds both sides. A part left with no item, and
 * every part when the ranges are unknown, keeps all of the cell's items.
 */
export function partitionItems(cell: TableCell, cuts: number[]): ItemPart[] {
  const n = cuts.length + 1;
  const all = (): ItemPart => [
    [...cell.text_item_indices],
    cell.item_x_ranges.map(([a, b]): [number, number] => [a, b]),
  ];
  if (cell.item_x_ranges.length !== cell.text_item_indices.length) {
    return Array.from({ length: n }, all);
  }
  const parts: ItemPart[] = Array.from({ length: n }, (): ItemPart => [[], []]);
  cell.text_item_indices.forEach((i, k) => {
    const [a, b] = cell.item_x_ranges[k];
    const width = Math.max(f32(b - a), 0);
    const centre = f32(f32(a + b) / 2);
    parts.forEach((part, p) => {
      const x0 = p === 0 ? -Infinity : cuts[p - 1];
      const x1 = p + 1 === n ? Infinity : cuts[p];
      const holdsCentre = centre >= x0 && (centre < x1 || p + 1 === n);
      const overlap = Math.max(f32(Math.min(b, x1) - Math.max(a, x0)), 0);
      if (holdsCentre || (width > 0 && overlap >= f32(0.25 * width))) {
        part[0].push(i);
        part[1].push([a, b]);
      }
    });
  });
  return parts.map((part) => (part[0].length === 0 ? all() : part));
}

/**
 * Union of the boxes of `lines[start..end]`: the region a table run covers
 * when it has no drawn grid to fall back on.
 */
export function linesBbox(lines: ProjectedLine[], start: number, end: number): Rect | null {
  const e = Math.min(end, lines.length);
  if (start > e) return null;
  let out: Rect | undefined;
  for (const l of lines.slice(start, e)) out = rectExtend(out, l.bbox);
  return out ?? null;
}

/**
 * Region occupied by one borderless-table cell: its own x-extent (tracked by
 * `split_cells` from the spans it absorbed) crossed with the vertical band of
 * the line it sits on. A borderless table has no ruled boundaries, so a cell
 * covers exactly the ink of its spans, not a full column track.
 */
export function cellRect(cell: TableCell, line: ProjectedLine): Rect {
  return {
    x: cell.start_x,
    y: line.bbox.y,
    width: Math.max(f32(cell.end_x - cell.start_x), 0),
    height: line.bbox.height,
  };
}

/** Build a located `Cell` from a `TableCell` and its owning line. */
export function locatedCell(cell: TableCell, line: ProjectedLine): Cell {
  return cellSourced(cell.text, cellRect(cell, line), [...cell.text_item_indices]);
}

/**
 * A line's source items in the order its `text` reads them. `spans` (and so
 * `span_item_indices`) run x-ascending, which a right-to-left line reads
 * backwards.
 */
export function lineItemsInReadingOrder(line: ProjectedLine): number[] {
  const items = [...line.span_item_indices];
  if (line.rtl) items.reverse();
  return items;
}

/** A whole line as one located cell. */
export function lineCell(line: ProjectedLine): Cell {
  return cellSourced(trim(line.text), line.bbox, lineItemsInReadingOrder(line));
}

/**
 * Split a `ProjectedLine`'s spans into cells. A gap larger than
 * `TABLE_CELL_GAP_FONT_MULTIPLIER x font_size` between adjacent spans starts
 * a new cell; otherwise spans join into the same cell with a single space.
 */
export function splitCells(line: ProjectedLine): TableCell[] {
  // Skip whitespace-only spans before computing gaps: leading/trailing empty
  // items would otherwise add spurious cell boundaries.
  const spans: Array<[TextItem, number | null]> = [];
  line.spans.forEach((s, i) => {
    if (trim(s.text) !== "") spans.push([s, line.span_item_indices[i] ?? null]);
  });
  spans.sort((a, b) => totalCmp(a[0].x, b[0].x));
  if (spans.length === 0) return [];
  const fontSize =
    line.dominant_font_size > 0 ? line.dominant_font_size : Math.max(line.bbox.height, 1);
  const gapThreshold = f32(fontSize * TABLE_CELL_GAP_FONT_MULTIPLIER);

  const cells: TableCell[] = [];
  let currentText = "";
  let currentStart = spans[0][0].x;
  let currentBoldChars = 0;
  let currentTotalChars = 0;
  let currentItems: number[] = [];
  let currentRanges: Array<[number, number]> = [];
  let prevRight = spans[0][0].x;

  spans.forEach(([span, itemIndex], i) => {
    const gap = f32(span.x - prevRight);
    if (i > 0 && gap > gapThreshold) {
      const bold = currentTotalChars > 0 && currentBoldChars * 2 > currentTotalChars;
      cells.push({
        start_x: currentStart,
        end_x: prevRight,
        text: collapseWhitespace(trim(currentText)),
        bold,
        text_item_indices: currentItems,
        item_x_ranges: currentRanges,
      });
      currentItems = [];
      currentRanges = [];
      currentText = "";
      currentStart = span.x;
      currentBoldChars = 0;
      currentTotalChars = 0;
    }
    if (currentText !== "" && !currentText.endsWith(" ")) currentText += " ";
    currentText += span.text;
    if (itemIndex !== null) {
      currentItems.push(itemIndex);
      currentRanges.push([span.x, f32(span.x + Math.max(span.width, 0))]);
    }
    const n = charCount(span.text);
    currentTotalChars += n;
    if (isBoldItem(span)) currentBoldChars += n;
    prevRight = f32(span.x + Math.max(span.width, 0));
  });
  if (trim(currentText) !== "") {
    const bold = currentTotalChars > 0 && currentBoldChars * 2 > currentTotalChars;
    cells.push({
      start_x: currentStart,
      end_x: prevRight,
      text: collapseWhitespace(trim(currentText)),
      bold,
      text_item_indices: currentItems,
      item_x_ranges: currentRanges,
    });
  }
  return cells;
}

/**
 * When a candidate row has fewer cells than the established column count,
 * look for cells whose x-range straddles multiple column tracks (likely two
 * or more adjacent words that PDFium merged into a single text run) and split
 * each on internal whitespace at the boundaries nearest to the straddled
 * tracks.
 *
 * Returns the patched cells if every short cell could be cleanly split to
 * recover `tracks.length` cells total; otherwise null.
 */
export function recoverMergedCell(cells: TableCell[], tracks: number[]): TableCell[] | null {
  const target = tracks.length;
  if (cells.length >= target) return null;
  // Repeatedly find the cell that straddles the most tracks (2 or more) and
  // split it. Each iteration strictly grows `cells.length`, so termination is
  // guaranteed; if no cell straddles 2 or more tracks before we hit the
  // target, recovery fails.
  while (cells.length < target) {
    let bestI: number | null = null;
    let bestCount = 1;
    let bestContained: number[] = [];
    cells.forEach((cell, i) => {
      const contained = tracks.filter(
        (t) =>
          t >= f32(cell.start_x - TABLE_TRACK_TOLERANCE_PT) &&
          t <= f32(cell.end_x + TABLE_TRACK_TOLERANCE_PT)
      );
      if (contained.length > bestCount) {
        bestCount = contained.length;
        bestI = i;
        bestContained = contained;
      }
    });
    if (bestI === null) return null;
    const i: number = bestI;
    const cell = cells[i];
    // Split the merged cell text at each contained track after the first.
    const pieces = splitTextAtXAnchors(
      trim(cell.text),
      cell.start_x,
      f32(cell.end_x - cell.start_x),
      bestContained.slice(1)
    );
    if (pieces === null) return null;
    if (pieces.some((p) => p === "")) return null;
    // Synthesize new TableCells aligned with each track. Items are split at
    // the tracks themselves, not at the inset cell edges.
    const parts = partitionItems(cell, bestContained.slice(1));
    const newCells: TableCell[] = pieces.map((piece, p) => {
      const startX = p === 0 ? cell.start_x : bestContained[p];
      const endX =
        p + 1 < bestContained.length ? Math.max(f32(bestContained[p + 1] - 1), startX) : cell.end_x;
      const [textItemIndices, itemXRanges] = parts[p];
      return {
        start_x: startX,
        end_x: endX,
        text: piece,
        bold: cell.bold,
        text_item_indices: textItemIndices,
        item_x_ranges: itemXRanges,
      };
    });
    cells.splice(i, 1, ...newCells);
  }
  return cells.length === target ? cells : null;
}
