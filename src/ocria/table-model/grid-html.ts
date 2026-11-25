// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/decode.rs `impl Grid` (crates-v2.21.2, Apache-2.0): the grid as HTML.

import { chars } from "../rust.js";
import type { Grid } from "./types.js";

/** Python `html.escape(text, quote=True)`. */
function escape(t: string): string {
  let s = "";
  for (const ch of chars(t)) {
    switch (ch) {
      case "&":
        s += "&amp;";
        break;
      case "<":
        s += "&lt;";
        break;
      case ">":
        s += "&gt;";
        break;
      case '"':
        s += "&quot;";
        break;
      case "'":
        s += "&#x27;";
        break;
      default:
        s += ch;
    }
  }
  return s;
}

/** The grid as HTML, exactly as tn_core.decode_grid writes it. */
export function toHtml(g: Grid): string {
  const at = new Map<string, number>();
  const taken = new Set<string>();
  g.cells.forEach((c, k) => {
    at.set(`${c.r0},${c.c0}`, k);
    for (let r = c.r0; r <= c.r1; r++) {
      for (let q = c.c0; q <= c.c1; q++) taken.add(`${r},${q}`);
    }
  });
  const out = ["<table>"];
  for (let r = 0; r < g.n_rows; r++) {
    const tag = g.head_rows.includes(r) ? "th" : "td";
    let tds = "";
    let q = 0;
    while (q < g.n_cols) {
      const k = at.get(`${r},${q}`);
      if (k !== undefined) {
        const c = g.cells[k];
        let attr = "";
        if (c.r1 > r) attr += ` rowspan="${c.r1 - r + 1}"`;
        if (c.c1 > q) attr += ` colspan="${c.c1 - q + 1}"`;
        tds += `<${tag}${attr}>${escape(c.text)}</${tag}>`;
        q = c.c1 + 1;
      } else if (taken.has(`${r},${q}`)) {
        q += 1;
      } else {
        tds += `<${tag}></${tag}>`;
        q += 1;
      }
    }
    out.push(`<tr>${tds}</tr>`);
  }
  out.push("</table>");
  return out.join("\n");
}
