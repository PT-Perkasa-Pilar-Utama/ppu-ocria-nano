// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): dedup_overlapping_items.

import { f32, remEuclid, trim } from "../../ocria/rust.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import { asI32 } from "../util.js";

/** Dedup spatial-grid cell size bounds (pt): the cell tracks the typical item footprint so a cell holds few items. */
const DEDUP_MIN_CELL_SIZE = 8;
const DEDUP_MAX_CELL_SIZE = 256;
/** Items spanning more grid cells than this (full-page watermarks, row-spanning leaders) skip the grid. */
const DEDUP_MAX_CELLS_PER_ITEM = 64;

const LEADER_CHARS = new Set([".", "_", "·", "…"]);

/** `str::split_whitespace().join(" ")`. */
function collapseWhitespace(s: string): string {
  return s
    .split(/\p{White_Space}+/u)
    .filter((w) => w !== "")
    .join(" ");
}

/** `strip_leader_runs`: `t` with every run of 4+ leader characters (spaces allowed between) removed and whitespace collapsed. */
export function stripLeaderRuns(t: string): string {
  const chars = Array.from(t);
  if (!chars.some((c) => LEADER_CHARS.has(c))) return t;
  let out = "";
  let i = 0;
  while (i < chars.length) {
    if (LEADER_CHARS.has(chars[i])) {
      let j = i;
      let n = 0;
      while (j < chars.length && (LEADER_CHARS.has(chars[j]) || chars[j] === " ")) {
        if (LEADER_CHARS.has(chars[j])) n++;
        j++;
      }
      if (n >= 4) {
        out += " ";
        i = j;
        continue;
      }
    }
    out += chars[i];
    i++;
  }
  const collapsed = collapseWhitespace(out);
  return collapsed === collapseWhitespace(t) ? t : collapsed;
}

/** `is_diagonal_rotation`: more than 2 degrees off the nearest right angle (0/90/180/270). */
export function isDiagonalRotation(rotation: number): boolean {
  const nearest = f32(roundAwayF32(f32(rotation / 90)) * 90);
  return Math.abs(f32(rotation - nearest)) > 2;
}

function roundAwayF32(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/**
 * `dedup_same_line`: true when two items print on the same line. Overpainted layers share a
 * baseline; adjacent lines 10pt apart must never dedupe even when a pathological loose box makes
 * them overlap.
 */
export function dedupSameLine(a: TextItem, b: TextItem): boolean {
  const orientation = (rotation: number): boolean | null => {
    const norm = f32(remEuclid(rotation, 360));
    const distTo = (target: number): number => {
      const d = Math.abs(f32(norm - target));
      return Math.min(d, f32(360 - d));
    };
    const dHoriz = Math.min(distTo(0), distTo(180));
    const dVert = Math.min(distTo(90), distTo(270));
    if (dHoriz <= 45 && dHoriz <= dVert) return true;
    if (dVert < 45) return false;
    return null;
  };
  const oa = orientation(a.rotation);
  const ob = orientation(b.rotation);
  if (oa === true && ob === true) {
    const smaller = Math.min(Math.abs(a.height), Math.abs(b.height));
    if (!(smaller > 0)) return true;
    const ca = f32(a.y + f32(a.height / 2));
    const cb = f32(b.y + f32(b.height / 2));
    return Math.abs(f32(ca - cb)) <= f32(0.5 * smaller);
  }
  if (oa === false && ob === false) {
    const smaller = Math.min(Math.abs(a.width), Math.abs(b.width));
    if (!(smaller > 0)) return true;
    const ca = f32(a.x + f32(a.width / 2));
    const cb = f32(b.x + f32(b.width / 2));
    return Math.abs(f32(ca - cb)) <= f32(0.5 * smaller);
  }
  // Mixed orientations overlapping heavily is not an overpaint layer; unknown orientation fails open.
  if (oa !== null && ob !== null) return false;
  return true;
}

/** `dedup_pair_drops_earlier`: should the earlier item `a` be dropped in favor of the later item `b` (later = painted on top)? */
function pairDropsEarlier(a: TextItem, b: TextItem): boolean {
  const ixLeft = Math.max(a.x, b.x);
  const ixRight = Math.min(f32(a.x + a.width), f32(b.x + b.width));
  const iyTop = Math.max(a.y, b.y);
  const iyBottom = Math.min(f32(a.y + a.height), f32(b.y + b.height));
  if (ixLeft >= ixRight || iyTop >= iyBottom) return false;

  const intersection = f32(f32(ixRight - ixLeft) * f32(iyBottom - iyTop));
  const areaA = f32(a.width * a.height);
  const areaB = f32(b.width * b.height);
  const smallerArea = Math.min(areaA, areaB);
  // Strong overlap: more than half of the smaller item is covered.
  if (!(smallerArea > 0 && f32(intersection / smallerArea) > 0.5)) return false;

  // Different lines never dedupe, but only when the pair shows the tall-box signature (one box
  // several times the height of the other).
  const ha = Math.max(Math.abs(a.height), f32(1e-6));
  const hb = Math.max(Math.abs(b.height), f32(1e-6));
  if (Math.max(ha, hb) > f32(2.5 * Math.min(ha, hb)) && !dedupSameLine(a, b)) return false;

  if (a.text === b.text) return true;

  // Dotted leaders are decoration, not a text layer: only items that still match once the leaders
  // are gone are the same content.
  const sa = stripLeaderRuns(a.text);
  const sb = stripLeaderRuns(b.text);
  if ((sa !== a.text || sb !== b.text) && sa !== sb) return false;

  // Different text but strong overlap: likely overpainted text layers; keep the later one. Skip
  // when sizes differ wildly (area ratio over 5x): a small cell value inside a row-spanning leader is separate content.
  const largerArea = Math.max(areaA, areaB);
  if (f32(largerArea / smallerArea) > 5) return false;
  return true;
}

/** A text item made only of leader runs. */
function isPureLeader(it: TextItem): boolean {
  return trim(it.text) !== "" && stripLeaderRuns(it.text) === "";
}

/** Is the pure leader `l` painted under the non-leader item `c`: same line, more than half of the smaller box shared? */
function leaderCovered(l: TextItem, c: TextItem): boolean {
  if (isPureLeader(c) || trim(c.text) === "" || !dedupSameLine(l, c)) return false;
  const w = f32(Math.min(f32(l.x + l.width), f32(c.x + c.width)) - Math.max(l.x, c.x));
  const h = f32(Math.min(f32(l.y + l.height), f32(c.y + c.height)) - Math.max(l.y, c.y));
  const smaller = Math.min(f32(l.width * l.height), f32(c.width * c.height));
  return w > 0 && h > 0 && smaller > 0 && f32(f32(w * h) / smaller) > 0.5;
}

type CellRange = [number, number, number, number];

/**
 * Remove items an overlapping later item duplicates or overpaints. An item is dropped iff some
 * later item passes `pairDropsEarlier`: drops only ever hit the earlier item of a pair, so the
 * result is independent of comparison order and a uniform spatial grid can find the candidates.
 * Diagonal text never participates: its loose axis-aligned box is far larger than the ink.
 */
export function dedupOverlappingItems(items: TextItem[]): TextItem[] {
  if (items.length < 2) return items;
  const upright: number[] = [];
  items.forEach((it, i) => {
    if (!isDiagonalRotation(it.rotation)) upright.push(i);
  });
  if (upright.length < 2) return items;

  let sumW = 0;
  let sumH = 0;
  for (const i of upright) {
    sumW += Math.max(items[i].width, 0);
    sumH += Math.max(items[i].height, 0);
  }
  const avgDim = f32((sumW + sumH) / (2 * upright.length));
  const cell = Math.min(Math.max(avgDim, DEDUP_MIN_CELL_SIZE), DEDUP_MAX_CELL_SIZE);
  const cellRange = (it: TextItem): CellRange => [
    asI32(Math.floor(f32(it.x / cell))),
    asI32(Math.floor(f32(f32(it.x + it.width) / cell))),
    asI32(Math.floor(f32(it.y / cell))),
    asI32(Math.floor(f32(f32(it.y + it.height) / cell))),
  ];
  const cellCount = ([cx0, cx1, cy0, cy1]: CellRange): number => (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

  const grid = new Map<string, number[]>();
  const oversized: number[] = [];
  for (const idx of upright) {
    const range = cellRange(items[idx]);
    if (cellCount(range) > DEDUP_MAX_CELLS_PER_ITEM) {
      oversized.push(idx);
      continue;
    }
    const [cx0, cx1, cy0, cy1] = range;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(idx);
        else grid.set(key, [idx]);
      }
    }
  }

  const keep = items.map(() => true);
  // Generation stamps so a candidate sharing several cells with the current item is tested once.
  const lastSeen = items.map(() => -1);
  upright.forEach((i, generation) => {
    lastSeen[i] = generation;
    // Returns true when `i` is dropped, ending its search.
    const check = (j: number): boolean => {
      if (j <= i || lastSeen[j] === generation) return false;
      lastSeen[j] = generation;
      if (pairDropsEarlier(items[i], items[j])) {
        keep[i] = false;
        return true;
      }
      return false;
    };
    const range = cellRange(items[i]);
    if (cellCount(range) <= DEDUP_MAX_CELLS_PER_ITEM) {
      const [cx0, cx1, cy0, cy1] = range;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          for (const j of grid.get(`${cx},${cy}`) ?? []) if (check(j)) return;
        }
      }
      for (const j of oversized) if (check(j)) return;
    } else {
      for (const j of upright) if (check(j)) return;
    }
  });

  // A dot run painted under a label or value on its line is decoration; the content stays.
  for (const l of upright) {
    if (!keep[l] || !isPureLeader(items[l])) continue;
    const covers = (c: number): boolean => c !== l && leaderCovered(items[l], items[c]);
    const range = cellRange(items[l]);
    let covered = false;
    if (cellCount(range) <= DEDUP_MAX_CELLS_PER_ITEM) {
      const [cx0, cx1, cy0, cy1] = range;
      for (let cx = cx0; cx <= cx1 && !covered; cx++) {
        for (let cy = cy0; cy <= cy1 && !covered; cy++) {
          covered = (grid.get(`${cx},${cy}`) ?? []).some(covers);
        }
      }
      covered ||= oversized.some(covers);
    } else {
      covered = upright.some(covers);
    }
    if (covered) keep[l] = false;
  }
  return items.filter((_, i) => keep[i]);
}
