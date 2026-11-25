// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/cross_region.rs (crates-v2.21.2, Apache-2.0): validation of a fused zone as a table.

import { splitWhitespace } from "../../rust-extra.js";
import { charCount, f32, trim } from "../../rust.js";
import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import type { Cell } from "../block-types.js";
import { absorbCrossRegionHeaders } from "../tables/merge/index.js";
import { detectTables } from "../tables/borderless/index.js";
import type { TableRun } from "../tables/types.js";
import { clusterMembers } from "./clusters.js";
import type { Cluster } from "./clusters.js";
import {
  CR_LABEL_MAX_CHARS,
  CR_LABEL_WRAP_GAP_FACTOR,
  CR_LONG_CELL_WORDS,
  CR_TWO_COL_MIN_ROWS,
  CR_VALIDATE_MAX_LONG_CELL_FRAC,
  CR_VALIDATE_MIN_COVERAGE,
} from "./constants.js";
import { unionLineItems, unionLineRects } from "./leaves.js";

/** Column count of a `Table` run and whether its cells read as short table cells, not sentence fragments. */
function runReadsAsTable(r: TableRun): boolean {
  const b = r.block;
  if (typeof b === "string" || !("Table" in b)) return false;
  const { header, rows } = b.Table;
  const cols = header != null ? header.length : (rows[0]?.length ?? 0);
  if (cols < 2) return false;
  let cells = 0;
  let long = 0;
  for (const row of rows) {
    for (const cell of row) {
      const t = trim(cell.text);
      if (t === "") continue;
      cells += 1;
      if (splitWhitespace(t).length >= CR_LONG_CELL_WORDS) long += 1;
    }
  }
  return cells > 0 && long <= f32(CR_VALIDATE_MAX_LONG_CELL_FRAC * f32(cells));
}

/**
 * Validation A: the fused zone re-classifies as a table via the standard
 * detectors, covering most of its lines.
 */
export function validateViaDetectors(merged: ProjectedLine[]): TableRun[] | null {
  const runs = detectTables(merged);
  absorbCrossRegionHeaders(merged, runs);
  let covered = 0;
  for (const r of runs) if (runReadsAsTable(r)) covered += r.end - r.start;
  return covered >= f32(CR_VALIDATE_MIN_COVERAGE * f32(merged.length)) ? runs : null;
}

function joinTrimmed(lines: readonly ProjectedLine[]): string {
  return lines.map((l) => trim(l.text)).join(" ");
}

type TwoColRow = { label: Cell; desc: Cell; bold: boolean };

/** Grow a cell's text, box and items with another line group. */
function appendToCell(cell: Cell, text: string, rect: Rect | null, items: number[]): void {
  if (cell.text !== "") cell.text += " ";
  cell.text += text;
  if (rect != null) cell.bbox = rectExtend(cell.bbox ?? undefined, rect);
  cell.text_item_indices.push(...items);
}

/**
 * Validation B: direct 2-column construction for label/description shapes the
 * standard detectors reject (e.g. labels with list-marker prefixes:
 * `is_label_like` is intentionally strict in normal flow, but here the V-cut
 * geometry has already established two columns). Rows are anchored on
 * left-side lines; a left line within wrap distance of the previous one
 * continues the label cell, right-side lines append to the current row's
 * description cell.
 */
export function tryTwoColDirect(
  clusters: Cluster[],
  mergedLen: number,
  tol: number
): TableRun[] | null {
  // Each side's cell box is the union of the lines that fed it, so wrapped
  // labels and multi-line descriptions report the full band they occupy rather
  // than just their first line.
  const rows: TwoColRow[] = [];
  let lastLabelBottom: number | null = null;
  const blank = (): Cell => ({ text: "", bbox: null, text_item_indices: [] });

  for (const cluster of clusters) {
    if (cluster.left.length > 0) {
      const text = joinTrimmed(cluster.left);
      const top = Math.min(Infinity, ...cluster.left.map((l) => l.bbox.y));
      const bottom = Math.max(-Infinity, ...cluster.left.map((l) => f32(l.bbox.y + l.bbox.height)));
      const h = Math.max(f32(bottom - top), 1.0);
      const wraps =
        lastLabelBottom != null &&
        rows.length > 0 &&
        f32(top - lastLabelBottom) <= f32(CR_LABEL_WRAP_GAP_FACTOR * Math.min(h, f32(tol * 2.0)));
      const leftRect = unionLineRects(cluster.left);
      const leftItems = unionLineItems(cluster.left);
      if (wraps) {
        appendToCell(rows[rows.length - 1].label, text, leftRect, leftItems);
      } else {
        const bold = cluster.left.every((l) => l.all_bold);
        rows.push({
          label: { text, bbox: leftRect, text_item_indices: leftItems },
          desc: blank(),
          bold,
        });
      }
      lastLabelBottom = bottom;
    }
    if (cluster.right.length > 0) {
      const text = joinTrimmed(cluster.right);
      if (rows.length === 0) rows.push({ label: blank(), desc: blank(), bold: false });
      appendToCell(
        rows[rows.length - 1].desc,
        text,
        unionLineRects(cluster.right),
        unionLineItems(cluster.right)
      );
    }
  }

  if (rows.length < CR_TWO_COL_MIN_ROWS) return null;
  // Labels must stay label-shaped after wrap joins; a left side of long
  // sentences is prose the anti-prose gate missed.
  if (rows.some((r) => charCount(r.label.text) > CR_LABEL_MAX_CHARS)) return null;
  const both = rows.filter((r) => r.label.text !== "" && r.desc.text !== "").length;
  if (both < 2) return null;

  // First row promotes to header when bold or when both cells are short
  // header-ish words ("Area" / "Competence").
  const r0 = rows[0];
  const promote =
    r0.label.text !== "" &&
    r0.desc.text !== "" &&
    (r0.bold || (charCount(r0.label.text) <= 20 && charCount(r0.desc.text) <= 20));
  const header = promote ? structuredClone([r0.label, r0.desc]) : null;
  const body: Cell[][] = rows.slice(promote ? 1 : 0).map((r) => structuredClone([r.label, r.desc]));
  if (body.length < 2) return null;
  // The run's line indices address the synthetic fused rows, not the page, so
  // its region comes from the clusters the rows were built from.
  let bbox: Rect | undefined;
  for (const c of clusters) for (const l of clusterMembers(c)) bbox = rectExtend(bbox, l.bbox);
  return [
    {
      start: 0,
      end: mergedLen,
      body_start: promote ? 1 : 0,
      bbox: bbox ?? null,
      block: { Table: { header, rows: body } },
      interstitials: [],
      item_indices: [],
    },
  ];
}
