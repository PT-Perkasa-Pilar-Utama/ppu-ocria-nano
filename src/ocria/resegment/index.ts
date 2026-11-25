// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2, Apache-2.0): column resegmentation from the layout model's blocks.

// On dense multi-column pages with narrow gutters the projection can build one line across two
// columns ("caved in and signed an Halifax went hunting with ..."), and the XY-cut leaf then holds
// both columns, so markdown reads them interleaved. The layout model (LayoutNet) sees the page's
// text units and segments them into blocks; where a projected line's spans fall in two different
// model blocks *and* a horizontal gap separates them, the line is split there. Every line of a leaf
// that had such a split is then given a sub-path per block and the leaf's run is reordered block by
// block (columns left to right, each top to bottom), so paragraph grouping and reading order follow
// the model's columns. Leaves without a split are untouched (byte-identical output).

import { splitWhitespace } from "../rust-extra.js";
import { f32, totalCmp } from "../rust.js";
import { BLOCK_CLASSES } from "../table-model/types.js";
import type { ModelBlock } from "../table-model/types.js";
import type { ParsedPage, ProjectedLine } from "../types/page.js";
import { leafColumns, sideBySideLeaves } from "./leaves.js";
import { numericToken } from "./numeric-token.js";
import { splitCandidates, splitLines } from "./split.js";
import { F32_MAX, MARGINAL_MAX_WIDTH, MARGINAL_MIN_NUMERIC } from "./types.js";

export { numericToken };

/** The smallest model block containing a point (nested blocks: the inner one). */
function blockAt(blocks: readonly ModelBlock[], x: number, y: number): number | null {
  let best: number | null = null;
  blocks.forEach((b, i) => {
    const r = b.bbox;
    if (r.x <= x && x <= f32(r.x + r.width) && r.y <= y && y <= f32(r.y + r.height)) {
      // `min_by` keeps the first of equal areas
      const area = f32(r.width * r.height);
      if (
        best === null ||
        totalCmp(area, f32(blocks[best].bbox.width * blocks[best].bbox.height)) < 0
      ) {
        best = i;
      }
    }
  });
  return best;
}

/**
 * Marginal blocks: narrow runs of line numbers / times / page numbers beside the text. Splitting
 * them off as a column moved "19 20 21 ... 37" or a schedule's time column ahead of the text they
 * number.
 */
function marginalBlocks(
  blocks: readonly ModelBlock[],
  lines: readonly ProjectedLine[],
  assigns: ReadonlyArray<ReadonlyArray<number | null>>
): boolean[] {
  let tx0 = F32_MAX;
  let tx1 = -F32_MAX;
  for (const l of lines) {
    tx0 = Math.min(tx0, l.bbox.x);
    tx1 = Math.max(tx1, f32(l.bbox.x + l.bbox.width));
  }
  const words = blocks.map((): [number, number] => [0, 0]);
  lines.forEach((line, li) => {
    line.spans.forEach((sp, si) => {
      const k = assigns[li][si];
      if (k === null) return;
      for (const w of splitWhitespace(sp.text)) {
        words[k][0] += 1;
        words[k][1] += numericToken(w) ? 1 : 0;
      }
    });
  });
  return blocks.map((b, k) => {
    const [n, num] = words[k];
    return (
      n > 0 &&
      b.bbox.width <= f32(MARGINAL_MAX_WIDTH * Math.max(f32(tx1 - tx0), 1)) &&
      num >= f32(MARGINAL_MIN_NUMERIC * n)
    );
  });
}

/**
 * Split and reorder `page.projected_lines` along the layout model's blocks. Returns the number of
 * lines split. No-op without at least two model blocks.
 */
export function resegmentByModelBlocks(page: ParsedPage): number {
  const blocks = page.model_blocks;
  if (blocks.length < 2 || page.projected_lines.length === 0) return 0;
  const isTable = (c: number): boolean =>
    BLOCK_CLASSES[c] === "Table" || BLOCK_CLASSES[c] === "FigureText";
  const lines = page.projected_lines;
  // each span's model block
  const assigns = lines.map((l) =>
    l.spans.map((s) => blockAt(blocks, f32(s.x + f32(s.width / 2)), f32(s.y + f32(s.height / 2))))
  );
  const marginal = marginalBlocks(blocks, lines, assigns);
  // 1. split lines that cross a block boundary at a gutter
  const keep = splitCandidates(lines, assigns, blocks, marginal, isTable);
  const [out, splitPaths, nSplit] = splitLines(lines, assigns, keep);
  sideBySideLeaves(out, blocks, marginal, splitPaths);
  if (splitPaths.length === 0) {
    page.projected_lines = out.map((x) => x.line);
    return 0;
  }
  // 2. in each leaf that had a split, a sub-path per column and a column-by-column order
  page.projected_lines = leafColumns(out, blocks, marginal, splitPaths);
  return nSplit;
}
