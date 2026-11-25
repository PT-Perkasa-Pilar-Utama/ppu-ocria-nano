// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): column anchors.

import { roundF32 } from "../rust-extra.js";
import { asInt, f32, totalCmp } from "../rust.js";
import type { AnchorMap, ProjectedTextItem } from "./types.js";
import type { TextItem } from "../types/text-item.js";

/** Lines `start..end` of a page's line list. */
export type LineRange = { start: number; end: number };

/** Anchor key: x in quarter points. */
export function anchorKey(x: number): number {
  return asInt(roundF32(f32(x * 4)));
}

export function anchorToX(key: number): number {
  return f32(key / 4);
}

/** A `(line index, item index)` pair as one Set key. */
export function pairKey(li: number, bi: number): number {
  return li * 4294967296 + bi;
}

/**
 * Page-scoped forward anchors: the rendered column each anchor key has
 * reached. Rust keeps a `BTreeMap<i32, usize>`; it is only read through `get`,
 * `entry` and "max over keys up to x", so a `Map` gives the same results.
 */
export class ForwardAnchors {
  private readonly map = new Map<number, number>();

  get(key: number): number | undefined {
    return this.map.get(key);
  }

  set(key: number, value: number): void {
    this.map.set(key, value);
  }

  /** `entry(key).or_insert(0)`, then raise the value to `target` when it is larger. */
  raise(key: number, target: number): void {
    const cur = this.map.get(key) ?? 0;
    this.map.set(key, target > cur ? target : cur);
  }

  /** `range(..=key).map(value).max().unwrap_or(0)`. */
  maxUpTo(key: number): number {
    let best = 0;
    for (const [k, v] of this.map) if (k <= key && v > best) best = v;
    return best;
  }
}

const MERGE_TOLERANCE = 8; // 2 units in quarter-point anchor key space

export function mergeNearbyAnchorGroups(collection: AnchorMap): void {
  const sortedKeys = [...collection.keys()].sort((a, b) => a - b);

  for (let i = 0; i < sortedKeys.length; i++) {
    const anchor = sortedKeys[i];
    if (!collection.has(anchor)) continue;
    for (let n = i + 1; n < sortedKeys.length; n++) {
      const nextAnchor = sortedKeys[n];
      if (!collection.has(nextAnchor)) continue;
      if (nextAnchor - anchor > MERGE_TOLERANCE) break;

      const cur = collection.get(anchor) ?? [];
      const next = collection.get(nextAnchor) ?? [];
      if (next.length > cur.length) {
        collection.delete(anchor);
        for (const m of cur) next.push(m);
        break;
      }
      collection.delete(nextAnchor);
      for (const m of next) cur.push(m);
    }
  }
}

/** Anchor maps for one block of lines, with absolute line indices: `[left, right, center]`. */
export function extractBlockAnchors(
  lines: ReadonlyArray<readonly ProjectedTextItem[]>,
  block: LineRange
): [AnchorMap, AnchorMap, AnchorMap] {
  const left: AnchorMap = new Map();
  const right: AnchorMap = new Map();
  const center: AnchorMap = new Map();
  const add = (m: AnchorMap, key: number, li: number, bi: number): void => {
    const g = m.get(key);
    if (g) g.push([li, bi]);
    else m.set(key, [[li, bi]]);
  };

  for (let li = block.start; li < Math.min(block.end, lines.length); li++) {
    lines[li].forEach((bbox, bi) => {
      // Skip rotated items from anchor detection: their coordinates are
      // transformed and would create spurious column anchors that stretch
      // the layout. They'll render as floating items at their natural positions.
      if (bbox.rotated) return;
      const { x, width } = bbox.item;
      add(left, anchorKey(x), li, bi);
      add(right, anchorKey(f32(x + width)), li, bi);
      add(center, anchorKey(f32(x + f32(width * 0.5))), li, bi);
    });
  }
  return [left, right, center];
}

/**
 * Remove vertically isolated items from anchor groups. Items must have a
 * neighbor within `page_height * delta` to survive.
 */
export function deltaMinFilter(
  collection: AnchorMap,
  lines: ReadonlyArray<readonly ProjectedTextItem[]>,
  pageHeight: number,
  delta: number
): void {
  const maxDelta = f32(pageHeight * delta);
  const yOf = (m: [number, number]): number => lines[m[0]][m[1]].item.y;

  for (const [key, members] of collection) {
    members.sort((a, b) => totalCmp(yOf(a), yOf(b)));

    const keep: boolean[] = members.map(() => false);
    for (let i = 0; i < members.length; i++) {
      const yCur = yOf(members[i]);
      if (i > 0) {
        const yPrev = yOf(members[i - 1]);
        if (f32(yCur - yPrev) < maxDelta) {
          keep[i] = true;
          keep[i - 1] = true;
        }
      }
      if (i + 1 < members.length) {
        const yNext = yOf(members[i + 1]);
        if (f32(yNext - yCur) < maxDelta) keep[i] = true;
      }
    }
    const kept = members.filter((_, idx) => keep[idx]);
    if (kept.length === 0) collection.delete(key);
    else collection.set(key, kept);
  }
}

/**
 * Remove anchors where text from other items visually crosses the anchor
 * x-position between every consecutive pair of anchor members.
 */
export function interceptFilter(
  collection: AnchorMap,
  lines: ReadonlyArray<readonly ProjectedTextItem[]>
): void {
  const toRemove: number[] = [];
  for (const [key, members] of collection) {
    if (members.length < 2) continue;
    const anchorX = anchorToX(key);
    let anyPairClear = false;

    for (let i = 1; i < members.length; i++) {
      const y1 = lines[members[i - 1][0]][members[i - 1][1]].item.y;
      const y2 = lines[members[i][0]][members[i][1]].item.y;
      const [yMin, yMax] = y1 < y2 ? [y1, y2] : [y2, y1];

      let intercepted = false;
      for (const line of lines) {
        if (line.length === 0) continue;
        const lineY = line[0].item.y;
        if (lineY > yMin && lineY < yMax) {
          for (const it of line) {
            if (it.item.x < anchorX && f32(it.item.x + it.item.width) > anchorX) {
              intercepted = true;
              break;
            }
          }
          if (intercepted) break;
        }
      }

      if (!intercepted) {
        anyPairClear = true;
        break;
      }
    }
    if (!anyPairClear) toRemove.push(key);
  }
  for (const key of toRemove) collection.delete(key);
}

/**
 * Try to align floating bboxes (not in any surviving anchor) to nearby anchors
 * on adjacent lines within the given margin.
 */
export function tryAlignFloating(
  target: AnchorMap,
  lines: ReadonlyArray<readonly ProjectedTextItem[]>,
  block: LineRange,
  anchored: ReadonlySet<number>,
  margin: number,
  refXFn: (item: TextItem) => number,
  anchorKeyFn: (item: TextItem) => number
): void {
  const additions: Array<[number, [number, number]]> = [];

  for (let lineIdx = block.start; lineIdx < block.end; lineIdx++) {
    for (let boxIdx = 0; boxIdx < lines[lineIdx].length; boxIdx++) {
      if (anchored.has(pairKey(lineIdx, boxIdx))) continue;
      // Skip rotated items: they are excluded from anchor extraction
      // and should remain floating to avoid spurious snap assignments.
      if (lines[lineIdx][boxIdx].rotated) continue;

      const refX = refXFn(lines[lineIdx][boxIdx].item);

      // Check adjacent lines for candidate anchors
      let candidate: number | null = null;
      let prevDiff = f32(margin + 1);

      const adjLines: number[] = [];
      if (lineIdx > block.start) adjLines.push(lineIdx - 1);
      if (lineIdx + 1 < block.end) adjLines.push(lineIdx + 1);

      for (const adj of adjLines) {
        for (const adjBox of lines[adj]) {
          const candKey = anchorKeyFn(adjBox.item);
          if (!target.has(candKey)) continue;
          const xDiff = Math.abs(f32(anchorToX(candKey) - refX));
          if (xDiff <= margin && xDiff < prevDiff) {
            candidate = candKey;
            prevDiff = xDiff;
          }
        }
      }

      if (candidate !== null) additions.push([candidate, [lineIdx, boxIdx]]);
    }
  }

  // Apply additions after iteration, as the Rust does to avoid borrow conflicts.
  for (const [key, item] of additions) {
    const members = target.get(key);
    if (members && !members.some((m) => m[0] === item[0] && m[1] === item[1])) members.push(item);
  }
}

const POSITION_TOLERANCE = 8; // 2 units in quarter-point anchor key space

export function updateForwardAnchorRightBound(
  snapMap: readonly number[],
  forwardAnchor: ForwardAnchors,
  rightBound: number,
  anchorTarget: number
): void {
  for (let idx = snapMap.length - 1; idx >= 0; idx--) {
    const anchor = snapMap[idx];
    if (anchor < rightBound) return;

    forwardAnchor.raise(anchor, anchorTarget);

    let j = idx;
    while (j > 0) {
      const nearby = snapMap[j - 1];
      if (anchor - nearby > POSITION_TOLERANCE) break;
      forwardAnchor.raise(nearby, anchorTarget);
      j--;
    }
  }
}
