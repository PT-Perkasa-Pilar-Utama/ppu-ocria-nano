// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/page.rs (crates-v2.21.2, Apache-2.0).

// Column-gutter splitting: cut line boxes that run across a blank column.

import { asInt, clamp, f32 } from "../rust.js";
import { otsu } from "./geometry.js";
import type { Img, Quad } from "./img.js";
import { meanGray } from "./img.js";
import { extent } from "./page.js";

/** Minimum blank-run width, in line heights, for a column gutter. */
const GUTTER_MIN = 0.4;

/**
 * Cut near-horizontal boxes at blank vertical runs that line up with other
 * boxes' edges and stay clear in the neighbouring lines.
 */
export function splitGutters(img: Img, boxes: readonly Quad[]): Quad[] {
  if (boxes.length < 3) return boxes.slice();
  const gray = meanGray(img);
  const gw = gray.w;
  const gh = gray.h;
  const gd = gray.data;
  const px = (x: number, y: number): number => gd[y * gw + x];
  const ext = boxes.map(extent);
  const out: Quad[] = [];
  boxes.forEach((q, i) => {
    const [x0, y0, x1, y1] = ext[i];
    const h = y1 - y0;
    const tilt = Math.abs(q[1][1] - q[0][1]);
    if (h < 6 || x1 - x0 < 4 * h || tilt > 0.25 * h) {
      out.push(q);
      return;
    }
    const ya = Math.min(Math.max(asInt(y0 + 0.15 * h), 0), gh);
    const yb = clamp(asInt(Math.ceil(y1 - 0.15 * h)), 0, gh);
    const xa = Math.max(asInt(x0), 0);
    const xb = Math.min(asInt(Math.ceil(x1)), gw);
    if (yb <= ya || xb <= xa) {
      out.push(q);
      return;
    }
    let lo = 255;
    let hi = 0;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const v = px(x, y);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (hi - lo < 60) {
      out.push(q);
      return;
    }
    const region: number[] = [];
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) region.push(px(x, y));
    const thr = otsu(region);
    // A printed column rule (a thin solid stroke that carries on above and
    // below the line, through the space between lines) belongs to the gutter,
    // not the text: glyph stems stop at the line.
    const rule = ruleColumns(px, xa, xb, y0, y1, gw, gh, thr);
    // ink columns (relative to xa)
    const idx: number[] = [];
    for (let x = xa; x < xb; x++) {
      if (rule.has(x)) continue;
      for (let y = ya; y < yb; y++) {
        if (px(x, y) < thr) {
          idx.push(x - xa);
          break;
        }
      }
    }
    if (idx.length < 2) {
      out.push(q);
      return;
    }
    const cy = (y0 + y1) / 2;
    const tol = 0.6 * h;
    const cuts: Array<[number, number]> = [];
    for (let g = 0; g < idx.length - 1; g++) {
      if (idx[g + 1] - idx[g] <= GUTTER_MIN * h) continue;
      // blank columns [a, b)
      const a = xa + idx[g] + 1;
      const b = xa + idx[g + 1];
      let left = 0;
      let right = 0;
      ext.forEach((e, j) => {
        const eh = e[3] - e[1];
        if (j !== i && Math.abs((e[1] + e[3]) / 2 - cy) < 25 * h && 0.5 * h < eh && eh < 2 * h) {
          if (Math.abs(e[0] - b) < tol) left++;
          if (Math.abs(e[2] - a) < tol) right++;
        }
      });
      // both sides need a column of edges; a hanging-indent marker has only one
      if (left < 1 || right < 1 || left + right < 3 || a - x0 < 3 * h) continue;
      // the gutter stays clear in the neighbouring lines, judged per line
      const m = Math.max(asInt((b - a) * 0.25), 1);
      const sa = asInt(a + m);
      const sb = asInt(b - m);
      if (sb <= sa) continue;
      let ok = 0;
      let bad = 0;
      ext.forEach((e, j) => {
        const eh = e[3] - e[1];
        if (j === i || Math.abs((e[1] + e[3]) / 2 - cy) > 4 * h || !(0.5 * h < eh && eh < 2 * h)) {
          return;
        }
        if (e[2] <= sa || e[0] >= sb) {
          ok++;
          return;
        }
        const ra = clamp(asInt(e[1] + 0.15 * eh), 0, gh);
        const rb = clamp(asInt(Math.ceil(e[3] - 0.15 * eh)), 0, gh);
        const ca = clamp(sa, 0, gw);
        const cb = clamp(sb, 0, gw);
        let inked = false;
        for (let y = ra; y < rb && !inked; y++) {
          for (let x = ca; x < cb; x++) {
            if (!rule.has(x) && px(x, y) < thr) {
              inked = true;
              break;
            }
          }
        }
        if (inked) bad++;
        else ok++;
      });
      if (!(ok >= 2 && (bad === 0 || (bad === 1 && ok >= 3)))) continue;
      cuts.push([a, b]);
    }
    if (cuts.length === 0) {
      out.push(q);
      return;
    }
    const pad = 0.15 * h;
    const edges = [x0];
    for (const [a, b] of cuts) edges.push(a + pad, b - pad);
    edges.push(x1);
    for (let k = 0; k < edges.length; k += 2) {
      const s = edges[k];
      const e = edges[k + 1];
      if (e - s > 0.5 * h) {
        const [fs, fe, fy0, fy1] = [f32(s), f32(e), f32(y0), f32(y1)];
        out.push([
          [fs, fy0],
          [fe, fy0],
          [fe, fy1],
          [fs, fy1],
        ]);
      }
    }
  });
  return out;
}

/**
 * Columns of a printed vertical rule crossing the line box `y0..y1`: runs at
 * most ~0.15 line heights wide that are inked down the whole line and through
 * bands of 0.35 line heights above and below it, with blank columns on both
 * sides, widened by their anti-aliased edges.
 */
function ruleColumns(
  px: (x: number, y: number) => number,
  xa: number,
  xb: number,
  y0: number,
  y1: number,
  gw: number,
  gh: number,
  thr: number
): Set<number> {
  const h = y1 - y0;
  const band = asInt(Math.ceil(0.35 * h));
  const top = asInt(y0);
  const bot = asInt(Math.ceil(y1));
  const inkedShare = (x: number, ya0: number, yb0: number): number => {
    const ya = clamp(ya0, 0, gh);
    const yb = clamp(yb0, 0, gh);
    if (yb <= ya || x < 0 || x >= gw) return 0;
    let n = 0;
    for (let y = ya; y < yb; y++) if (px(x, y) < thr) n++;
    return n / (yb - ya);
  };
  const solid: boolean[] = [];
  for (let x = xa; x < xb; x++) {
    solid.push(
      inkedShare(x, top, bot) >= 0.9 &&
        inkedShare(x, top - band, top) >= 0.8 &&
        inkedShare(x, bot, bot + band) >= 0.8
    );
  }
  const maxW = Math.max(asInt(Math.ceil(0.15 * h)), 3);
  const out = new Set<number>();
  let i = 0;
  while (i < solid.length) {
    if (!solid[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < solid.length && solid[i]) i++;
    // a stroke between blank columns (a light ground): on a dark panel every
    // gap between light letters is "inked" top to bottom too
    const flank = Math.max(asInt(Math.ceil(0.25 * h)), 3);
    const blankSide = (from: number, to: number): boolean => {
      let n = 0;
      for (let x = from; x < to; x++) if (inkedShare(x, top, bot) < 0.1) n++;
      return n * 2 >= to - from;
    };
    const rs = xa + start;
    const re = xa + i;
    if (i - start <= maxW && blankSide(rs - flank, rs) && blankSide(re, re + flank)) {
      // with its anti-aliased edges, inked in only part of the line
      const pad = Math.max(asInt(Math.ceil(0.06 * h)), 2);
      for (let x = xa + start - pad; x < xa + i + pad; x++) out.add(x);
    }
  }
  return out;
}
