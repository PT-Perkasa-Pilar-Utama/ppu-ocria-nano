// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/features.rs (crates-v2.21.2, Apache-2.0): ruling-line detection.

import { asUsize, f32 } from "../rust.js";
import { roundF32 } from "../rust-extra.js";
import type { Rules } from "./features.js";

/** Gray threshold below which a pixel is ink. */
const DARK = 170;

/** A run `(start, end inclusive)` of ink along a row or a column. */
type Run = [number, number];

/** `u32::trailing_zeros` for a nonzero value. */
function ctz32(v: number): number {
  return 31 - Math.clz32(v & -v);
}

/**
 * A page's ink mask (grey < DARK) as one bitset per row, so the run scan only visits the pixels
 * where ink starts or stops (pages are mostly paper). The Rust packs 64 pixels to a word; this
 * packs 32, which finds the same runs.
 */
class InkBits {
  readonly words: number;
  readonly bits: Uint32Array;

  constructor(
    gray: Uint8Array,
    readonly w: number,
    readonly h: number
  ) {
    this.words = Math.ceil(w / 32);
    this.bits = new Uint32Array(this.words * h);
    for (let y = 0; y < h; y++) {
      for (let k = 0; k < this.words; k++) {
        let word = 0;
        const end = Math.min(w, (k + 1) * 32);
        for (let x = k * 32; x < end; x++) {
          if (gray[y * w + x] < DARK) word |= 1 << (x - k * 32);
        }
        this.bits[y * this.words + k] = word;
      }
    }
  }

  row(y: number): Uint32Array {
    return this.bits.subarray(y * this.words, (y + 1) * this.words);
  }

  /**
   * Horizontal ink runs per row and vertical ink runs per column, as `(start, end inclusive)`
   * in scan order, keeping those at least 3% of the page side (15 px floor) long.
   */
  runs(): [Run[][], Run[][]] {
    const { w, h, words } = this;
    const lh = Math.max(15, asUsize(f32(w * f32(0.03))));
    const lv = Math.max(15, asUsize(f32(h * f32(0.03))));
    const hruns: Run[][] = Array.from({ length: h }, () => []);
    const vruns: Run[][] = Array.from({ length: w }, () => []);
    // where each column's current vertical run began (valid while its bit was set last row)
    const open = Array.from({ length: w }, () => 0);
    const zero = new Uint32Array(words);
    for (let y = 0; y < h; y++) {
      const cur = this.row(y);
      const prev = y === 0 ? zero : this.row(y - 1);
      // vertical runs start or end where a column's ink differs from the row above
      for (let k = 0; k < words; k++) {
        let changed = (cur[k] ^ prev[k]) >>> 0;
        while (changed !== 0) {
          const x = k * 32 + ctz32(changed);
          changed = (changed & (changed - 1)) >>> 0;
          if (((cur[k] >>> (x % 32)) & 1) === 1) open[x] = y;
          else if (y - open[x] >= lv) vruns[x].push([open[x], y - 1]);
        }
      }
      // horizontal runs: maximal stretches of set bits
      let x = nextBit(cur, 0, w, true);
      while (x < w) {
        const end = nextBit(cur, x, w, false);
        if (end - x >= lh) hruns[y].push([x, end - 1]);
        x = nextBit(cur, end, w, true);
      }
    }
    if (h > 0) {
      const last = this.row(h - 1);
      open.forEach((o, x) => {
        if (((last[x >>> 5] >>> (x % 32)) & 1) === 1 && h - o >= lv) vruns[x].push([o, h - 1]);
      });
    }
    return [hruns, vruns];
  }
}

/** The first position at or after `from` (below `w`) whose bit is `set`; `w` when there is none. */
function nextBit(row: Uint32Array, from: number, w: number, set: boolean): number {
  let k = from >>> 5;
  if (k >= row.length) return w;
  const flip = set ? 0 : -1;
  let word = ((row[k] ^ flip) & (-1 << (from % 32))) >>> 0;
  for (;;) {
    if (word !== 0) return Math.min(k * 32 + ctz32(word), w);
    k += 1;
    if (k >= row.length) return w;
    word = (row[k] ^ flip) >>> 0;
  }
}

function root(p: number[], k: number): number {
  while (p[k] !== k) {
    p[k] = p[p[k]];
    k = p[k];
  }
  return k;
}

/** `(v * 10.0).round() / 10.0` in f32. */
function round1(v: number): number {
  return f32(roundF32(f32(v * 10)) / 10);
}

/**
 * Ruling lines from ink runs: each 8-connected component of runs on adjacent rows (columns) is
 * one rule, unless it is thicker than 2.5 pt.
 */
export function rulesFromRuns([hruns, vruns]: [Run[][], Run[][]], scale: number): Rules {
  const thickMaxPt = f32(2.5);
  const out: Rules = { h: [], v: [] };
  for (const [axis, runs] of [
    [0, hruns],
    [1, vruns],
  ] as const) {
    const linesN = runs.length;
    // 8-connected components over runs of adjacent lines (union-find)
    const ids: Array<[number, number, number]> = []; // (line, start, end)
    const first = Array.from({ length: linesN + 1 }, () => 0);
    runs.forEach((rs, line) => {
      first[line] = ids.length;
      for (const [s, e] of rs) ids.push([line, s, e]);
    });
    first[linesN] = ids.length;
    const parent = ids.map((_, i) => i);
    for (let line = 1; line < linesN; line++) {
      for (let a = first[line - 1]; a < first[line]; a++) {
        for (let b = first[line]; b < first[line + 1]; b++) {
          const [, s0, e0] = ids[a];
          const [, s1, e1] = ids[b];
          if (s1 <= e0 + 1 && e1 + 1 >= s0) {
            const ra = root(parent, a);
            const rb = root(parent, b);
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
    }
    // component extents, in root order (deterministic)
    const comp: Array<[number, number, number, number] | null> = ids.map(() => null);
    for (let k = 0; k < ids.length; k++) {
      const r = root(parent, k);
      const [line, s, e] = ids[k];
      const c = (comp[r] ??= [Infinity, 0, Infinity, 0]);
      c[0] = Math.min(c[0], line);
      c[1] = Math.max(c[1], line);
      c[2] = Math.min(c[2], s);
      c[3] = Math.max(c[3], e);
    }
    for (const c of comp) {
      if (c === null) continue;
      const [l0, l1, s, e] = c;
      const thick = f32(l1 - l0 + 1);
      if (thick > f32(thickMaxPt * scale)) continue;
      const along = f32(e - s + 1);
      const mid = f32(f32(l0 + f32(thick / 2)) / scale);
      const a0 = f32(s / scale);
      const a1 = f32(f32(s + along) / scale);
      const rule: [number, number, number] = [round1(mid), round1(a0), round1(a1)];
      if (axis === 0) out.h.push(rule);
      else out.v.push(rule);
    }
  }
  return out;
}

/**
 * Ruling lines from a grayscale page render (`gray` row-major, `w` x `h` pixels, `scale` pixels per
 * point): dark pixels (< 170) opened with a long thin kernel, so only runs longer than any glyph
 * survive; each 8-connected surviving component is one rule, unless it is thicker than 2.5 pt.
 * An opening with a 1 x L line keeps exactly the ink runs of length >= L along that axis.
 */
export function detectRules(gray: Uint8Array, w: number, h: number, scale: number): Rules {
  const ink = new InkBits(gray, w, h);
  return rulesFromRuns(ink.runs(), scale);
}
