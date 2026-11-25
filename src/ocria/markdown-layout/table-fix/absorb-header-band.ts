// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0).

import { f32, totalCmp, trim } from "../../rust.js";
import { splitWhitespace, utf8Len } from "../../rust-extra.js";
import type { Rect } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import type { TextItem } from "../../types/text-item.js";
import type { Grid } from "../../table-model/types.js";

/** A header band cell: column, text, box. */
type BandCell = [number, string, [number, number, number, number]];

/** Column extents from the single-column cells, with the cells' heights; null when a column has no cell. */
function columnRanges(g: Grid): { rng: Array<[number, number]>; hs: number[] } | null {
  const rng: Array<[number, number] | null> = Array.from({ length: g.n_cols }, () => null);
  const hs: number[] = [];
  for (const x of g.cells) {
    if (trim(x.text) === "") continue;
    hs.push(x.bx[3] - x.bx[1]);
    if (x.c0 === x.c1) {
      const e = rng[x.c0];
      if (e == null) rng[x.c0] = [x.bx[0], x.bx[2]];
      else rng[x.c0] = [Math.min(e[0], x.bx[0]), Math.max(e[1], x.bx[2])];
    }
  }
  const out: Array<[number, number]> = [];
  for (const r of rng) {
    if (r == null) return null;
    out.push(r);
  }
  return hs.length === 0 ? null : { rng: out, hs };
}

/** The column nearest `cx`, when within two text heights of its extent. */
function nearestColumn(
  rng: ReadonlyArray<[number, number]>,
  cx: number,
  hh: number
): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (let c = 0; c < rng.length; c++) {
    const [a, b] = rng[c];
    let dist = 0;
    if (cx < a) dist = a - cx;
    else if (cx > b) dist = cx - b;
    if (dist < bd) {
      bd = dist;
      best = c;
    }
  }
  return best != null && bd <= 2 * hh ? best : null;
}

/**
 * The cells of one candidate header line, or null when the line does not read as a header row:
 * its runs must fall over the table's columns with a column-sized gap between two of them.
 */
function bandCells(
  line: ProjectedLine,
  rng: ReadonlyArray<[number, number]>,
  hh: number,
  empty0: readonly number[]
): BandCell[] | null {
  const spans: TextItem[] = line.spans.filter((s) => trim(s.text) !== "");
  spans.sort((a, b) => totalCmp(a.x, b.x));
  let wideGap = false;
  for (let i = 0; i + 1 < spans.length; i++) {
    const gap = f32(spans[i + 1].x - f32(spans[i].x + spans[i].width));
    if (gap >= 1.5 * hh) wideGap = true;
  }
  const cells: BandCell[] = [];
  let ok = wideGap;
  for (const s of spans) {
    const cx = f32(s.x + f32(s.width / 2));
    const c = nearestColumn(rng, cx, hh);
    if (c == null) {
      ok = false;
      break;
    }
    const bx: [number, number, number, number] = [
      s.x,
      s.y,
      f32(s.x + s.width),
      f32(s.y + s.height),
    ];
    const e = cells.find((cell) => cell[0] === c);
    if (e == null) {
      cells.push([c, trim(s.text), bx]);
    } else {
      e[1] = `${e[1]} ${trim(s.text)}`;
      e[2] = [
        Math.min(e[2][0], bx[0]),
        Math.min(e[2][1], bx[1]),
        Math.max(e[2][2], bx[2]),
        Math.max(e[2][3], bx[3]),
      ];
    }
  }
  if (!ok || cells.length < 2 || !cells.some((cell) => empty0.includes(cell[0]))) return null;
  return cells;
}

/**
 * Header band left above a model table: when the table's top row has empty slots, the text
 * lines just above it whose runs fall over its columns (two or more columns, separated by
 * column-sized gaps, not prose) become new header rows. Returns the indices of the absorbed
 * lines (the caller drops them from the text flow). Common in practice: a table's header row
 * printed as a paragraph above an empty-headed table.
 */
export function absorbHeaderBand(
  g: Grid,
  lines: readonly ProjectedLine[],
  pb: readonly Rect[],
  taken: ReadonlyMap<number, ProjectedLine | null>
): number[] {
  if (g.n_cols < 2 || g.n_rows < 2) return [];
  const filled = (r: number, c: number): boolean =>
    g.cells.some((x) => x.r0 <= r && r <= x.r1 && x.c0 <= c && c <= x.c1 && trim(x.text) !== "");
  const empty0: number[] = [];
  for (let c = 0; c < g.n_cols; c++) if (!filled(0, c)) empty0.push(c);
  if (empty0.length === 0) return [];
  const ranges = columnRanges(g);
  if (ranges == null) return [];
  const { rng } = ranges;
  const hs = [...ranges.hs].sort(totalCmp);
  const hh = Math.max(hs[Math.floor(hs.length / 2)], 1);
  const top = g.cells.reduce((m, x) => Math.min(m, x.bx[1]), Infinity);
  const tx0 = rng[0][0];
  const tx1 = rng[g.n_cols - 1][1];
  // candidate lines above the table, closest first
  const cand: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const b = pb[i];
    const bot = f32(b.y + b.height);
    const cx = f32(b.x + f32(b.width / 2));
    if (
      !taken.has(i) &&
      lines[i].spans.length >= 2 &&
      bot <= top + 0.3 * hh &&
      top - bot <= 2.5 * hh &&
      tx0 - hh <= cx &&
      cx <= tx1 + hh
    ) {
      cand.push(i);
    }
  }
  cand.sort((a, b) => totalCmp(pb[b].y, pb[a].y));
  const rows: Array<[number, BandCell[]]> = [];
  let edge = top;
  for (const i of cand) {
    const l = lines[i];
    const bot = f32(pb[i].y + pb[i].height);
    if (edge - bot > 2 * hh || rows.length >= 2) break;
    const text = trim(l.text);
    if (splitWhitespace(text).length > 16 || (text.endsWith(".") && utf8Len(text) > 40)) break;
    const cells = bandCells(l, rng, hh, empty0);
    if (cells == null) break;
    rows.push([i, cells]);
    edge = pb[i].y;
  }
  if (rows.length === 0) return [];
  // top-most line first; every existing row moves down
  rows.reverse();
  const k = rows.length;
  for (const x of g.cells) {
    x.r0 += k;
    x.r1 += k;
  }
  g.head_rows = g.head_rows.map((h) => h + k);
  for (let r = 0; r < rows.length; r++) {
    g.head_rows.push(r);
    for (let c = 0; c < g.n_cols; c++) {
      const hit = rows[r][1].find((cell) => cell[0] === c);
      g.cells.push({
        r0: r,
        c0: c,
        r1: r,
        c1: c,
        text: hit == null ? "" : hit[1],
        bx: hit == null ? [0, 0, 0, 0] : [...hit[2]],
      });
    }
  }
  // the band's rows lead the header; rows that were header stay header
  g.head_rows = [...new Set(g.head_rows.sort((a, b) => a - b))];
  g.n_rows += k;
  return rows.map(([i]) => i);
}
