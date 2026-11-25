// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): rotation and reading order.

import { isRtlPieces } from "../bidi.js";
import { remEuclidF32, roundF32 } from "../rust-extra.js";
import { asInt, f32, totalCmp, trimEnd, trimStart } from "../rust.js";
import { sumF32 } from "./projected-item.js";
import type { ProjectedTextItem } from "./types.js";

const CARDINALS = [0, 90, 180, 270];

/** The cardinal rotation within 2 degrees of `rotation`, else the rotation rounded to a whole degree. */
export function canonicalRotation(rotation: number): number {
  const r = remEuclidF32(rotation, 360);
  let best = 0;
  let bestDelta = Infinity;
  for (const c of CARDINALS) {
    // Circular angular distance, so rotations just under 360 degrees are treated
    // as near 0 (e.g. 359 is 1 from upright, not 89 from 270).
    const raw = Math.abs(f32(r - c));
    const delta = Math.min(raw, f32(360 - raw));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  return bestDelta <= 2 ? best : asInt(roundF32(r));
}

/**
 * Append `right` (the item to the right on the page) to `left` in reading order: after it for
 * a left-to-right pair, before it when the pair reads right to left (Hebrew / Arabic words
 * PDFium emitted as separate runs). Joining in x order reversed RTL word order.
 */
export function joinInReadingOrder(left: string, right: string, sep: string): string {
  if (isRtlPieces([left, right])) {
    let joined = trimEnd(right);
    if (sep !== "" && joined !== "") joined += sep;
    joined += trimStart(left);
    return joined;
  }
  let out = left;
  if (sep !== "" && !out.endsWith(" ")) out += sep;
  return out + right;
}

/** Group indices by canonical rotation, then split 90/270 groups where the y gap is large. */
function rotationGroups(items: readonly ProjectedTextItem[]): number[][] {
  const groupsByRotation = new Map<number, number[]>();
  items.forEach((bbox, idx) => {
    const r = canonicalRotation(bbox.item.rotation);
    const g = groupsByRotation.get(r);
    if (g) g.push(idx);
    else groupsByRotation.set(r, [idx]);
  });

  // For 90/270 groups, further split into spatially distinct clusters by y proximity.
  // This prevents e.g. top and bottom pin labels from being merged into one group.
  const bboxGroups: number[][] = [];
  // Rust iterates a HashMap here; the sort below has a total order (its last key is the unique
  // first index of each group), so the visiting order does not reach the output.
  for (const [rot, group] of groupsByRotation) {
    group.sort((a, b) => totalCmp(items[a].item.y, items[b].item.y));
    if ((rot === 90 || rot === 270) && group.length > 1) {
      let maxH = 0;
      for (const idx of group) maxH = Math.max(maxH, items[idx].item.height);
      const gapThreshold = f32(maxH * 3);
      let cluster: number[] = [group[0]];
      for (let i = 1; i < group.length; i++) {
        const prev = items[group[i - 1]].item;
        const prevBottom = f32(prev.y + prev.height);
        const curTop = items[group[i]].item.y;
        if (f32(curTop - prevBottom) > gapThreshold) {
          bboxGroups.push(cluster);
          cluster = [];
        }
        cluster.push(group[i]);
      }
      if (cluster.length > 0) bboxGroups.push(cluster);
    } else {
      bboxGroups.push(group);
    }
  }

  for (const group of bboxGroups) {
    group.sort((a, b) => totalCmp(items[a].item.y, items[b].item.y));
  }

  const minX = (g: readonly number[]): number =>
    g.reduce((acc, idx) => Math.min(acc, items[idx].item.x), Infinity);
  // Groups are already y-sorted. Break x ties by their topmost item,
  // then by that item's input index for coincident groups.
  bboxGroups.sort(
    (a, b) =>
      totalCmp(minX(a), minX(b)) || totalCmp(items[a[0]].item.y, items[b[0]].item.y) || a[0] - b[0]
  );
  return bboxGroups;
}

/**
 * Whether some item of another rotation lies near `group`: rotated labels in
 * diagrams (pin diagrams) that are close to but do not strictly overlap
 * non-rotated items stay inline.
 */
function groupOverlapsOthers(
  items: readonly ProjectedTextItem[],
  group: readonly number[],
  groupRotation: number
): boolean {
  for (let otherIdx = 0; otherIdx < items.length; otherIdx++) {
    const o = items[otherIdx].item;
    if (canonicalRotation(o.rotation) === groupRotation) continue;
    for (const gi of group) {
      if (gi === otherIdx) continue;
      const b = items[gi].item;
      // Proximity margin: use the max height of both items
      const margin = Math.max(b.height, o.height);
      // Proper range overlap with margin on y-axis
      const xOverlap = b.x < f32(o.x + o.width) && f32(b.x + b.width) > o.x;
      const yOverlap =
        b.y < f32(f32(o.y + o.height) + margin) && f32(f32(b.y + b.height) + margin) > o.y;
      if (xOverlap && yOverlap) return true;
    }
  }
  return false;
}

/** Keep a rotated group inline: put it on the page's own lines, unrotated. */
function placeGroupInline(
  items: ProjectedTextItem[],
  group: readonly number[],
  groupRotation: number
): void {
  // For 90/270 groups kept inline, compute a common y from the
  // group's average vertical midpoint so all labels land on one row.
  // Keep original w/h to preserve x-spacing between labels.
  let commonY = 0;
  let avgW = 0;
  const count = group.length;
  if (groupRotation === 90 || groupRotation === 270) {
    const avgCy = f32(
      sumF32(group.map((idx) => f32(items[idx].item.y + f32(items[idx].item.height / 2)))) / count
    );
    avgW = f32(sumF32(group.map((idx) => items[idx].item.width)) / count);
    commonY = f32(avgCy - f32(avgW / 2));
  }
  for (const idx of group) {
    const p = items[idx];
    if (p.d !== 0) {
      p.item.y = f32(p.item.y + p.d);
      p.d = 0;
    }
    if (groupRotation === 90 || groupRotation === 270) {
      p.item.y = commonY;
      p.item.height = avgW;
    }
    p.item.rotation = 0;
    p.rotated = true;
  }
}

/** Stack a rotated group as its own block, below the groups before it and pushing later ones down. */
function stackGroupAsBlock(
  items: ProjectedTextItem[],
  bboxGroups: readonly number[][],
  groupIdx: number,
  groupRotation: number,
  pageHeight: number
): void {
  const group = bboxGroups[groupIdx];
  const maxOf = (g: readonly number[], f: (p: ProjectedTextItem) => number): number =>
    g.reduce((acc, idx) => Math.max(acc, f(items[idx])), -Infinity);
  const groupMaxX = maxOf(group, (p) => f32(p.item.x + p.item.width));

  let deltaY = 0;
  if (groupIdx !== 0) {
    const previousMaxY = maxOf(bboxGroups[groupIdx - 1], (p) => f32(p.item.y + p.item.height));
    deltaY = f32(previousMaxY + pageHeight);
  }

  if (groupRotation === 90) {
    for (const idx of group) {
      const it = items[idx].item;
      const newX = roundF32(it.y);
      const newY = f32(it.x + deltaY);
      const newW = it.height;
      const newH = it.width;
      it.x = newX;
      it.y = newY;
      it.width = newW;
      it.height = newH;
      it.rotation = 0;
      items[idx].rotated = true;
    }
  }

  if (groupRotation === 270) {
    const maxY = maxOf(group, (p) => f32(p.item.y + p.item.height));
    for (const idx of group) {
      const it = items[idx].item;
      const newX = roundF32(f32(f32(maxY - it.y) - it.height));
      const newY = f32(it.x + deltaY);
      const newW = it.height;
      const newH = it.width;
      it.x = newX;
      it.y = newY;
      it.width = newW;
      it.height = newH;
      it.rotation = 0;
      items[idx].rotated = true;
    }
  }

  // Push later groups just below the block. `delta_y` already includes
  // earlier pushes, so pushing by the block's absolute bottom compounds them.
  const blockBottom = f32(deltaY + groupMaxX);
  let laterTop = Infinity;
  for (let g = groupIdx + 1; g < bboxGroups.length; g++) {
    for (const idx of bboxGroups[g]) {
      laterTop = Math.min(laterTop, f32(items[idx].item.y + items[idx].d));
    }
  }
  const globalDelta = Number.isFinite(laterTop)
    ? Math.max(f32(f32(blockBottom + pageHeight) - laterTop), 0)
    : 0;
  for (let g = groupIdx + 1; g < bboxGroups.length; g++) {
    for (const idx of bboxGroups[g]) {
      const rot = canonicalRotation(items[idx].item.rotation);
      if (rot === 90 || rot === 270) items[idx].d = f32(items[idx].d + globalDelta);
      else items[idx].item.y = f32(items[idx].item.y + globalDelta);
    }
  }
}

/** Rewrite rotated items into an unrotated reading order; sorts `items` by y. */
export function handleRotationReadingOrder(items: ProjectedTextItem[], pageHeight: number): void {
  if (!items.some((b) => canonicalRotation(b.item.rotation) !== 0)) return;

  const bboxGroups = rotationGroups(items);

  for (let groupIdx = 0; groupIdx < bboxGroups.length; groupIdx++) {
    const group = bboxGroups[groupIdx];
    if (group.length === 0) continue;

    const groupRotation = canonicalRotation(items[group[0]].item.rotation);
    if (groupRotation !== 90 && groupRotation !== 270) continue;

    // Long-span guard: a rotated group whose screen-space extent along its
    // reading direction spans a large fraction of the page is almost
    // always sidebar/marginalia (page footers, signature stamps, vertical
    // disclaimers on legal/scanned docs), never an inline label. Force the
    // separate-block branch so it doesn't get flattened onto body lines.
    //
    // For 90/270 text the reading direction is screen-vertical, so the
    // group's vertical screen span is the relevant axis.
    let groupMinY = Infinity;
    let groupMaxY = -Infinity;
    for (const idx of group) {
      groupMinY = Math.min(groupMinY, items[idx].item.y);
      groupMaxY = Math.max(groupMaxY, f32(items[idx].item.y + items[idx].item.height));
    }
    const groupVspan = Math.max(f32(groupMaxY - groupMinY), 0);
    const longSpan = pageHeight > 0 && groupVspan > f32(pageHeight * f32(0.4));

    const globalOverlap = groupOverlapsOthers(items, group, groupRotation);
    if (globalOverlap && !longSpan) {
      placeGroupInline(items, group, groupRotation);
    } else {
      stackGroupAsBlock(items, bboxGroups, groupIdx, groupRotation, pageHeight);
    }
  }

  // Handle 180-degree rotation conservatively.
  // Unlike TS, we don't have extractor-provided rx/ry fields, so normalize to unrotated
  // and preserve local ordering by x.
  for (const group of bboxGroups) {
    if (group.length === 0) continue;
    if (canonicalRotation(items[group[0]].item.rotation) === 180) {
      // The Rust sorts the group by x first, but visits each index only to set the same two
      // fields, so the visiting order does not reach the output.
      for (const idx of group) {
        items[idx].item.rotation = 0;
        items[idx].rotated = true;
      }
    }
  }

  items.sort((a, b) => totalCmp(a.item.y, b.item.y));
}
