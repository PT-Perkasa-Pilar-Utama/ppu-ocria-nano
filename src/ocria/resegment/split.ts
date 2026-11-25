// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2, Apache-2.0): splitting lines at block gutters.

import { rectUnion } from "../types/geometry.js";
import type { Rect } from "../types/geometry.js";
import type { ParsedPage, ProjectedLine } from "../types/page.js";
import type { ModelBlock } from "../table-model/types.js";
import { samePath } from "../table-model/signals.js";
import { f32, trim } from "../rust.js";
import { GUTTER_EM, MIN_COLUMN_LINES } from "./types.js";
import type { LineBlock } from "./types.js";

type Lines = ParsedPage["projected_lines"];

/**
 * Candidate cuts per line, as (span index, gap centre): before span i where its block differs from
 * the previous one across a gutter (monospace, rotated, RTL and table lines have none).
 */
function candidates(
  lines: Lines,
  assigns: ReadonlyArray<ReadonlyArray<number | null>>,
  blocks: readonly ModelBlock[],
  marginal: readonly boolean[],
  isTable: (c: number) => boolean
): Array<Array<[number, number]>> {
  return lines.map((line, li) => {
    const assign = assigns[li];
    const cand: Array<[number, number]> = [];
    const rotated = line.spans.some((s) => Math.abs(s.rotation) > 1);
    const touchesTable = assign.some((b) => b !== null && isTable(blocks[b].class));
    if (line.spans.length < 2 || rotated || touchesTable || line.rtl || line.all_mono) return cand;
    const gapMin = f32(GUTTER_EM * Math.max(line.dominant_font_size, 4));
    let prevBlock = assign[0];
    for (let i = 1; i < line.spans.length; i++) {
      const [a, b] = [line.spans[i - 1], line.spans[i]];
      const cb = assign[i];
      if (
        prevBlock !== null &&
        cb !== null &&
        prevBlock !== cb &&
        !marginal[prevBlock] &&
        !marginal[cb] &&
        f32(b.x - f32(a.x + a.width)) >= gapMin
      ) {
        cand.push([i, f32(f32(f32(a.x + a.width) + b.x) / 2)]);
      }
      if (cb !== null) prevBlock = cb;
    }
    return cand;
  });
}

/**
 * The cuts each line keeps. A column gutter is a channel: the same gap on several lines of the
 * leaf. A lone wide word gap where a model block edge cuts through justified text ("... access to
 * | it.") is not, and splitting there moved line endings into a column of their own.
 */
export function splitCandidates(
  lines: Lines,
  assigns: ReadonlyArray<ReadonlyArray<number | null>>,
  blocks: readonly ModelBlock[],
  marginal: readonly boolean[],
  isTable: (c: number) => boolean
): number[][] {
  const cand = candidates(lines, assigns, blocks, marginal, isTable);
  return lines.map((li, i) => {
    const em = Math.max(li.dominant_font_size, 4);
    const keep: number[] = [];
    for (const [idx, x] of cand[i]) {
      const support = lines.filter(
        (lj, j) =>
          samePath(lj.region_path, li.region_path) &&
          cand[j].some(([, y]) => Math.abs(f32(y - x)) <= em)
      ).length;
      if (support >= MIN_COLUMN_LINES) keep.push(idx);
    }
    return keep;
  });
}

/** The model block holding most of a line's spans (the first of equal counts). */
function majority(assign: ReadonlyArray<number | null>): number | null {
  let best: [number, number] | null = null;
  for (const b of assign) {
    if (b === null) continue;
    const n = assign.filter((a) => a === b).length;
    if (best === null || n > best[1]) best = [b, n];
  }
  return best === null ? null : best[0];
}

/** One piece of a split line: spans `[from, to)` as a line of their own. */
function linePart(line: ProjectedLine, from: number, to: number): ProjectedLine {
  const spans = line.spans.slice(from, to);
  const box = (s: ProjectedLine["spans"][number]): Rect => ({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
  });
  let bbox = box(spans[0]);
  for (const s of spans.slice(1)) bbox = rectUnion(bbox, box(s));
  const text = spans
    .map((s) => trim(s.text))
    .filter((t) => t !== "")
    .join(" ");
  return { ...line, indent_x: f32(line.indent_x + f32(bbox.x - line.bbox.x)), text, bbox, spans };
}

/**
 * Split each line at its kept cuts. Returns the lines with their model block, the region paths of
 * the leaves that had a split, and the number of lines split.
 */
export function splitLines(
  lines: Lines,
  assigns: ReadonlyArray<ReadonlyArray<number | null>>,
  keep: ReadonlyArray<readonly number[]>
): [LineBlock[], number[][], number] {
  const out: LineBlock[] = [];
  const splitPaths: number[][] = [];
  let nSplit = 0;
  lines.forEach((line, li) => {
    const assign = assigns[li];
    const cuts = keep[li];
    if (cuts.length === 0) {
      out.push({ line, block: majority(assign) });
      return;
    }
    nSplit += 1;
    if (!splitPaths.some((p) => samePath(p, line.region_path))) splitPaths.push(line.region_path);
    const bounds = [0, ...cuts, line.spans.length];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const block = assign.slice(bounds[k], bounds[k + 1]).find((b) => b !== null) ?? null;
      out.push({ line: linePart(line, bounds[k], bounds[k + 1]), block });
    }
  });
  return [out, splitPaths, nSplit];
}
