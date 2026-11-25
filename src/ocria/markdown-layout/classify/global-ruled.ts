// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): global ruled-table pass.

import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { PositionedBlock } from "../block-types.js";
import { sourcedBlock } from "../blocks/positioned.js";
import { detectTables } from "../tables/borderless/index.js";
import type { RuleSegments } from "../tables/ruled/index.js";
import { detectRuledTables, detectRuledTablesGlobal } from "../tables/ruled/index.js";
import { tableColumnCount, tableCoversGlobal } from "./table-block.js";
import { modelVetoesTable } from "./model-page.js";

/** The ruled tables the global pass emitted and the lines they consumed. */
export type GlobalRuledPass = {
  tables: Array<[number, PositionedBlock]>;
  consumed: Set<number>;
};

/**
 * Global ruled-table pass. `detect_ruled_tables` is otherwise called per
 * xy_cut leaf, but a ruled table whose rows scatter across several leaves
 * never has its full text in any single leaf and gets rejected as
 * mostly-empty. Run it once over all lines, pull the consumed lines out of
 * the region pipeline, and emit each table as a y-positioned interruption.
 * Runs before cross-region merge so that pass (and the region indices its
 * runs carry) operate on the already-filtered line list.
 */
export function globalRuledPass(
  page: ParsedPage,
  lines: readonly ProjectedLine[],
  ruleSegments: RuleSegments
): GlobalRuledPass {
  const tables: Array<[number, PositionedBlock]> = [];
  const consumedAll = new Set<number>();
  for (const [run, consumed] of detectRuledTablesGlobal(
    lines,
    ruleSegments,
    page.page_width,
    page.page_height
  )) {
    // Only rescue tables the per-region path can't see whole: those
    // whose rows scatter across ≥2 xy_cut leaves. A table living in a
    // single region is already handled (often better) by per-region
    // detection — replacing it here only risks regressions.
    const groups = new Map<string, number[]>();
    for (const i of consumed) {
      const key = lines[i].region_path.join(",");
      const g = groups.get(key);
      if (g === undefined) groups.set(key, [i]);
      else g.push(i);
    }
    if (groups.size < 2) continue;
    // A local table vetoes the global run only when it has at least two
    // columns, a material share of the lines, and at least 60% of the
    // global run's numeric cells. Newmark p91's local label grid has 20/29
    // filled cells but almost none of the values, which sit around
    // x=500–530 outside its x=72–500 grid. A true data-region table still
    // vetoes; a prose-fused decorative frame has few numbers to compare.
    // If the global run has no numbers, retain the filled-cell fallback.
    const alreadyHandled = [...groups.values()].some((idxs) => {
      if (idxs.length < 2 || idxs.length * 4 < consumed.length) return false;
      const sub = idxs.map((i) => lines[i]);
      const coversGlobal = (r: { block: PositionedBlock["block"] }): boolean =>
        tableColumnCount(r.block) >= 2 && tableCoversGlobal(r.block, run.block);
      return (
        detectRuledTables(sub, ruleSegments, page.page_width, page.page_height).some(
          coversGlobal
        ) || detectTables(sub).some(coversGlobal)
      );
    });
    if (alreadyHandled) continue;
    // Single-column gate. A decorative banner/frame around a prose
    // column (just a left+right border, no interior verticals) unions
    // into a 1-column "grid" whose lone cell is the whole paragraph
    // block. A real data table always has ≥2 columns; a 1-col ruled
    // region is a framed text box, never tabular. Word-count gating can't
    // be used here: genuine scattered description grids have equally long
    // cells.
    if (tableColumnCount(run.block) < 2) continue;
    const own = consumed.map((i) => lines[i]);
    if (modelVetoesTable(page, own)) continue;
    const topY = Math.min(Infinity, ...consumed.map((i) => lines[i].bbox.y));
    tables.push([topY, sourcedBlock(run.block, run.bbox, run.item_indices)]);
    for (const i of consumed) consumedAll.add(i);
  }
  return { tables, consumed: consumedAll };
}
