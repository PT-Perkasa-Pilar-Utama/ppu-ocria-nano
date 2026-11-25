// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/units.rs `pdf_units` (crates-v2.21.2, Apache-2.0): from characters to units.

// `pdf_units` reads a PDFium page's characters and then builds units from
// them. The PDFium read (character boxes, fonts, view box, /Rotate) is not
// ported; `unitsFromChars` is the second half, from the characters on.

import { chIsSpace } from "./units.js";
import type { Ch, Unit } from "./units.js";
import { fromFrame } from "./units.js";
import { runUnits } from "./units-cut.js";
import { splitAligned } from "./units-aligned.js";
import { flagLetterStacks, joinTouching } from "./units-join.js";

/** Votes per reading direction, in first-seen order (Counter.most_common's tie order). */
type Votes = Array<[number, number]>;

/** The direction of a run by how consecutive glyphs advance. */
function direction(run: readonly Ch[]): Votes {
  const v: Votes = [];
  let prev: Ch | null = null;
  for (const c of run) {
    if (chIsSpace(c)) continue;
    if (prev !== null) {
      const dx = (c.pb[0] + c.pb[2] - prev.pb[0] - prev.pb[2]) / 2;
      const dy = (c.pb[1] + c.pb[3] - prev.pb[1] - prev.pb[3]) / 2;
      const sz = Math.max(c.pb[2] - c.pb[0], c.pb[3] - c.pb[1], 1);
      const d = Math.abs(dx) + Math.abs(dy);
      if (0 < d && d < 3 * sz) {
        let q: number;
        if (Math.abs(dx) >= Math.abs(dy)) q = dx > 0 ? 0 : 2;
        else q = dy < 0 ? 1 : 3;
        const e = v.find(([k]) => k === q);
        if (e) e[1] += 1;
        else v.push([q, 1]);
      }
    }
    prev = c;
  }
  return v;
}

/** The direction with the most votes; the first seen wins a tie. */
function most(v: Votes): number | null {
  let best: [number, number] | null = null;
  for (const [k, n] of v) {
    if (best === null || n > best[1]) best = [k, n];
  }
  return best === null ? null : best[0];
}

/**
 * Units of a page from its characters (a `null` entry is a generated line break), as `pdf_units`
 * builds them after reading the PDFium page. `w` and `h` are the rendered page size in points.
 */
export function unitsFromChars(chars: ReadonlyArray<Ch | null>, w: number, h: number): Unit[] {
  // raw runs between PDFium's breaks
  const rawRuns: Ch[][] = [];
  let cur: Ch[] = [];
  for (const c of chars) {
    if (c === null) {
      if (cur.length > 0) {
        rawRuns.push(cur);
        cur = [];
      }
    } else {
      cur.push(c);
    }
  }
  if (cur.length > 0) rawRuns.push(cur);
  // reading direction per run by how consecutive glyphs advance; votes kept in first-seen order
  const dirs = rawRuns.map(direction);
  const pageVotes: Votes = [];
  for (const d of dirs) {
    for (const [k, n] of d) {
      const e = pageVotes.find(([q]) => q === k);
      if (e) e[1] += n;
      else pageVotes.push([k, n]);
    }
  }
  const q = most(pageVotes) ?? 0;
  let units: Unit[] = [];
  rawRuns.forEach((run, i) => {
    const v = dirs[i];
    const total = v.reduce((s, x) => s + x[1], 0);
    const rq = v.length > 0 && total >= 2 ? (most(v) ?? q) : q;
    units.push(...runUnits(run, rq, w, h, rq !== q));
  });
  units = joinTouching(units);
  units = splitAligned(units);
  for (const u of units) u.pbox = fromFrame(u.bx, u.q, w, h);
  flagLetterStacks(units);
  return units;
}
