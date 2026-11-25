// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2, Apache-2.0): reordering leaves by model column.

import { samePath } from "../table-model/signals.js";
import type { ModelBlock } from "../table-model/types.js";
import type { ProjectedLine } from "../types/page.js";
import { f32, totalCmp } from "../rust.js";
import { F32_MAX, leafRuns, MIN_COLUMN_LINES } from "./types.js";
import type { LineBlock } from "./types.js";

/**
 * Leaves whose whole lines fall in side-by-side model blocks (columns the XY-cut missed: separate
 * lines read row by row across the page) join `splitPaths` too. Each such block must hold
 * >= MIN_COLUMN_LINES of the leaf's lines, so forms / key-value rows (one-line blocks side by
 * side) keep their row order.
 */
export function sideBySideLeaves(
  out: readonly LineBlock[],
  blocks: readonly ModelBlock[],
  marginal: readonly boolean[],
  splitPaths: number[][]
): void {
  for (const { from, to } of leafRuns(out)) {
    const path = out[from].line.region_path;
    const run = out.slice(from, to);
    const mono = run.filter((x) => x.line.all_mono).length * 2 > to - from;
    if (splitPaths.some((p) => samePath(p, path)) || mono) continue;
    const count: Array<[number, number]> = [];
    for (const { block } of run) {
      if (block === null) continue;
      const c = count.find(([k]) => k === block);
      if (c) c[1] += 1;
      else count.push([block, 1]);
    }
    const cols = count.filter(([k, n]) => n >= MIN_COLUMN_LINES && !marginal[k]).map(([k]) => k);
    const sideBySide = cols.some((a) =>
      cols.some((b) => {
        const [ra, rb] = [blocks[a].bbox, blocks[b].bbox];
        return (
          a !== b &&
          f32(ra.x + ra.width) <= rb.x &&
          ra.y < f32(rb.y + rb.height) &&
          rb.y < f32(ra.y + ra.height)
        );
      })
    );
    if (sideBySide) splitPaths.push(path);
  }
}

/**
 * In each leaf that had a split, a sub-path per column and a column-by-column order (each top to
 * bottom). Leaves outside `splitPaths` keep their lines.
 */
export function leafColumns(
  out: readonly LineBlock[],
  blocks: readonly ModelBlock[],
  marginal: readonly boolean[],
  splitPaths: readonly number[][]
): ProjectedLine[] {
  const result: ProjectedLine[] = [];
  for (const { from, to } of leafRuns(out)) {
    const run = out.slice(from, to);
    if (!splitPaths.some((p) => samePath(p, run[0].line.region_path))) {
      result.push(...run.map((x) => x.line));
      continue;
    }
    // a marginal block is no column: its lines join the nearest column in y order, beside the lines they number
    const present = [
      ...new Set(
        run
          .flatMap((x) => (x.block !== null && !marginal[x.block] ? [x.block] : []))
          .sort((a, b) => a - b)
      ),
    ];
    present.sort((a, b) => totalCmp(blocks[a].bbox.x, blocks[b].bbox.x));
    // Columns: blocks whose x-ranges overlap share one (an indented quote or list stays in its column instead
    // of sorting after every block at the column's left edge). Blocks spanning most of the leaf (a full-width
    // heading) would fuse the columns, so they are left out of the clustering and join the nearest column.
    let lx0 = F32_MAX;
    let lx1 = -F32_MAX;
    for (const { line } of run) {
      lx0 = Math.min(lx0, line.bbox.x);
      lx1 = Math.max(lx1, f32(line.bbox.x + line.bbox.width));
    }
    const wide = (k: number): boolean =>
      blocks[k].bbox.width > f32(f32(0.6) * Math.max(f32(lx1 - lx0), 1));
    const colRight: number[] = [];
    const colOf: Array<[number, number]> = [];
    for (const k of present.filter((x) => !wide(x))) {
      const r = blocks[k].bbox;
      const right = colRight.at(-1);
      if (right !== undefined && r.x < right)
        colRight[colRight.length - 1] = Math.max(right, f32(r.x + r.width));
      else colRight.push(f32(r.x + r.width));
      colOf.push([k, colRight.length - 1]);
    }
    // a line's column: its block's, or (wide block / no block) the column whose x-range is nearest its centre
    const colLeft = colRight.map((_, c) =>
      colOf.filter(([, cc]) => cc === c).reduce((m, [k]) => Math.min(m, blocks[k].bbox.x), F32_MAX)
    );
    const columnAt = (l: ProjectedLine): number => {
      const cx = f32(l.bbox.x + f32(l.bbox.width / 2));
      const d = (c: number): number => {
        if (cx < colLeft[c]) return f32(colLeft[c] - cx);
        if (cx > colRight[c]) return f32(cx - colRight[c]);
        return 0;
      };
      let best: number | null = null;
      for (let c = 0; c < colRight.length; c++) {
        if (best === null || totalCmp(d(c), d(best)) < 0) best = c;
      }
      return best ?? 0;
    };
    const leaf = run.map(({ line, block }): [number, ProjectedLine] => {
      const own = block === null ? undefined : colOf.find(([kk]) => kk === block);
      return [own === undefined ? columnAt(line) : own[1], line];
    });
    leaf.sort(
      ([ra, a], [rb, b]) => ra - rb || totalCmp(a.bbox.y, b.bbox.y) || totalCmp(a.bbox.x, b.bbox.x)
    );
    for (const [rank, l] of leaf) result.push({ ...l, region_path: [...l.region_path, rank] });
  }
  return result;
}
