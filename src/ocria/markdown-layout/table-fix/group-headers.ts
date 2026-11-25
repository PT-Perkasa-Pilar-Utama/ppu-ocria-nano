// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0): group headers.

import { f32, trim } from "../../rust.js";
import type { Rect } from "../../types/geometry.js";
import { at, single } from "./dense.js";
import type { Dense } from "./dense.js";
import { unionRect } from "./fold-rows.js";

function centre(b: Rect): number {
  return f32(b.x + f32(b.width / 2));
}

function emptyAt(d: Dense, k: number | null): boolean {
  return k != null && trim(d.cells[k].text) === "";
}

function filledAt(d: Dense, k: number | null): boolean {
  return k != null && trim(d.cells[k].text) !== "";
}

/**
 * In a multi-row header, a cell followed by empty slots that the next header row fills spans
 * those columns when its box is centred over them (a group header over its sub-headers).
 */
export function spanGroupHeaders(d: Dense): void {
  if (d.header_rows < 2) return;
  for (let h = 0; h < d.header_rows - 1; h++) {
    let c = 0;
    while (c < d.n_cols) {
      const k0 = single(d, h, c);
      if (k0 == null || trim(d.cells[k0].text) === "") {
        c++;
        continue;
      }
      let end = c;
      while (
        end + 1 < d.n_cols &&
        emptyAt(d, single(d, h, end + 1)) &&
        filledAt(d, at(d, h + 1, end + 1))
      ) {
        end++;
      }
      if (end === c) {
        c++;
        continue;
      }
      // centred over the group: closer to the group's centre than to its first sub-column's
      const subs: Rect[] = [];
      for (let cc = c; cc <= end; cc++) {
        const j = at(d, h + 1, cc);
        const b = j == null ? null : d.cells[j].bbox;
        if (b != null) subs.push(b);
      }
      const hb = d.cells[k0].bbox;
      let ok = false;
      if (hb != null && subs.length > 0) {
        const g = subs.reduce((a, b) => unionRect(a, b));
        ok = Math.abs(f32(centre(hb) - centre(g))) < Math.abs(f32(centre(hb) - centre(subs[0])));
      }
      if (!ok) {
        c = end + 1;
        continue;
      }
      d.cells = d.cells.filter(
        (x) => !(x.r0 === h && x.rs === 1 && x.cs === 1 && x.c0 > c && x.c0 <= end)
      );
      const k = single(d, h, c);
      if (k == null) throw new Error("table_fix: the spanning header cell vanished");
      d.cells[k].cs = end - c + 1;
      c = end + 1;
    }
  }
}
