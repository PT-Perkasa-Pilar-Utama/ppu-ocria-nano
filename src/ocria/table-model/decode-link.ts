// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/decode.rs (crates-v2.21.2, Apache-2.0): linkage and reading order.

import type { Box4 } from "./units.js";

/** `median` of decode.rs: NaN for an empty list; sorts `v` in place. */
export function median(v: number[]): number {
  if (v.length === 0) return NaN;
  v.sort((a, b) => a - b);
  const n = v.length;
  if (n % 2 === 1) return v[(n - 1) / 2];
  return (v[n / 2 - 1] + v[n / 2]) / 2;
}

/**
 * Average-linkage clusters of a symmetric n x n matrix: merge while the mean logit > thresh.
 * Groups come back sorted, in the order of their surviving representative.
 *
 * Each merge joins the pair with the highest mean (ties: the first in row-major order of the live
 * groups) and adds the absorbed group's sums into the survivor's row and column. Every live group
 * caches its best partner, so a merge rescans only the rows whose cached partner it touched:
 * O(n^2) on typical pages instead of rescanning every pair per merge (O(n^3); 2 s at 1,000 units).
 */
export function avgLink(p: ArrayLike<number>, n: number, thresh: number): number[][] {
  const groups: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const s = Float64Array.from(p);
  const cnt = new Float64Array(n * n).fill(1);
  const alive: number[] = Array.from({ length: n }, (_, i) => i);
  // best partner of each live group g: (mean, partner), the first maximum in `alive` order
  const rowBest = (g: number): [number, number] => {
    let best: [number, number] = [-Infinity, Number.MAX_SAFE_INTEGER];
    for (const h of alive) {
      if (h !== g) {
        const v = s[g * n + h] / cnt[g * n + h];
        if (v > best[0]) best = [v, h];
      }
    }
    return best;
  };
  const best: Array<[number, number]> = Array.from({ length: n }, (_, g) => rowBest(g));
  while (alive.length > 1) {
    // the first live group (in `alive` order) holding the overall maximum
    let ba = 0;
    for (let a = 1; a < alive.length; a++) {
      if (best[alive[a]][0] > best[alive[ba]][0]) ba = a;
    }
    const [v, gb] = best[alive[ba]];
    if (v <= thresh) break;
    const ga = alive[ba];
    const bb = alive.indexOf(gb);
    if (bb < 0) throw new Error("cached partner is live");
    const moved = groups[gb];
    groups[gb] = [];
    groups[ga].push(...moved);
    for (let k = 0; k < n; k++) {
      s[ga * n + k] += s[gb * n + k];
      cnt[ga * n + k] += cnt[gb * n + k];
    }
    for (let k = 0; k < n; k++) {
      s[k * n + ga] += s[k * n + gb];
      cnt[k * n + ga] += cnt[k * n + gb];
    }
    alive.splice(bb, 1);
    // Only row ga and column ga changed (and gb is gone): a row whose partner was ga or gb is
    // rescanned; any other row compares its old best with its new entry for ga.
    best[ga] = rowBest(ga);
    for (const r of alive) {
      if (r === ga) continue;
      const [bv, bc] = best[r];
      if (bc === ga || bc === gb) {
        best[r] = rowBest(r);
      } else {
        const c = s[r * n + ga] / cnt[r * n + ga];
        if (c > bv || (c === bv && ga < bc)) best[r] = [c, ga];
      }
    }
  }
  return alive.map((g) => [...groups[g]].sort((a, b) => a - b));
}

/** Units positive with two groups that are negative with each other (a spanning header). */
function bridges(p: ArrayLike<number>, n: number): number[] {
  const neg = -1;
  const frac = 0.3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const nb: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j !== i && p[i * n + j] > 0) nb.push(j);
    }
    if (nb.length < 2) continue;
    let tot = 0;
    let negc = 0;
    for (let a = 0; a < nb.length; a++) {
      for (let b = a + 1; b < nb.length; b++) {
        tot += 1;
        if (p[nb[a] * n + nb[b]] < neg) negc += 1;
      }
    }
    if (tot > 0 && negc / tot > frac) out.push(i);
  }
  return out;
}

/**
 * Rows or columns: linkage over the non-bridging units; each bridging unit then joins every
 * group it is positive with on average (a span), or its best group.
 */
export function spanLink(p: ArrayLike<number>, n: number): number[][] {
  const br = bridges(p, n);
  const core: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!br.includes(i)) core.push(i);
  }
  if (core.length === 0) return avgLink(p, n, 0);
  const m = core.length;
  const sub = new Float64Array(m * m);
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) sub[a * m + b] = p[core[a] * n + core[b]];
  }
  const groups = avgLink(sub, m, 0).map((g) => g.map((i) => core[i]));
  for (const i of br) {
    const means = groups.map((g) => g.reduce((s, j) => s + p[i * n + j], 0) / g.length);
    let hit: number[] = [];
    means.forEach((mean, k) => {
      if (mean > 0) hit.push(k);
    });
    if (hit.length === 0) {
      let best = 0;
      for (let k = 1; k < means.length; k++) {
        if (means[k] > means[best]) best = k;
      }
      hit = [best];
    }
    for (const k of hit) groups[k].push(i);
  }
  for (const g of groups) g.sort((a, b) => a - b);
  return groups;
}

/**
 * Box indices in reading order: lines (vertical overlap over half the shorter box), top to
 * bottom, left to right within a line.
 */
export function readingOrder(boxes: readonly Box4[]): number[] {
  const order = boxes.map((_, i) => i);
  order.sort((a, b) => boxes[a][1] - boxes[b][1]);
  // each line: (top, bottom, members)
  const lines: Array<[number, number, number[]]> = [];
  for (const k of order) {
    const b = boxes[k];
    let placed = false;
    for (const ln of lines) {
      const ov = Math.min(ln[1], b[3]) - Math.max(ln[0], b[1]);
      if (ov > 0.5 * Math.min(ln[1] - ln[0], b[3] - b[1])) {
        ln[2].push(k);
        ln[0] = Math.min(ln[0], b[1]);
        ln[1] = Math.max(ln[1], b[3]);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([b[1], b[3], [k]]);
  }
  lines.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const ln of lines) {
    const ks = ln[2];
    ks.sort((a, b) => boxes[a][0] - boxes[b][0]);
    out.push(...ks);
  }
  return out;
}
