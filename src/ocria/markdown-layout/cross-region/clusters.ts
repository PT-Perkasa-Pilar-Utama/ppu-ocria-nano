// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/cross_region.rs (crates-v2.21.2, Apache-2.0): baseline clusters and row fusion.

import { isRtlPieces } from "../../bidi.js";
import { asUsize, clamp, f32, totalCmp } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";

/** The lines of one baseline row, split by side of the cut. */
export type Cluster = { left: ProjectedLine[]; right: ProjectedLine[] };

/** `Cluster::members`: left lines, then right lines. */
export function clusterMembers(c: Cluster): ProjectedLine[] {
  return [...c.left, ...c.right];
}

function yCenter(l: ProjectedLine): number {
  return f32(l.bbox.y + f32(l.bbox.height * 0.5));
}

/**
 * Cluster the set's lines into baseline rows: lines whose y-centers fall
 * within `tol` of the cluster seed share a row.
 */
export function clusterRows(set: ReadonlyArray<[ProjectedLine, boolean]>, tol: number): Cluster[] {
  const sorted = [...set].sort((a, b) => totalCmp(yCenter(a[0]), yCenter(b[0])));
  const clusters: Array<[number, Cluster]> = [];
  for (const [line, isLeft] of sorted) {
    const yc = yCenter(line);
    const last = clusters[clusters.length - 1];
    if (last != null && Math.abs(f32(yc - last[0])) <= tol) {
      (isLeft ? last[1].left : last[1].right).push(line);
    } else {
      const c: Cluster = { left: [], right: [] };
      (isLeft ? c.left : c.right).push(line);
      clusters.push([yc, c]);
    }
  }
  return clusters.map(([, c]) => c);
}

/**
 * Fuse one baseline cluster into a single `ProjectedLine`: spans concatenate
 * (cell boundaries fall out of the span gaps in `split_cells`), text joins with
 * gap-proportional spacing, styles AND together.
 */
export function fuseCluster(cluster: Cluster, path: number[]): ProjectedLine {
  const members = clusterMembers(cluster);
  // Fuse in reading order: a right-to-left row starts at its highest x, so
  // walking left-to-right would emit its cells backwards. `fused.spans` is
  // re-sorted x-ascending at the end either way, keeping cell geometry intact.
  const rtl = isRtlPieces(members.map((m) => m.text));
  if (rtl) members.sort((a, b) => totalCmp(b.bbox.x, a.bbox.x));
  else members.sort((a, b) => totalCmp(a.bbox.x, b.bbox.x));

  const first = members[0];
  const fused = structuredClone(first);
  fused.rtl = rtl;
  fused.region_path = [...path];
  let indexed = first.spans.length === first.span_item_indices.length;
  for (const m of members.slice(1)) {
    // Gap to the previously-fused run, measured along the reading direction so
    // the space count stays proportional in both.
    const gap = rtl
      ? Math.max(f32(fused.bbox.x - f32(m.bbox.x + m.bbox.width)), 0.0)
      : Math.max(f32(m.bbox.x - f32(fused.bbox.x + fused.bbox.width)), 0.0);
    const approxCharW = Math.max(f32(fused.dominant_font_size * 0.5), 2.0);
    const nSpaces = clamp(asUsize(f32(gap / approxCharW)), 2, 24);
    fused.text += " ".repeat(nSpaces);
    fused.text += m.text;
    fused.spans.push(...structuredClone(m.spans));
    fused.span_item_indices.push(...m.span_item_indices);
    indexed &&= m.spans.length === m.span_item_indices.length;
    const x1 = Math.max(f32(fused.bbox.x + fused.bbox.width), f32(m.bbox.x + m.bbox.width));
    const y1 = Math.max(f32(fused.bbox.y + fused.bbox.height), f32(m.bbox.y + m.bbox.height));
    fused.bbox.x = Math.min(fused.bbox.x, m.bbox.x);
    fused.bbox.y = Math.min(fused.bbox.y, m.bbox.y);
    fused.bbox.width = f32(x1 - fused.bbox.x);
    fused.bbox.height = f32(y1 - fused.bbox.y);
    fused.all_bold &&= m.all_bold;
    fused.all_italic &&= m.all_italic;
    fused.all_mono &&= m.all_mono;
    fused.all_strike &&= m.all_strike;
    fused.font_size_is_estimated ||= m.font_size_is_estimated;
  }
  // Sort spans and their item indices together; a member without indices would
  // misalign the rest, so then the fused line carries none.
  const order = fused.spans.map((_, i) => i);
  order.sort((a, b) => totalCmp(fused.spans[a].x, fused.spans[b].x));
  const spans = order.map((i) => fused.spans[i]);
  const indices = indexed ? order.map((i) => fused.span_item_indices[i]) : [];
  fused.spans = spans;
  fused.span_item_indices = indices;
  return fused;
}
