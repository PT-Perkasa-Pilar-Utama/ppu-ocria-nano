// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): detect_tables entry points.

import { f32 } from "../../../rust.js";
import type { GraphicPrimitive, Rect } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import {
  mergeConsecutiveTableRuns,
  mergeFragmentedTableClusters,
  tryDetectDescriptionList,
} from "../merge/index.js";
import { detectRuledTablesGlobal, extractRuleSegments } from "../ruled/index.js";
import type { RuleSegments } from "../ruled/index.js";
import type { SpanPiece, TableRun } from "../types.js";
import { RULE_BAND_MIN_HEIGHT_PT, RULE_BAND_MIN_LINES } from "./constants.js";
import { computeLinePieces } from "./span-pieces.js";
import { tryDetectTable } from "./try-detect-table.js";
import { tryDetectTableInferred } from "./try-detect-inferred.js";

/**
 * Scan `lines` once and return all detected tabular regions (sorted by
 * `start`). Caller uses these as cut-points so the per-line classifier never
 * sees lines inside a table.
 */
export function detectTables(lines: ProjectedLine[]): TableRun[] {
  return detectTablesImpl(lines, true);
}

/**
 * `detectTables` plus the booktabs rule-band pass: a table drawn as nothing
 * but a top and bottom hairline has no grid for the ruled detector and, when
 * it has only two columns, is below `TABLE_MIN_COLUMNS` for the borderless
 * one. The rules themselves are the missing evidence - see `ruleBands`.
 */
export function detectTablesBanded(
  lines: ProjectedLine[],
  segs: RuleSegments,
  pageHeight: number
): TableRun[] {
  const pieces = computeLinePieces(lines);
  const runs = detectTablesWithPieces(lines, pieces, true);
  const bands = ruleBands(segs, pageHeight);
  if (bands.length === 0) return runs;
  return twoColBandPass(lines, pieces, runs, bands);
}

/**
 * A booktabs rule band: a pair of horizontal rules with nothing ruled between
 * them, i.e. the top and bottom of a table drawn without a grid.
 *
 * Requires the two rules to overlap in x (they bound the same block), to sit
 * far enough apart to hold rows but not so far as to be page furniture, and -
 * crucially - to have no vertical rule crossing between them. A band with
 * verticals is a real grid, and the ruled detector owns it.
 */
export function ruleBands(segs: RuleSegments, pageHeight: number): Array<[number, number]> {
  const { hs, raw_vs: vs } = segs;
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < hs.length; i++) {
    const top = hs[i];
    const bot = hs[i + 1];
    const sep = f32(bot.y - top.y);
    if (!(sep >= RULE_BAND_MIN_HEIGHT_PT && sep < f32(pageHeight * 0.5))) continue;
    const overlap = Math.max(
      f32(Math.min(top.x_max, bot.x_max) - Math.max(top.x_min, bot.x_min)),
      0
    );
    const extent = Math.max(Math.max(f32(top.x_max - top.x_min), f32(bot.x_max - bot.x_min)), 1);
    if (f32(overlap / extent) < f32(0.6)) continue;
    if (vs.some((v) => v.y_min < f32(bot.y - 1) && v.y_max > f32(top.y + 1))) continue;
    out.push([top.y, bot.y]);
  }
  return out;
}

/**
 * Last-resort pass for two-column tables enclosed in a rule band.
 *
 * Modelled on `twoRowSecondPass` and gated the same way - only in the index
 * gaps where the normal pass found nothing, and only for runs that stay inside
 * the gap. The extra requirement is that the seed line lie inside a band and
 * that the band hold enough lines to be a table rather than a rule under a
 * heading or a hyperlink underline.
 */
export function twoColBandPass(
  lines: ProjectedLine[],
  pieces: SpanPiece[][],
  runs: TableRun[],
  bands: ReadonlyArray<readonly [number, number]>
): TableRun[] {
  const claimed = (a: number, b: number): boolean => runs.some((r) => r.start < b && a < r.end);
  const extra: TableRun[] = [];
  for (const [y0, y1] of bands) {
    const inside: number[] = [];
    lines.forEach((l, i) => {
      const c = f32(l.bbox.y + f32(l.bbox.height * 0.5));
      if (c > y0 && c < y1) inside.push(i);
    });
    // The band's lines must be a contiguous run of the region and numerous
    // enough to be a table body rather than a rule under a heading or a stack
    // of hyperlink underlines.
    if (
      inside.length < RULE_BAND_MIN_LINES ||
      inside[inside.length - 1] - inside[0] + 1 !== inside.length
    ) {
      continue;
    }
    const bs = inside[0];
    const be = inside[inside.length - 1] + 1;
    if (claimed(bs, be)) continue;
    // The seed must read as a genuine two-cell row, not a wrapped prose line
    // that happens to sit under a rule.
    if (pieces[bs].length !== 2) continue;
    // Detect against the band's lines alone: a run can then never reach past
    // the rules that are the whole justification for relaxing
    // `TABLE_MIN_COLUMNS` here.
    const run = tryDetectTableInferred(
      lines.slice(bs, be),
      pieces.slice(bs, be),
      0,
      0,
      false,
      true
    );
    if (run !== null) {
      run.start += bs;
      run.end += bs;
      run.body_start += bs;
      extra.push(run);
    }
  }
  if (extra.length === 0) return runs;
  return [...runs, ...extra].sort((a, b) => a.start - b.start);
}

/**
 * Count borderless table runs for the layout-complexity stats. Excludes
 * description lists - a label/value pair block reads fine as text, so it
 * should not flag the page as table-bearing. `GridFallback` runs count:
 * tabular structure the emitter couldn't extract cleanly still marks the page
 * as table-bearing.
 */
export function countTextTableRuns(lines: ProjectedLine[]): number {
  return detectTablesImpl(lines, false).length;
}

/**
 * Validated ruled-table rects for the layout-complexity stats. Unlike the raw
 * grid components (`detectTableRects`, which deliberately over-captures for
 * use as XY-cut obstacles), each candidate grid here is confirmed against the
 * projected text by `buildRuledTable` - so a plain boxed callout or a chart's
 * axis gridlines, which have the lines but not the cell structure, don't
 * count. Returns the bounding rect of each run's consumed lines.
 */
export function validatedRuledTableRects(
  lines: ProjectedLine[],
  graphics: GraphicPrimitive[],
  pageWidth: number,
  pageHeight: number
): Rect[] {
  const segs = extractRuleSegments(graphics);
  const out: Rect[] = [];
  for (const [, consumed] of detectRuledTablesGlobal(lines, segs, pageWidth, pageHeight)) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of consumed) {
      const b = lines[i].bbox;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, f32(b.x + b.width));
      y1 = Math.max(y1, f32(b.y + b.height));
    }
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: f32(x1 - x0), height: f32(y1 - y0) });
  }
  return out;
}

export function detectTablesImpl(lines: ProjectedLine[], includeDescLists: boolean): TableRun[] {
  const pieces = computeLinePieces(lines);
  return detectTablesWithPieces(lines, pieces, includeDescLists);
}

export function detectTablesWithPieces(
  lines: ProjectedLine[],
  pieces: SpanPiece[][],
  includeDescLists: boolean
): TableRun[] {
  const out: TableRun[] = [];
  let i = 0;
  let floor = 0;
  while (i < lines.length) {
    const run =
      tryDetectTableInferred(lines, pieces, i, floor, false, false) ??
      tryDetectTable(lines, i, floor) ??
      (includeDescLists ? tryDetectDescriptionList(lines, i) : null);
    if (run !== null) {
      floor = run.end;
      i = run.end;
      out.push(run);
    } else {
      i += 1;
    }
  }
  let merged = mergeConsecutiveTableRuns(out, lines);
  // Iterate to fixpoint (bounded): a merged cluster is itself a table run that
  // may now sit adjacent to the next fragment cluster.
  for (let n = 0; n < 4; n++) {
    const before = merged.length;
    merged = mergeFragmentedTableClusters(merged, lines);
    if (merged.length === before) break;
  }
  return twoRowSecondPass(lines, pieces, merged);
}

/**
 * Last-resort pass for header + single-data-row tables.
 *
 * Some real tables are a header row plus exactly one data row. Both length
 * gates in `tryDetectTableInferred` reject them. Relaxing those gates directly
 * is not safe: a 2-row run forms early, higher up the page, and consumes the
 * header of the real multi-row table below it.
 *
 * So instead we keep the normal pass exactly as-is and only retry, with the
 * relaxation on, inside the index gaps where it found no table at all. By
 * construction a run detected here cannot steal rows from a real table: there
 * isn't one in the gap. Runs that would spill past the gap end are discarded
 * for the same reason.
 */
export function twoRowSecondPass(
  lines: ProjectedLine[],
  pieces: SpanPiece[][],
  runs: TableRun[]
): TableRun[] {
  // Gaps between (and around) the runs the normal pass claimed.
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const r of runs) {
    if (r.start > cursor) gaps.push([cursor, r.start]);
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < lines.length) gaps.push([cursor, lines.length]);

  const extra: TableRun[] = [];
  for (const [gs, ge] of gaps) {
    let i = gs;
    // `floor` starts at the gap start so header absorption can never walk back
    // into the preceding table run.
    let floor = gs;
    while (i < ge) {
      const run = tryDetectTableInferred(lines, pieces, i, floor, true, false);
      // A run that reaches past the gap is exactly the theft case the gap
      // restriction exists to prevent.
      if (run !== null && run.end <= ge && run.start >= gs) {
        floor = run.end;
        i = run.end;
        extra.push(run);
      } else {
        i += 1;
      }
    }
  }
  if (extra.length === 0) return runs;
  return [...runs, ...extra].sort((a, b) => a.start - b.start);
}
