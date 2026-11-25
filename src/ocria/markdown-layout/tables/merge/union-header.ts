// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): header re-extraction against union tracks.

import { f32, totalCmp, trim } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { Rect } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { TextItem } from "../../../types/text-item.js";
import type { Cell } from "../../block-types.js";
import {
  cellAlignsTrack,
  lineCell,
  linesBbox,
  tableRowsAdjacent,
  TABLE_TRACK_TOLERANCE_PT,
} from "../borderless/index.js";
import type { TableCell, TableRun } from "../types.js";
import { TABLE_CLUSTER_MAX_HEADER_LINES, TABLE_SUBSET_TRACK_TOLERANCE_PT } from "./constants.js";
import { crossRegionHeaderTracks } from "./track-match.js";
import type { Track } from "./track-match.js";

/** `f32::EPSILON`. */
const F32_EPSILON = 1.1920929e-7;

/** `[new_start, header, interstitials]`. */
export type UnionHeader = [number, Cell[], Cell[]];

function emptyCell(): Cell {
  return { text: "", bbox: null, text_item_indices: [] };
}

function validRange(range: Track): boolean {
  return Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] <= range[1];
}

/**
 * Walk upward from the cluster's body start, binning each candidate header
 * line's raw spans into the union tracks. A span covering multiple tracks (a
 * group header like `EFETIVO` spanning its `ENFERMARIA`/`QUARTO` sub-columns)
 * replicates its text across every covered track: the pipe table flattening
 * of a colspan'd grid header. Layers stack top-to-bottom per column.
 */
export function unionHeaderFromAbove(
  lines: ProjectedLine[],
  bodyStart: number,
  floor: number,
  tracks: Track[],
  allowSingleInterstitial: boolean
): UnionHeader | null {
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const validTrackCenters: Array<[number, number]> = [];
  tracks.forEach((range, idx) => {
    if (validRange(range)) validTrackCenters.push([idx, f32(f32(range[0] + range[1]) * 0.5)]);
  });
  // Fallback assignment for centered header cells whose extent doesn't reach
  // the track anchor: nearest track within half the local gap, with a small
  // extra margin for cross-region header absorption.
  const assignNearest = (xCenter: number): number | null => {
    let position = -1;
    let bestD = Infinity;
    validTrackCenters.forEach(([, c], p) => {
      const d = Math.abs(f32(xCenter - c));
      if (position < 0 || totalCmp(d, bestD) < 0) {
        position = p;
        bestD = d;
      }
    });
    if (position < 0) return null;
    const [idx, center] = validTrackCenters[position];
    const d = Math.abs(f32(xCenter - center));
    let localGap = Infinity;
    if (position + 1 < validTrackCenters.length) {
      localGap = f32(validTrackCenters[position + 1][1] - center);
    } else if (position > 0) {
      localGap = f32(center - validTrackCenters[position - 1][1]);
    }
    const edgeTolerance = allowSingleInterstitial ? tol : 0.0;
    if (d <= Math.max(f32(f32(localGap * 0.5) + edgeTolerance), TABLE_SUBSET_TRACK_TOLERANCE_PT)) {
      return idx;
    }
    return null;
  };

  const layers: Cell[][] = [];
  let skipped: number | null = null;
  let j = bodyStart;
  while (j > floor && layers.length < TABLE_CLUSTER_MAX_HEADER_LINES) {
    const cand = j - 1;
    if (!tableRowsAdjacent(lines[cand], lines[j])) break;
    const spans: Array<[TextItem, number | null]> = [];
    lines[cand].spans.forEach((s, i) => {
      if (trim(s.text) !== "") spans.push([s, lines[cand].span_item_indices[i] ?? null]);
    });
    if (spans.length < 2) {
      if (allowSingleInterstitial && layers.length === 0 && skipped == null && spans.length === 1) {
        skipped = cand;
        j = cand;
        continue;
      }
      break;
    }
    const layer: Cell[] = Array.from({ length: tracks.length }, emptyCell);
    let ok = true;
    for (const [s, itemIndex] of spans) {
      const x0 = s.x;
      const x1 = f32(s.x + Math.max(s.width, 0.0));
      const headerCell: TableCell = {
        start_x: x0,
        end_x: x1,
        text: "",
        bold: false,
        text_item_indices: [],
        item_x_ranges: [],
      };
      const covered: number[] = [];
      tracks.forEach((range, i) => {
        if (!validRange(range)) return;
        if (Math.abs(f32(range[1] - range[0])) <= F32_EPSILON) {
          if (range[0] >= f32(x0 - tol) && range[0] <= f32(x1 + tol)) covered.push(i);
        } else if (cellAlignsTrack(headerCell, range)) {
          covered.push(i);
        }
      });
      let targets: number[];
      if (covered.length > 0) {
        targets = covered;
      } else {
        const idx = assignNearest(f32(f32(x0 + x1) * 0.5));
        if (idx == null) {
          ok = false;
          break;
        }
        targets = [idx];
      }
      // A span covering several tracks replicates into each of them, so every
      // covered cell reports the span it was flattened from.
      const spanRect: Rect = {
        x: s.x,
        y: s.y,
        width: Math.max(s.width, 0.0),
        height: Math.max(s.height, 0.0),
      };
      for (const idx of targets) {
        const dst = layer[idx];
        if (dst.text !== "") dst.text += " ";
        dst.text += trim(s.text);
        dst.bbox = rectExtend(dst.bbox ?? undefined, spanRect);
        if (itemIndex != null) dst.text_item_indices.push(itemIndex);
      }
    }
    if (!ok || layer.filter((t) => t.text !== "").length < 2) break;
    layers.push(layer);
    j = cand;
  }
  if (layers.length === 0) return null;
  layers.reverse();
  const header: Cell[] = [];
  for (let col = 0; col < tracks.length; col++) {
    const parts: string[] = [];
    let bbox: Rect | null = null;
    const textItemIndices: number[] = [];
    for (const layer of layers) {
      const s = layer[col].text;
      const layerBox = layer[col].bbox;
      if (layerBox != null) bbox = rectExtend(bbox ?? undefined, layerBox);
      textItemIndices.push(...layer[col].text_item_indices);
      if (s === "" || parts[parts.length - 1] === s) continue;
      parts.push(s);
    }
    header.push({ text: parts.join(" "), bbox, text_item_indices: textItemIndices });
  }
  if (header.every((h) => h.text === "")) return null;
  if (skipped != null && header.filter((c) => c.text !== "").length * 3 < tracks.length) {
    return null;
  }
  const interstitials = skipped == null ? [] : [lineCell(lines[skipped])];
  return [j, header, interstitials];
}

export function absorbCrossRegionHeaders(lines: ProjectedLine[], runs: TableRun[]): void {
  let floor = 0;
  for (const run of runs) {
    const b = run.block;
    const needsHeader =
      typeof b !== "string" && "Table" in b && b.Table.header == null && b.Table.rows.length > 0;
    const bodyTracks = needsHeader ? crossRegionHeaderTracks(run, lines) : null;
    if (needsHeader && bodyTracks != null) {
      const absorbed = unionHeaderFromAbove(lines, run.body_start, floor, bodyTracks, true);
      if (absorbed != null) {
        const [start, header, interstitials] = absorbed;
        run.start = start;
        run.bbox = linesBbox(lines, start, run.end);
        run.interstitials = interstitials;
        if (typeof b !== "string" && "Table" in b) b.Table.header = header;
      }
    }
    floor = run.end;
  }
}
