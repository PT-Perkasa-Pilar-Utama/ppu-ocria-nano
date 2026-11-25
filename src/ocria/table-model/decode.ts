// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/decode.rs (crates-v2.21.2, Apache-2.0): decoding unit groups into tables.

// `decodeTables`: unit groups from in_table + same_table (average linkage), then absorption of
// stacked pieces, small groups and stray units inside a table's box, then growth over a header
// band. Order-sensitive steps (argmax ties, stable sorts, insertion order) follow the Python
// exactly, so parity fixtures compare byte for byte.

import { chars, f32, isAlphanumeric, trimEnd, trimStart } from "../rust.js";
import { splitWhitespace } from "../rust-extra.js";
import { avgLink, median } from "./decode-link.js";
import type { Logits } from "./net.js";
import { logitNode, logitPair } from "./net.js";
import type { Box4 } from "./units.js";

/** A text unit as the decoder sees it: box in the text's reading frame (points, top-left origin). */
export type DUnit = { bx: Box4; text: string; h: number };

export const CELL_MARGIN: number = f32(1.5);
export const STACK_GAP = 0.8;
export const STACK_GAP_HDR = 0.8;
export const GATE = 3;

/** Decoder switches (options of the reference decoder; these are the shipped defaults). */
export type DecodeOptions = {
  table_thresh: number;
  head_band: boolean;
  forced_link: boolean;
  squeeze: boolean;
  /** Fold wrapped-cell continuation rows into the row above (Rust-only; not in tn_core). */
  fold_wraps: boolean;
};

/** `DecodeOptions::default()`. */
export function defaultDecodeOptions(): DecodeOptions {
  return { table_thresh: 0, head_band: true, forced_link: true, squeeze: true, fold_wraps: true };
}

/** Median unit height, or 1 when it is 0 (`float(np.median(...)) or 1.0`). */
export function medianH(units: readonly DUnit[], idx: Iterable<number>): number {
  const hs = Array.from(idx, (i) => units[i].h);
  const m = median(hs);
  return m === 0 || Number.isNaN(m) ? 1 : m;
}

export function bboxOf(units: readonly DUnit[], g: readonly number[]): Box4 {
  const b: Box4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of g) {
    const u = units[i].bx;
    b[0] = Math.min(b[0], u[0]);
    b[1] = Math.min(b[1], u[1]);
    b[2] = Math.max(b[2], u[2]);
    b[3] = Math.max(b[3], u[3]);
  }
  return b;
}

const CAPTION_WORDS = ["table", "tab.", "figure", "fig.", "exhibit", "chart", "source", "note"];

/**
 * `re.match(r"^\s*(table|tab\.|figure|fig\.|exhibit|chart|source|note)s?\b", t, re.I)`: the
 * alternatives in order, the optional "s" tried first (greedy), then a word boundary.
 */
export function isCaption(text: string): boolean {
  const t = chars(trimStart(text).toLowerCase());
  const word = (c: string): boolean => isAlphanumeric(c) || c === "_";
  const boundary = (pos: number): boolean => {
    const prev = pos > 0 ? word(t[pos - 1]) : false;
    const next = pos < t.length ? word(t[pos]) : false;
    return prev !== next;
  };
  for (const w of CAPTION_WORDS) {
    const wc = chars(w);
    if (t.length < wc.length || !wc.every((c, i) => t[i] === c)) continue;
    const end = wc.length;
    if (t[end] === "s" && boundary(end + 1)) return true;
    if (boundary(end)) return true;
  }
  return false;
}

/** The units above a table that could be its header line, as `head_band` selects them. */
function headLine(
  units: readonly DUnit[],
  l: Logits,
  g: readonly number[],
  taken: readonly boolean[],
  hm: number
): number[] | null {
  const b = bboxOf(units, g);
  const [x0, y0, x1] = b;
  const above: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i].bx;
    if (!taken[i] && logitNode(l, i, 0) > -8 && u[3] <= y0 + 0.2 * hm && y0 - u[3] < 4 * 1.4 * hm) {
      above.push(i);
    }
  }
  if (above.length === 0) return null;
  // the nearest line above: units overlapping vertically with the lowest one (max()'s first)
  let low = above[0];
  for (const i of above.slice(1)) {
    if (units[i].bx[3] > units[low].bx[3]) low = i;
  }
  const lb = units[low].bx;
  const line = above.filter(
    (i) => Math.min(units[i].bx[3], lb[3]) - Math.max(units[i].bx[1], lb[1]) > 0.3 * hm
  );
  const w = x1 - x0;
  let ok = line.every((i) => units[i].bx[0] >= x0 - 0.05 * w && units[i].bx[2] <= x1 + 0.05 * w);
  const near = y0 - line.reduce((m, i) => Math.max(m, units[i].bx[3]), -Infinity) < 1.5 * 1.4 * hm;
  const strong = line.every((i) => logitNode(l, i, 0) > f32(-1.5));
  const over = line.every((i) =>
    g.some(
      (j) => Math.min(units[i].bx[2], units[j].bx[2]) - Math.max(units[i].bx[0], units[j].bx[0]) > 0
    )
  );
  ok = ok && (strong || (near && over && line.every((i) => logitNode(l, i, 0) > -4)));
  ok = ok && !line.some((i) => isCaption(units[i].text));
  const hdr = line.filter((i) => logitNode(l, i, 1) > 0).length / Math.max(line.length, 1);
  ok = ok && line.length >= 2 && hdr > 0.5;
  ok =
    ok &&
    !line.some((i) => {
      const t = units[i].text;
      return splitWhitespace(t).length > 6 || trimEnd(t).endsWith(".") || trimEnd(t).endsWith(":");
    });
  return ok ? line : null;
}

/** Grow each table up over its header band (see tn_core._head_band). */
function headBand(units: readonly DUnit[], l: Logits, groups: number[][], taken: boolean[]): void {
  const hm = medianH(units, units.keys());
  for (const g of groups) {
    for (let step = 0; step < 3; step++) {
      const line = headLine(units, l, g, taken, hm);
      if (line === null) break;
      for (const i of line) {
        g.push(i);
        taken[i] = true;
      }
    }
    g.sort((a, b) => a - b);
  }
}

/** Merge stacked pieces that line up across and sit within 3 lines. */
function mergeStacked(units: readonly DUnit[], groups: number[][]): void {
  const hm = medianH(units, units.keys());
  for (;;) {
    const ext = groups.map((g) => bboxOf(units, g));
    let merged: [number, number] | null = null;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = 0; b < groups.length; b++) {
        if (a === b) continue;
        const aa = ext[a];
        const bb = ext[b];
        const gap = bb[1] - aa[3];
        const ov = Math.min(aa[2], bb[2]) - Math.max(aa[0], bb[0]);
        if (gap >= 0 && gap < 3 * 1.4 * hm && ov > 0.7 * Math.min(aa[2] - aa[0], bb[2] - bb[0])) {
          merged = [a, b];
          break outer;
        }
      }
    }
    if (merged === null) break;
    const [a, b] = merged;
    groups[a].push(...groups[b]);
    groups[a].sort((x, y) => x - y);
    groups.splice(b, 1);
  }
}

/** A small group lying mostly inside a bigger table's box (grown by a line) joins it. */
function mergeSmallIntoBig(units: readonly DUnit[], groups: number[][]): void {
  const hm = medianH(units, units.keys());
  for (;;) {
    groups.sort((a, b) => b.length - a.length);
    const ext = groups.map((g): Box4 => {
      const b = bboxOf(units, g);
      return [b[0] - 1.4 * hm, b[1] - 1.4 * hm, b[2] + 1.4 * hm, b[3] + 1.4 * hm];
    });
    let merged: [number, number] | null = null;
    outer: for (let s = groups.length - 1; s >= 1; s--) {
      const sb = bboxOf(units, groups[s]);
      const area = Math.max((sb[2] - sb[0]) * (sb[3] - sb[1]), 1e-6);
      for (let b = 0; b < s; b++) {
        if (groups[s].length > 0.5 * groups[b].length) continue;
        const e = ext[b];
        const ov =
          Math.max(Math.min(sb[2], e[2]) - Math.max(sb[0], e[0]), 0) *
          Math.max(Math.min(sb[3], e[3]) - Math.max(sb[1], e[1]), 0);
        if (ov >= 0.5 * area) {
          merged = [s, b];
          break outer;
        }
      }
    }
    if (merged === null) break;
    const [s, b] = merged;
    groups[b].push(...groups[s]);
    groups[b].sort((x, y) => x - y);
    groups.splice(s, 1);
  }
}

/** Tables as lists of unit indices (tn_core.decode_tables, absorb=True). */
export function decodeTables(units: readonly DUnit[], l: Logits, opt: DecodeOptions): number[][] {
  const n = units.length;
  const on: number[] = [];
  for (let i = 0; i < n; i++) {
    if (logitNode(l, i, 0) > opt.table_thresh) on.push(i);
  }
  if (on.length < 2) return [];
  const m = on.length;
  const p = new Float64Array(m * m);
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) p[a * m + b] = logitPair(l, 0, on[a], on[b]);
  }
  const groups = avgLink(p, m, 0)
    .filter((g) => g.length >= 2)
    .map((g) => g.map((i) => on[i]));
  // stacked pieces that line up across and sit within 3 lines merge back
  if (groups.length > 1) mergeStacked(units, groups);
  if (groups.length > 1) mergeSmallIntoBig(units, groups);
  if (groups.length > 0) {
    const taken = Array.from({ length: n }, () => false);
    for (const g of groups) {
      for (const i of g) taken[i] = true;
    }
    for (const g of groups) {
      const b = bboxOf(units, g);
      for (let i = 0; i < n; i++) {
        if (taken[i] || logitNode(l, i, 0) < -8) continue;
        const u = units[i].bx;
        const cx = (u[0] + u[2]) / 2;
        const cy = (u[1] + u[3]) / 2;
        if (b[0] <= cx && cx <= b[2] && b[1] <= cy && cy <= b[3]) {
          g.push(i);
          taken[i] = true;
        }
      }
      g.sort((a, c) => a - c);
    }
    if (opt.head_band) headBand(units, l, groups, taken);
  }
  return groups;
}
