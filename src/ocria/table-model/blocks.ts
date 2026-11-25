// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs (crates-v2.21.2, Apache-2.0): layout blocks from same_block.

import { f32, isWhitespace } from "../rust.js";
import { totalCmp } from "../rust.js";
import { avgLink } from "./decode-link.js";
import type { Logits } from "./net.js";
import type { Unit } from "./units.js";

/**
 * A block's units split into its lines' runs: a new part starts where the vertical gap to the
 * next line is more than the block's median line height (a paragraph break; leading alone is a
 * fraction of it), or where the lines change between heading-like (the class head's Heading +
 * Title share over half, by characters) and body text, since the same_block head often joins
 * a heading to the paragraph under it.
 */
export function splitParagraphs(
  g: readonly number[],
  units: readonly Unit[],
  cls: Float32Array,
  c: number
): number[][] {
  if (g.length < 2 || c < 3) return [[...g]];
  const byY = [...g].sort((a, b) => {
    const [pa, pb] = [units[a].pbox, units[b].pbox];
    return totalCmp((pa[1] + pa[3]) / 2, (pb[1] + pb[3]) / 2);
  });
  // lines: units overlapping the current line by more than half the smaller height
  const lines: Array<[number, number, number[]]> = [];
  for (const i of byY) {
    const p = units[i].pbox;
    const l = lines.at(-1);
    if (
      l !== undefined &&
      Math.min(l[1], p[3]) - Math.max(l[0], p[1]) > 0.5 * Math.min(l[1] - l[0], p[3] - p[1])
    ) {
      l[0] = Math.min(l[0], p[1]);
      l[1] = Math.max(l[1], p[3]);
      l[2].push(i);
    } else {
      lines.push([p[1], p[3], [i]]);
    }
  }
  if (lines.length < 2) return [[...g]];
  const hs = lines.map((l) => l[1] - l[0]).sort(totalCmp);
  const lineH = Math.max(hs[Math.floor(hs.length / 2)], 1);
  const headingish = (l: readonly number[]): boolean => {
    let head = 0;
    let all = 0;
    for (const i of l) {
      const row = cls.subarray(i * c, (i + 1) * c);
      const m = row.reduce((a, b) => Math.max(a, b), -Infinity);
      const e = Array.from(row, (v) => f32(Math.exp(f32(v - m))));
      let z = 0;
      for (const x of e) z = f32(z + x);
      let count = 0;
      for (const ch of units[i].text) {
        if (!isWhitespace(ch)) count += 1;
      }
      const n = Math.max(count, 1);
      head = f32(head + f32(f32(n * f32(e[1] + e[2])) / z));
      all = f32(all + n);
    }
    return f32(head * 2) > all;
  };
  const parts: number[][] = [[...lines[0][2]]];
  for (let k = 1; k < lines.length; k++) {
    const gap = lines[k][0] - lines[k - 1][1];
    if (gap > lineH || headingish(lines[k][2]) !== headingish(lines[k - 1][2])) parts.push([]);
    parts[parts.length - 1].push(...lines[k][2]);
  }
  return parts;
}

/**
 * A block's units split where their horizontal extents leave a gap wider than the units' median
 * height (about three word spaces), keeping the original order inside each part.
 */
export function splitAtGaps(g: readonly number[], units: readonly Unit[]): number[][] {
  const hs = g.map((i) => units[i].pbox[3] - units[i].pbox[1]).sort(totalCmp);
  const gap = Math.max(hs[Math.floor(hs.length / 2)] ?? 0, 1);
  const byX = [...g].sort((a, b) => totalCmp(units[a].pbox[0], units[b].pbox[0]));
  const parts: number[][] = [];
  let right = -Infinity;
  for (const i of byX) {
    const p = units[i].pbox;
    if (parts.length === 0 || p[0] - right > gap) parts.push([]);
    parts[parts.length - 1].push(i);
    right = Math.max(right, p[2]);
  }
  return parts;
}

function root(p: number[], k: number): number {
  while (p[k] !== k) {
    p[k] = p[p[k]];
    k = p[k];
  }
  return k;
}

/**
 * Units grouped into blocks from same_block logits: connected components of positive links,
 * then average linkage inside each component (average linkage over a whole dense page is
 * O(n^3); its components are small).
 */
export function blockGroups(l: Logits, keep: readonly number[]): number[][] {
  const n = l.n;
  const m = keep.length;
  const parent = keep.map((_, i) => i);
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      if (l.pair[(4 * n + keep[a]) * n + keep[b]] > 0) {
        const ra = root(parent, a);
        const rb = root(parent, b);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  // a BTreeMap: components in order of their root
  const comps = new Map<number, number[]>();
  for (let a = 0; a < m; a++) {
    const r = root(parent, a);
    const c = comps.get(r);
    if (c) c.push(a);
    else comps.set(r, [a]);
  }
  const out: number[][] = [];
  for (const r of [...comps.keys()].sort((a, b) => a - b)) {
    const c = comps.get(r) ?? [];
    const k = c.length;
    const p = new Float64Array(k * k);
    for (let x = 0; x < k; x++) {
      for (let y = 0; y < k; y++) p[x * k + y] = l.pair[(4 * n + keep[c[x]]) * n + keep[c[y]]];
    }
    for (const g of avgLink(p, k, 0)) out.push(g.map((x) => keep[c[x]]));
  }
  return out;
}

/** `(0..v.len()).max_by(|a, b| v[a].total_cmp(&v[b]))`: the index of the largest, the last of equal maxima; null when empty. */
export function maxByLast(v: readonly number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < v.length; i++) {
    if (best === null || totalCmp(v[i], v[best]) >= 0) best = i;
  }
  return best;
}
