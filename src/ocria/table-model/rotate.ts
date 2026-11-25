// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs (crates-v2.21.2, Apache-2.0): pages whose text runs sideways.

// A page whose text mostly runs in one rotated direction (a table set sideways) is turned
// upright first: units, ruling lines and the page image all go into that reading frame, which
// is how the model saw tables in training, and every box it returns comes back to the page.

import type { Rect } from "../types/geometry.js";
import { f32, isWhitespace } from "../rust.js";
import type { Rules } from "./features.js";
import type { PageImage } from "./features-raster.js";
import type { PageInput } from "./page-input.js";
import type { PageModel } from "./types.js";
import { fromFrame, toFrame } from "./units.js";

/** The rotated reading direction (1..3) carrying at least 60% of a text-layer page's characters, if any. */
export function mainRotation(input: PageInput): number | null {
  if (input.ocr) return null;
  const byQ = [0, 0, 0, 0];
  for (const u of input.units) {
    let n = 0;
    for (const c of u.text) {
      if (!isWhitespace(c)) n += 1;
    }
    byQ[u.q & 3] += n;
  }
  const total = byQ.reduce((a, b) => a + b, 0);
  for (let q = 1; q < 4; q++) {
    if (total > 0 && byQ[q] * 10 >= total * 6) return q;
  }
  return null;
}

/**
 * Ruling lines in reading direction `q`'s frame: each segment's box goes through `toFrame`, and
 * a quarter turn swaps horizontal and vertical.
 */
export function rotateRules(r: Rules, q: number, w: number, h: number): Rules {
  const out: Rules = { h: [], v: [] };
  const segs: Array<[number, number, number, number]> = [
    ...r.h.map((s): [number, number, number, number] => [s[1], s[0], s[2], s[0]]),
    ...r.v.map((s): [number, number, number, number] => [s[0], s[1], s[0], s[2]]),
  ];
  for (const seg of segs) {
    const b = toFrame(seg, q, w, h);
    const [b0, b1, b2, b3] = b.map(f32);
    if (Math.abs(f32(b3 - b1)) <= Math.abs(f32(b2 - b0))) {
      out.h.push([f32(f32(b1 + b3) / 2), Math.min(b0, b2), Math.max(b0, b2)]);
    } else {
      out.v.push([f32(f32(b0 + b2) / 2), Math.min(b1, b3), Math.max(b1, b3)]);
    }
  }
  return out;
}

/**
 * The image-branch page turned into reading direction `q`'s frame (the pixel form of
 * `toFrame`: q = 1 maps (x, y) to (h - 1 - y, x)).
 */
export function rotateImage(im: PageImage, q: number): PageImage {
  const { w, h } = im;
  const [nw, nh] = q % 2 === 1 ? [h, w] : [w, h];
  const px = new Uint8Array(nw * nh).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (q) {
        case 1:
          [nx, ny] = [h - 1 - y, x];
          break;
        case 2:
          [nx, ny] = [w - 1 - x, h - 1 - y];
          break;
        default:
          [nx, ny] = [y, w - 1 - x];
      }
      px[ny * nw + nx] = im.px[y * w + x];
    }
  }
  return { w: nw, h: nh, px, k: im.k };
}

/** The page upright in reading direction `q`: units, ruling lines and image in that frame. */
export function uprightInput(
  input: PageInput,
  rules: Rules | null,
  img: PageImage | null,
  q: number
): PageInput {
  const [w, h] = input.wh;
  return {
    units: input.units.map((u) => ({ ...u, pbox: toFrame(u.pbox, q, w, h) })),
    wh: q % 2 === 1 ? [h, w] : [w, h],
    rules: rules ? rotateRules(rules, q, w, h) : null,
    ocr: input.ocr,
    img: img ? rotateImage(img, q) : null,
    raw: null,
  };
}

/** A model box in the upright frame back to the page. */
function back(r: Rect, q: number, w: number, h: number): Rect {
  const b = fromFrame([r.x, r.y, f32(r.x + r.width), f32(r.y + r.height)], q, w, h);
  return { x: f32(b[0]), y: f32(b[1]), width: f32(b[2] - b[0]), height: f32(b[3] - b[1]) };
}

/** Every box of a model found on the upright page (reading direction `q`), back on the page (`w` x `h` points). */
export function modelToPage(pm: PageModel, q: number, w: number, h: number): PageModel {
  return {
    tables: pm.tables.map((t) => ({
      bbox: back(t.bbox, q, w, h),
      grid: {
        ...t.grid,
        cells: t.grid.cells.map((c) => ({ ...c, bx: fromFrame(c.bx, q, w, h) })),
      },
    })),
    classes: pm.classes.map((c) => ({ ...c, bbox: back(c.bbox, q, w, h) })),
    blocks: pm.blocks.map((b) => ({ ...b, bbox: back(b.bbox, q, w, h) })),
  };
}
