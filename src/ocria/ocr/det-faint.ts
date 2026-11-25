// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/det.rs (crates-v2.21.2, Apache-2.0).

// Faint short-token candidates next to detected lines.

import { f32, totalCmp } from "../rust.js";
import type { Faint } from "./det.js";
import { components4 } from "./geometry.js";
import type { Img, Pt, Quad } from "./img.js";

type Ext = [x0: number, y0: number, x1: number, y1: number];

function quadExt(q: Quad): Ext {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of q) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

/**
 * Candidate boxes for `Faint` tokens, in `img` pixels. `toImg` maps a
 * probability-map cell corner to image pixels; `boxes` are the detected lines.
 */
export function faintBoxes(
  prob: ArrayLike<number>,
  mask: ArrayLike<number>,
  pw: number,
  ph: number,
  toImg: (x: number, y: number) => Pt,
  boxes: readonly Quad[],
  f: Faint,
  img: Img
): Quad[] {
  // a candidate keeps the side margin a detected line has around its text
  const PAD = f32(0.35);
  const lines = boxes.map(quadExt);
  // rows: lines that run level, so their box is the row's band
  const rows = lines.filter(
    (l, i) => Math.abs(f32(boxes[i][1][1] - boxes[i][0][1])) <= f32(f32(0.1) * f32(l[2] - l[0]))
  );
  if (rows.length === 0) return [];
  const thresh = f32(f.thresh);
  const weak = new Uint8Array(prob.length);
  for (let i = 0; i < prob.length; i++) weak[i] = prob[i] > thresh ? 1 : 0;
  const cands: Array<[peak: number, q: Quad]> = [];
  for (const comp of components4(weak, pw, ph)) {
    if (comp.pixels.some((p) => mask[p])) continue;
    const [x0, y0] = toImg(comp.x0, comp.y0);
    const [x1, y1] = toImg(comp.x1 + 1, comp.y1 + 1);
    const cy = f32(f32(y0 + y1) / 2);
    // the row: a level line whose middle half holds the region's centre
    // (Iterator::min_by keeps the first of equal minima)
    let row: Ext | undefined;
    let rowKey = Infinity;
    for (const r of rows) {
      const rh = f32(r[3] - r[1]);
      if (!(cy >= f32(r[1] + f32(0.25 * rh)) && cy <= f32(r[3] - f32(0.25 * rh)))) continue;
      const key = Math.abs(f32(f32(r[1] + r[3]) - f32(2 * cy)));
      if (row === undefined || key < rowKey) {
        row = r;
        rowKey = key;
      }
    }
    if (!row) continue;
    const ry0 = row[1];
    const ry1 = row[3];
    const h = f32(ry1 - ry0);
    // a short token's core is lower than its row's line box and at most a few glyphs wide
    if (f32(y1 - y0) > f32(f32(0.8) * h) || f32(x1 - x0) > f32(f32(1.5) * h)) continue;
    const bx0 = Math.max(f32(x0 - f32(PAD * h)), 0);
    const bx1 = Math.min(f32(x1 + f32(PAD * h)), f32(img.w));
    const by0 = Math.max(ry0, 0);
    const by1 = Math.min(ry1, f32(img.h));
    const area = f32(f32(bx1 - bx0) * f32(by1 - by0));
    // not part of a detected line (a gap between words, an accent, a descender)
    const covered = lines.some((l) => {
      const ix = Math.max(f32(Math.min(bx1, l[2]) - Math.max(bx0, l[0])), 0);
      const iy = Math.max(f32(Math.min(by1, l[3]) - Math.max(by0, l[1])), 0);
      return f32(ix * iy) > f32(f32(0.2) * area);
    });
    if (covered) continue;
    let peak = 0;
    for (const p of comp.pixels) peak = Math.max(peak, prob[p]);
    cands.push([
      peak,
      [
        [bx0, by0],
        [bx1, by0],
        [bx1, by1],
        [bx0, by1],
      ],
    ]);
  }
  cands.sort((a, b) => totalCmp(b[0], a[0]));
  return cands.slice(0, f.max).map((c) => c[1]);
}
