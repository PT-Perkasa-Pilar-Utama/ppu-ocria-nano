// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): description-list 2-column table detector.

// Catches borderless 2-column tables that the main `try_detect_table` rejects
// because `TABLE_MIN_COLUMNS = 3`. Signature:
//
//   - >= DESC_LIST_MIN_ROWS rows where col 0 is a short label and col 1 is
//     anything (typically a paragraph or bullet list).
//   - Stable x-anchors for both columns (within DESC_LIST_TRACK_TOL_PT).
//   - Clear inter-column gap (col1.start_x - col0.end_x >= DESC_LIST_MIN_COL_GAP_PT).
//   - Asymmetric content: at least one row's col 1 is meaningfully longer than
//     its col 0, which rules out symmetric two-column body prose.
//
// Handles two PDFium quirks:
//   - Wrap continuations: a single-cell line at col 1's anchor extends the
//     previous row's col 1.
//   - Merged-span rows: PDFium occasionally emits both columns of a row as a
//     single text item starting at col 0's anchor. We split on the whitespace
//     position closest to col 1's anchor and treat the result as a normal
//     2-cell row.

import { rectExtend } from "../../../types/geometry.js";
import { charCount, f32, totalCmp } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import {
  cellRect,
  linesBbox,
  locatedCell,
  partitionItems,
  splitCells,
  tableRowsAdjacent,
} from "../borderless/index.js";
import type { TableRun } from "../types.js";
import {
  DESC_LIST_MIN_COL_GAP_PT,
  DESC_LIST_MIN_ROWS,
  DESC_LIST_TRACK_TOL_PT,
} from "./constants.js";
import { splitDescriptionCellAtAnchor } from "./description-split.js";
import { hasAlphabetic, isLabelLike, isPageRef, looksLikeCaption } from "./description-text.js";

type DescRow = [number, Cell, Cell];

/** True when the spacing guard says `cur` sits markedly farther below than the run's row cadence. */
function breaksRowCadence(
  rows: DescRow[],
  lines: ProjectedLine[],
  prevLine: ProjectedLine,
  curLine: ProjectedLine
): boolean {
  if (rows.length < 2) return false;
  const curGap = f32(curLine.bbox.y - prevLine.bbox.y);
  let maxPrior = -Infinity;
  for (let k = 0; k + 1 < rows.length; k++) {
    const gap = f32(lines[rows[k + 1][0]].bbox.y - lines[rows[k][0]].bbox.y);
    if (totalCmp(gap, maxPrior) >= 0) maxPrior = gap;
  }
  return (
    curGap > f32(maxPrior * f32(1.6)) &&
    curGap > Math.max(curLine.bbox.height, prevLine.bbox.height)
  );
}

export function tryDetectDescriptionList(
  lines: ProjectedLine[],
  startIdx: number
): TableRun | null {
  const first = splitCells(lines[startIdx]);
  if (first.length !== 2) return null;
  const col0X = first[0].start_x;
  const col0End = first[0].end_x;
  const col1X = first[1].start_x;
  if (f32(col1X - col0End) < DESC_LIST_MIN_COL_GAP_PT) return null;
  if (!isLabelLike(first[0].text)) return null;

  const rows: DescRow[] = [
    [startIdx, locatedCell(first[0], lines[startIdx]), locatedCell(first[1], lines[startIdx])],
  ];
  // Track how many rows came from the *actual* 2-cell path (PDFium emitted two
  // distinct spans with a clear gap). The merged-span split path is a recovery
  // hack for tight-kerning cases: when it's the only thing extending the run,
  // we're almost certainly slicing prose, not a table.
  let realTwoCellRows = 1;

  let j = startIdx + 1;
  while (j < lines.length) {
    const prevLine = lines[rows[rows.length - 1][0]];
    if (!tableRowsAdjacent(prevLine, lines[j])) break;
    // Caption / divider guard: a line whose text begins with a figure or table
    // caption marker is the caption sitting below the list, never a row of it.
    if (looksLikeCaption(lines[j].text)) break;
    // Spacing guard: `table_rows_adjacent` is generous up to 2.5x line height.
    if (breaksRowCadence(rows, lines, prevLine, lines[j])) break;
    const cells = splitCells(lines[j]);
    if (cells.length === 2) {
      const c0Aligned = Math.abs(f32(cells[0].start_x - col0X)) <= DESC_LIST_TRACK_TOL_PT;
      const c1Aligned = Math.abs(f32(cells[1].start_x - col1X)) <= DESC_LIST_TRACK_TOL_PT;
      if (c0Aligned && c1Aligned && isLabelLike(cells[0].text)) {
        rows.push([j, locatedCell(cells[0], lines[j]), locatedCell(cells[1], lines[j])]);
        realTwoCellRows += 1;
        j += 1;
        continue;
      }
      break;
    }
    if (cells.length !== 1) break;
    const cell = cells[0];
    const c0Aligned = Math.abs(f32(cell.start_x - col0X)) <= DESC_LIST_TRACK_TOL_PT;
    const c1Aligned = Math.abs(f32(cell.start_x - col1X)) <= DESC_LIST_TRACK_TOL_PT;
    if (c1Aligned) {
      const tail = rows[rows.length - 1][2];
      if (tail.text !== "") tail.text += " ";
      tail.text += cell.text;
      // The wrapped continuation is part of the same logical cell, so it grows
      // that cell's box rather than starting a new one.
      tail.bbox = rectExtend(tail.bbox ?? undefined, cellRect(cell, lines[j]));
      tail.text_item_indices.push(...cell.text_item_indices);
      j += 1;
      continue;
    }
    // Merged-span row: single cell starts at col 0 but extends past col 1's
    // anchor. Split on the whitespace closest to col 1.
    const straddles = c0Aligned && cell.end_x > f32(col1X + DESC_LIST_TRACK_TOL_PT);
    const split = straddles ? splitDescriptionCellAtAnchor(lines[j], cell, col1X) : null;
    if (split != null && isLabelLike(split[0])) {
      // The split position is a linear estimate inside one merged span, not an
      // observed boundary: the halves carry text only rather than a fabricated
      // rect, and the items on their side of col 1 (both, for a run that
      // straddles it).
      const parts = partitionItems(cell, [col1X]).map((p) => p[0]);
      let next = 0;
      const half = (text: string): Cell => ({
        text,
        bbox: null,
        text_item_indices: parts[next++] ?? [],
      });
      const left = half(split[0]);
      const right = half(split[1]);
      rows.push([j, left, right]);
      j += 1;
      continue;
    }
    break;
  }

  if (rows.length < DESC_LIST_MIN_ROWS) return null;

  // Anti-false-positive #1: require >= 2 rows that came from the actual 2-cell
  // path. A run extended entirely by the merged-span split is almost certainly
  // slicing body prose where a heading happens to have a section number
  // cleanly tab-stopped left of the title.
  if (realTwoCellRows < 2) return null;
  // Anti-false-positive #1b: at least one row must have BOTH columns containing
  // alphabetic characters. Filters TOC entries (col 1 = page number) and
  // footnote lists (col 0 = footnote number).
  const hasAlphaPair = rows.some(([, c0, c1]) => hasAlphabetic(c0.text) && hasAlphabetic(c1.text));
  if (!hasAlphaPair) return null;
  // Anti-false-positive #1c: if every col 1 reads as a page number (digits or
  // roman numerals), the run is a TOC.
  if (rows.every(([, , c1]) => isPageRef(c1.text))) return null;
  // Anti-false-positive #2: at least one of
  //   (a) >= 3 rows (cadence is the signal),
  //   (b) one row's col 1 is substantially longer than col 0 (paragraph cell
  //       next to a label cell, the classic description-list shape).
  const asymmetric = rows.some(
    ([, c0, c1]) => charCount(c1.text) >= Math.max(charCount(c0.text) * 2, 20)
  );
  if (rows.length < 3 && !asymmetric) return null;

  const body: Cell[][] = rows.map(([, c0, c1]) => [structuredClone(c0), structuredClone(c1)]);
  return {
    start: startIdx,
    end: j,
    body_start: startIdx,
    bbox: linesBbox(lines, startIdx, j),
    block: { Table: { header: null, rows: body } },
    interstitials: [],
    item_indices: [],
  };
}
