// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/units.rs (crates-v2.21.2, Apache-2.0): joining and flagging units.

import { asInt, charCount, roundTiesEven } from "../rust.js";
import type { Box4, Unit } from "./units.js";

/** `a.partial_cmp(b)` of `(i64, f64)` pairs, as a sort comparator. */
function cmpPair(a: [number, number], b: [number, number]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] < b[1]) return -1;
  return a[1] > b[1] ? 1 : 0;
}

/** Re-join pieces the baseline rule split but that touch (a superscript, a symbol in another font). */
export function joinTouching(units: Unit[]): Unit[] {
  const order = units.map((_, i) => i);
  order.sort((a, b) => units[a].bx[0] - units[b].bx[0]);
  const used = units.map(() => false);
  const out: Unit[] = [];
  for (const i of order) {
    if (used[i]) continue;
    const u = units[i];
    let bx: Box4 = [...u.bx];
    let text = u.text;
    let h = u.h;
    const words = [...u.words];
    let grew = true;
    while (grew) {
      grew = false;
      for (const j of order) {
        if (used[j] || j === i) continue;
        const v = units[j];
        if (v.q !== u.q) continue;
        const hh = Math.max(Math.min(h, v.h), 1);
        const gap = v.bx[0] - bx[2];
        if (
          -0.5 * hh <= gap &&
          gap < 0.1 * hh &&
          Math.min(bx[3], v.bx[3]) - Math.max(bx[1], v.bx[1]) > 0
        ) {
          bx = [
            Math.min(bx[0], v.bx[0]),
            Math.min(bx[1], v.bx[1]),
            Math.max(bx[2], v.bx[2]),
            Math.max(bx[3], v.bx[3]),
          ];
          text += v.text;
          h = Math.max(h, v.h);
          // touching: v's first word continues u's last
          let from = 0;
          if (words.length > 0 && v.words.length > 0) {
            const a = words[words.length - 1];
            const b = v.words[0];
            words[words.length - 1] = [
              Math.min(a[0], b[0]),
              Math.max(a[1], b[1]),
              `${a[2]}${b[2]}`,
            ];
            from = 1;
          }
          words.push(...v.words.slice(from));
          used[j] = true;
          grew = true;
        }
      }
    }
    used[i] = true;
    out.push({
      bx,
      pbox: [...bx],
      text,
      h,
      size: u.size,
      bold: u.bold,
      q: u.q,
      minor: u.minor,
      words,
    });
  }
  out.sort((a, b) =>
    cmpPair([asInt(roundTiesEven(a.bx[1])), a.bx[0]], [asInt(roundTiesEven(b.bx[1])), b.bx[0]])
  );
  return out;
}

/** Whether at least 80% of `chain` have another unit (not in the chain) centred on their line. */
function rowMates(units: readonly Unit[], chain: readonly number[]): boolean {
  const cy = (u: Unit): number => (u.pbox[1] + u.pbox[3]) / 2;
  const inChain = new Set(chain);
  let mated = 0;
  for (const v of chain) {
    const b = units[v].pbox;
    const tol = 0.3 * Math.max(b[3] - b[1], 1);
    const any = units.some(
      (u, w) => !inChain.has(w) && !u.minor && Math.abs(cy(u) - cy(units[v])) < tol
    );
    if (any) mated += 1;
  }
  return mated * 5 >= chain.length * 4;
}

/**
 * Single characters stacked in a column (vertical text emitted one glyph per run) are minor -
 * unless most of them have row-mates (another unit centred on the same line): that is a table
 * column of one-glyph cells (digits, check marks), not vertical text.
 */
export function flagLetterStacks(units: Unit[]): void {
  const singles: number[] = [];
  for (let i = 0; i < units.length; i++) {
    if (charCount(units[i].text) === 1 && !units[i].minor) singles.push(i);
  }
  const cx = (u: Unit): number => (u.pbox[0] + u.pbox[2]) / 2;
  singles.sort((a, b) =>
    cmpPair(
      [asInt(roundTiesEven(cx(units[a]))), units[a].pbox[1]],
      [asInt(roundTiesEven(cx(units[b]))), units[b].pbox[1]]
    )
  );
  const used = units.map(() => false);
  for (let s = 0; s < singles.length; s++) {
    const u = singles[s];
    if (used[u]) continue;
    const chain = [u];
    let last = u;
    for (const v of singles.slice(s + 1)) {
      const cl = cx(units[last]);
      const cv = cx(units[v]);
      const lb = units[last].pbox;
      const hh = Math.max(lb[3] - lb[1], lb[2] - lb[0], 1);
      const dy = units[v].pbox[1] - lb[3];
      if (Math.abs(cv - cl) < 0.6 * hh && 0 <= dy && dy < 1.5 * hh) {
        chain.push(v);
        last = v;
      }
    }
    if (chain.length >= 3 && !rowMates(units, chain)) {
      for (const v of chain) {
        units[v].minor = true;
        used[v] = true;
      }
    }
  }
}
