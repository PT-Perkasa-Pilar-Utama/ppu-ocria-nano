// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse crates/liteparse/src/table_model/{decode,mod}.rs
// (crates-v2.21.2), ported, and behavior tests of the pure functions the goldens do not reach.

import { describe, expect, test } from "bun:test";

import { avgLink } from "../../src/ocria/table-model/decode-link.js";
import { foldHeaderWraps } from "../../src/ocria/table-model/decode-fold.js";
import type { GridCell } from "../../src/ocria/table-model/types.js";
import { faintMask } from "../../src/ocria/table-model/signals.js";

/** The exhaustive average linkage `avgLink` replaced: the reference its merges, order and sums must match. */
function avgLinkReference(p: Float64Array, n: number, thresh: number): number[][] {
  const groups: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const s = Float64Array.from(p);
  const cnt = new Float64Array(n * n).fill(1);
  const alive = Array.from({ length: n }, (_, i) => i);
  while (alive.length > 1) {
    const m = alive.length;
    let best = -Infinity;
    let ba = 0;
    let bb = 0;
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        if (a === b) continue;
        const [ga, gb] = [alive[a], alive[b]];
        const v = s[ga * n + gb] / cnt[ga * n + gb];
        if (v > best) {
          best = v;
          ba = a;
          bb = b;
        }
      }
    }
    if (best <= thresh) break;
    const [ga, gb] = [alive[ba], alive[bb]];
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
  }
  return alive.map((g) => [...groups[g]].sort((a, b) => a - b));
}

describe("decode.rs", () => {
  test("avg_link matches the exhaustive reference", () => {
    // xorshift64: deterministic matrices without a random-number dependency
    let x = 0x9e3779b97f4a7c15n;
    const next = (): bigint => {
      x ^= BigInt.asUintN(64, x << 13n);
      x ^= x >> 7n;
      x ^= BigInt.asUintN(64, x << 17n);
      return x;
    };
    const levels = [-2, -1, -0.5, 0, 0.25, 0.5, 1, 2];
    for (let c = 0; c < 400; c++) {
      const n = 1 + Number(next() % 80n);
      const symmetric = c % 4 !== 3;
      const discrete = c % 2 === 0; // small value set: many exact ties
      const p = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (symmetric && j < i) {
            p[i * n + j] = p[j * n + i];
            continue;
          }
          p[i * n + j] = discrete
            ? levels[Number(next() % BigInt(levels.length))]
            : Number(next() % 20001n) / 5000 - 2;
        }
      }
      for (const thresh of [0, -0.75, 0.6]) {
        expect(avgLink(p, n, thresh), `case ${c} n ${n} thresh ${thresh}`).toEqual(
          avgLinkReference(p, n, thresh)
        );
      }
    }
  });

  const hcell = (r: number, c: number, text: string, y0: number, y1: number): GridCell => ({
    r0: r,
    c0: c,
    r1: r,
    c1: c,
    text,
    bx: [c * 100, y0, c * 100 + 90, y1],
  });

  test("wrapped header lines fold", () => {
    // "Product" / "(active substance(s))" and "Recommendation" / "(additions to text)"
    const cells = [
      hcell(0, 0, "Product", 76.6, 83.6),
      hcell(0, 1, "Date", 76.6, 83.6),
      hcell(0, 2, "Recommendation", 76.6, 83.6),
      hcell(1, 0, "(active substance(s))", 87.5, 96.2),
      hcell(1, 2, "(additions to text)", 87.5, 96.2),
      hcell(2, 0, "Purevax", 110, 118),
      hcell(2, 1, "5-7 October 2021", 110, 118),
      hcell(2, 2, "Section 4.6", 110, 118),
    ];
    const n = foldHeaderWraps(cells, [0], 3);
    expect(n).toBe(2);
    expect(cells.some((c) => c.text === "Product (active substance(s))")).toBe(true);
  });

  test("name lists and lone tails do not fold", () => {
    // a text-only list: no continuation cue
    const list = [
      hcell(0, 0, "Alfa Romeo", 10, 18),
      hcell(0, 1, "Audi", 10, 18),
      hcell(1, 0, "Buick Reatta", 20, 28),
      hcell(1, 1, "Cadillac", 20, 28),
    ];
    expect(foldHeaderWraps(list, [], 2)).toBe(2);
    // one lowercase tail in a wide row: a body cell's wrap, not a header line
    const tail = [
      hcell(0, 0, "Country", 10, 18),
      hcell(0, 1, "Sector", 10, 18),
      hcell(0, 2, "Restrictions", 10, 18),
      hcell(1, 2, "right required to acquire land", 20, 28),
    ];
    expect(foldHeaderWraps(tail, [0], 2)).toBe(2);
  });
});

describe("mod.rs", () => {
  test("masked token keeps its length and reads as a word", () => {
    expect(faintMask("1")).toBe("x");
    expect(faintMask("€1")).toBe("xx");
  });
});
