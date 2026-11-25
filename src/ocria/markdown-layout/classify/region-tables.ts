// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): table detection for one region.

import { f32 } from "../../rust.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import { cellSourced, sourcedBlock } from "../blocks/positioned.js";
import { MIN_ROW_HEIGHT_PT } from "../constants.js";
import { escapeInline } from "../inline/index.js";
import { collapseWhitespace } from "../paragraphs/index.js";
import {
  detectTablesBanded,
  lineItemsInReadingOrder,
  linesLeftOut,
  runTextKept,
} from "../tables/borderless/index.js";
import type { RuleSegments } from "../tables/ruled/index.js";
import { detectRuledTables, mergeTableRuns } from "../tables/ruled/index.js";
import type { TableRun } from "../tables/types.js";
import { heuristicTablesMode, modelVetoesTable } from "./model-page.js";
import type { RegionCtx } from "./region-ctx.js";
import { tableBlockIsProse } from "./table-block.js";

/**
 * Per-region table detection. Page-level graphics are still consulted for ruled-table detection
 * because path objects are page-coordinate; the detector intersects them against the sub-list's
 * line bboxes anyway. When the learned table model ran on the page (it labels every unit), its
 * tables already replace the heuristics where they lie; elsewhere the heuristic detectors can
 * still fire on text the model judged not to be a table (multi-column prose read as a grid).
 * There only tables whose cells don't read as prose columns are kept (`Smart`).
 */
export function detectRegionTables(
  page: ParsedPage,
  lines: ProjectedLine[],
  ruleSegments: RuleSegments,
  precomputed: TableRun[] | null
): TableRun[] {
  const heuristic = heuristicTablesMode(page);
  const ruledAll = detectRuledTables(lines, ruleSegments, page.page_width, page.page_height);
  // bordered text panels read as ruled tables too: same prose test as the borderless runs
  const ruledRuns =
    heuristic === "Smart" ? ruledAll.filter((run) => !tableBlockIsProse(run.block)) : ruledAll;
  const borderlessAll = precomputed ?? detectTablesBanded(lines, ruleSegments, page.page_height);
  // keep the borderless detector's tables unless their cells read as prose columns
  const borderlessRuns =
    heuristic === "Smart"
      ? borderlessAll.filter((run) => !tableBlockIsProse(run.block))
      : borderlessAll;
  // A table that carries under 70% of the text of the lines it spans loses the rest, since the
  // loop in `classify_region` skips the span. Handing back lines no cell took a word from cannot
  // help when every line shares a word with the cells, so such a run is read as text: every
  // value kept, no grid.
  return mergeTableRuns(ruledRuns, borderlessRuns)
    .filter((run) => {
      const kept = runTextKept(run, lines);
      return kept === null || kept >= f32(0.7);
    })
    .filter(
      (run) => heuristic !== "Smart" || !modelVetoesTable(page, lines.slice(run.start, run.end))
    );
}

/** Rows above a table's first line that a rule is still taken to belong to the table. */
const TABLE_HR_SUPPRESS_HEADROOM_ROWS = 4;

/** `(top, bottom)` y band of each table run, used to drop rules and figures that would split it. */
export function tableYExtents(
  runs: readonly TableRun[],
  lines: readonly ProjectedLine[]
): Array<[number, number]> {
  return runs.map((run) => {
    const top = lines[run.start];
    const rowH = Math.max(top.bbox.height, MIN_ROW_HEIGHT_PT);
    const y0 = f32(top.bbox.y - f32(rowH * TABLE_HR_SUPPRESS_HEADROOM_ROWS));
    const last = lines[Math.max(Math.max(run.end - 1, 0), run.start)];
    return [y0, f32(last.bbox.y + last.bbox.height)];
  });
}

/** Emit one table run: its interstitial notes as paragraphs, then the table block. */
export function emitTableRun(ctx: RegionCtx, run: TableRun): void {
  const { lines, blocks } = ctx;
  // Lines in the span that no cell took a word from (a note under the table, a column the grid
  // left out) go the same way.
  for (const i of linesLeftOut(run, lines)) {
    run.interstitials.push(
      cellSourced(lines[i].text, lines[i].bbox, lineItemsInReadingOrder(lines[i]))
    );
  }
  // Prose lines the run stepped over between its header and body sit inside
  // `[run.start, run.end)`, which the line loop skips — emit each as its own paragraph ahead of
  // the table so the text isn't dropped. Interstitials carry raw text, like table cells, so they
  // get the escaping a plain paragraph gets.
  for (const note of run.interstitials) {
    if (note.text === "") continue;
    blocks.push(
      sourcedBlock(
        {
          Paragraph: {
            text: escapeInline(collapseWhitespace(note.text)),
            bold: false,
            italic: false,
          },
        },
        note.bbox,
        note.text_item_indices
      )
    );
  }
  blocks.push(sourcedBlock(run.block, run.bbox, run.item_indices));
}
