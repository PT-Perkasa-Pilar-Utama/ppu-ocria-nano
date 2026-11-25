// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): absorb_header_lines.

import { charCount } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import { cell as newCell } from "../../block-types.js";
import type { TableCell } from "../types.js";
import { cellRect, lineCell, recoverMergedCell, splitCells } from "./cells.js";
import {
  cellAlignsTrack,
  matchTrackIdx,
  spanningHeaderEligible,
  spanningTrackIndices,
  tableRowsAdjacent,
} from "./tracks.js";

const HEADER_MAX_CELL_CHARS = 30;

/**
 * Walk backward from `startIdx` (not below `floor`), pulling in lines whose
 * cells all align to the table's `tracks` as header rows. Returns the new
 * start index and a single merged header row (`columnCount` columns) with
 * each absorbed line's text appended into its nearest column track.
 */
export function absorbHeaderLines(
  lines: ProjectedLine[],
  startIdx: number,
  trackRanges: Array<[number, number]>,
  columnCount: number,
  floor: number
): [number, Cell[], Cell[]] | null {
  // Line index is kept alongside the cells so the assembled header cells can
  // report the band they were read from: a wrapped header spans every line
  // that contributed to it, not just the last one.
  const absorbed: Array<[number, TableCell[]]> = [];
  // A single free-text line interleaved between the header and the first body
  // row (a note, a caption) used to end absorption here, leaving the table
  // headerless - the markdown emitter then promotes the first *data* row into
  // the header slot and that row disappears when parsed. Step over at most one
  // such line and keep walking; it only commits if a genuine header (2 or more
  // cells, all track-aligned) is found directly above, otherwise absorption
  // fails as before and the line stays outside the run.
  const skipped: number[] = [];
  let j = startIdx;
  while (j > floor) {
    const cand = j - 1;
    let cells = splitCells(lines[cand]);
    // PDFium routinely emits a header row's words as one merged text run, so
    // an 8-column table arrives with a 2-cell header whose second cell spans
    // seven tracks. `matchTrackIdx` below can only bind that blob to a single
    // column, collapsing the whole header band into one cell. Body rows
    // already get merged-run recovery; headers need it too.
    //
    // Prose carries whitespace everywhere, so recovery "succeeds" on a
    // paragraph sitting above the table just as readily as on a real header -
    // manufacturing a header out of prose and dragging the paragraph into the
    // table. Cell count can't separate them (a projected prose line splits on
    // its own internal gaps), but length can: header labels are terse,
    // shredded prose is not.
    //
    // Restricted to the first candidate (the line directly above the body): a
    // merged-run header is a single line, whereas letting recovery track-align
    // line after line lets absorption climb an entire paragraph, one
    // plausible-looking row at a time. Also gated on no interstitial skip
    // having happened: skip + recovery compose into two speculative rescues,
    // and together they manufacture headers out of wrapped document titles (a
    // title line above a stepped-over caption shreds into plausible short
    // cells and then suppresses the legitimate bold-first-row promotion). A
    // post-skip header must split into multiple cells on its own.
    if (absorbed.length === 0 && skipped.length === 0 && cells.length < columnCount) {
      const tracks = trackRanges.map((r) => r[0]);
      const recovered = recoverMergedCell([...cells], tracks);
      if (
        recovered !== null &&
        recovered.every((c) => charCount(c.text) <= HEADER_MAX_CELL_CHARS)
      ) {
        cells = recovered;
      }
    }
    // A header line must carry at least two cells (a single cell is a
    // title/caption, not a header) and sit tight above the row below it.
    if (cells.length < 2) {
      // Interstitial skip: a single-cell prose line sitting tight above the
      // body may have a real header directly above it. Restricted to one
      // line, before any absorption (the note sits against the body, never
      // inside a wrapped header band), and the line must be adjacent to the
      // row below it so absorption can't jump gaps.
      if (
        absorbed.length === 0 &&
        skipped.length === 0 &&
        cells.length === 1 &&
        cand > floor &&
        tableRowsAdjacent(lines[cand], lines[j])
      ) {
        skipped.push(cand);
        j = cand;
        continue;
      }
      break;
    }
    if (!tableRowsAdjacent(lines[cand], lines[j])) break;
    if (cells.length > columnCount) break;
    const allAlign = cells.every((c) => trackRanges.some((r) => cellAlignsTrack(c, r)));
    if (!allAlign) break;
    absorbed.push([cand, cells]);
    j = cand;
  }
  if (absorbed.length === 0) return null;
  // Skips only commit when a header was found above them - otherwise the run
  // keeps its old start and the stepped-over line is classified normally. Each
  // committed skip is handed back as owned text + box so the consumer can emit
  // it as a paragraph (the line index lands inside the run span, where the
  // classifier never looks).
  const interstitials: Cell[] = skipped.map((idx) => lineCell(lines[idx]));
  // Collected bottom-up; reverse so text reads top-to-bottom per column.
  absorbed.reverse();
  const header: Cell[] = Array.from({ length: columnCount }, () => newCell(""));
  for (const [lineIdx, cells] of absorbed) {
    for (const c of cells) {
      const covered = spanningTrackIndices(c, trackRanges);
      let indices: number[];
      if (spanningHeaderEligible(c, covered, trackRanges, absorbed.length)) {
        indices = covered;
      } else {
        const idx = matchTrackIdx(c, trackRanges);
        if (idx === null) continue;
        indices = [idx];
      }
      for (const idx of indices) {
        const h = header[idx];
        if (h.text !== "" && c.text !== "") h.text += " ";
        h.text += c.text;
        h.bbox = rectExtend(h.bbox ?? undefined, cellRect(c, lines[lineIdx]));
        h.text_item_indices.push(...c.text_item_indices);
      }
    }
  }
  // A header reached via a skip is held to a coverage bar: it must name at
  // least a third of the columns. A sparse group-label line (2 cells over an
  // 11-column body) absorbed across the wrapped remainder of its own band
  // would otherwise displace the fully-populated real header row below it
  // into the body. Failing the bar fails the whole absorption - the run falls
  // back to its pre-skip behavior.
  if (skipped.length > 0) {
    const nonempty = header.filter((c) => c.text !== "").length;
    if (nonempty * 3 < columnCount) return null;
  }
  return [j, header, interstitials];
}
