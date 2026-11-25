// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Group glyphs into lines: full-size glyphs set the line baselines, smaller ones (scripts) attach
// to the nearest line whose band they fall in.

import { f32, totalCmp } from "../../ocria/rust.js";
import { fmax, foldMax, foldMin, median } from "./helpers.js";
import { gCx } from "./types.js";
import type { G } from "./types.js";

export type Base = {
  y: number;
  size: number;
  gs: number[];
  ext: [x0: number, x1: number] | null;
};

/** Attach the glyph to the baseline row it belongs to, or open a new row. */
function groupBaselines(all: readonly G[], big: readonly number[]): Base[] {
  const bases: Base[] = [];
  for (const g of big) {
    const gb = all[g].base;
    const gsz = all[g].size;
    const b = bases.find((c) => Math.abs(f32(c.y - gb)) < f32(f32(0.25) * gsz));
    if (b !== undefined) b.gs.push(g);
    else bases.push({ y: gb, size: gsz, gs: [g], ext: null });
  }
  return bases;
}

/** Move each cmex glyph onto the nearest baseline below its origin. */
function placeExtensions(all: G[], live: readonly number[], bases: Base[]): void {
  for (const g of live) {
    if (all[g].role !== "Ex") continue;
    // Note: a cmex glyph hangs from its origin; its line is the nearest baseline below that.
    const xc = gCx(all[g]);
    const gb = all[g].base;
    const gs = all[g].size;
    let row: number | null = null;
    for (const [k, b] of bases.entries()) {
      if (b.ext === null) continue;
      const [e0, e1] = b.ext;
      const first = b.gs[0];
      const ok =
        e0 <= xc &&
        xc <= e1 &&
        f32(gb - f32(3 * gs)) <= b.y &&
        b.y <= f32(gb + f32(f32(0.3) * gs)) &&
        first !== undefined &&
        all[first].role !== "Ex";
      if (ok && (row === null || b.y > bases[row].y)) row = k;
    }
    if (row === null) continue;
    for (const b of bases) {
      const p = b.gs.indexOf(g);
      if (p >= 0) b.gs.splice(p, 1);
    }
    all[g].base = bases[row].y;
    all[g].size = bases[row].size;
    bases[row].gs.push(g);
  }
}

/** Attach each script glyph to the nearest baseline among the rows whose x-extent holds it. */
function placeScripts(
  all: readonly G[],
  live: readonly number[],
  bases: Base[],
  body: number
): void {
  for (const g of live) {
    if (all[g].size >= f32(f32(0.85) * body) || all[g].role === "Ex") continue;
    const xc = gCx(all[g]);
    const gb = all[g].base;
    let best: number | null = null;
    for (const [k, b] of bases.entries()) {
      if (b.ext === null) continue;
      const [e0, e1] = b.ext;
      const d = f32(gb - b.y);
      if (!(f32(f32(-0.6) * b.size) < d && d < f32(f32(0.8) * b.size) && e0 <= xc && xc <= e1)) {
        continue;
      }
      if (best === null || Math.abs(f32(gb - b.y)) < Math.abs(f32(gb - bases[best].y))) best = k;
    }
    if (best !== null) bases[best].gs.push(g);
    else bases.push({ y: gb, size: all[g].size, gs: [g], ext: null });
  }
}

/** Note: then split each row at wide gaps nothing fills: the gutter between two columns. */
function splitRows(all: readonly G[], bases: readonly Base[]): [y: number, gs: number[]][] {
  const split: [y: number, gs: number[]][] = [];
  for (const b of bases) {
    const row = [...b.gs].sort((a, c) => totalCmp(all[a].x0, all[c].x0));
    let cur: number[] = [row[0]];
    let right = all[row[0]].x1;
    for (const g of row.slice(1)) {
      if (f32(all[g].x0 - right) > f32(f32(1.5) * b.size)) {
        split.push([b.y, cur]);
        cur = [];
      }
      cur.push(g);
      right = fmax(right, all[g].x1);
    }
    split.push([b.y, cur]);
  }
  return split;
}

/**
 * Group glyphs into lines: full-size glyphs set the line baselines, smaller ones (scripts) attach
 * to the nearest line whose band they fall in. Moves cmex glyphs onto their line's baseline.
 */
export function lines(all: G[], live: readonly number[]): number[][] {
  if (live.length === 0) return [];
  const body = median(live.map((i) => all[i].size));
  const big = live.filter((i) => all[i].size >= f32(f32(0.85) * body));
  big.sort((a, b) => totalCmp(all[b].base, all[a].base));
  const bases = groupBaselines(all, big);
  // Scripts attach to the nearest baseline among the rows whose x-extent holds them (one baseline
  // can hold a row of each column on a two-column page).
  for (const b of bases) {
    const x0 = foldMin(b.gs.map((i) => all[i].x0));
    const x1 = foldMax(b.gs.map((i) => all[i].x1));
    b.ext = [f32(x0 - b.size), f32(x1 + f32(f32(1.5) * b.size))];
  }
  placeExtensions(all, live, bases);
  const kept = bases.filter((b) => b.gs.length > 0);
  placeScripts(all, live, kept, body);
  const split = splitRows(all, kept);
  split.sort((a, b) => totalCmp(b[0], a[0]) || totalCmp(all[a[1][0]].x0, all[b[1][0]].x0));
  return split.map(([, gs]) => gs.sort((a, b) => totalCmp(all[a].x0, all[b].x0)));
}
