// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/features.rs (crates-v2.21.2, Apache-2.0): the page raster.

// `render_raw` (the PDFium render) and `page_rules` / `page_raster` (which call
// it) are not ported; `RawRaster` comes from `image-page.ts` (`imageRaster`),
// and `processRaster` turns it into ruling lines and the image-branch input.

import { RULES_DPI } from "../image-page.js";
import type { RawRaster } from "../image-page.js";
import { roundF32 } from "../rust-extra.js";
import { asUsize, f32 } from "../rust.js";
import type { Box4f, Rules } from "./features.js";
import { detectRules } from "./features-rules.js";
import { IMG_SIDE } from "./net.js";
import type { ImgInput } from "./net.js";

export { RULES_DPI };

/**
 * A page rendered for the image branch: grey (0 = black) with its longest side `IMG_SIDE`, and
 * its pixels per PDF point.
 */
export type PageImage = { w: number; h: number; px: Uint8Array; k: number };

/** The model's input: ink on the square canvas, unit boxes (`pbox`, points) as fractions. */
export function pageImageInput(im: PageImage, pboxes: readonly Box4f[]): ImgInput {
  const side = IMG_SIDE;
  const canvas = new Float32Array(side * side);
  for (let y = 0; y < Math.min(im.h, side); y++) {
    for (let x = 0; x < Math.min(im.w, side); x++) {
      canvas[y * side + x] = f32(f32(255 - im.px[y * im.w + x]) / 255);
    }
  }
  const f = f32(im.k / side);
  const clamp01 = (v: number): number => Math.min(Math.max(f32(v * f), 0), 1);
  const boxes = pboxes.map((b): [number, number, number, number] => [
    clamp01(b[0]),
    clamp01(b[1]),
    clamp01(b[2]),
    clamp01(b[3]),
  ]);
  return { canvas, boxes, valid: [f32(im.w / side), f32(im.h / side)] };
}

/**
 * Area-average resample (OpenCV INTER_AREA when shrinking) of a grey image to (tw, th): a
 * separable box filter with fractional coverage, rows then columns, in f32.
 */
export function resampleArea(
  g: Uint8Array,
  w: number,
  h: number,
  tw: number,
  th: number
): Uint8Array {
  // Each output's taps are (source index, weight) in source order, flattened, with
  // `at[o]..at[o + 1]` its range.
  const weights = (nIn: number, nOut: number): [number[], Array<[number, number]>] => {
    const f = f32(nIn / nOut);
    const at = [0];
    const taps: Array<[number, number]> = [];
    for (let o = 0; o < nOut; o++) {
      const a = f32(o * f);
      const b = f32(f32(o + 1) * f);
      let i = Math.floor(a);
      while (i < b && i < nIn) {
        const cov = Math.max(f32(Math.min(b, f32(i + 1)) - Math.max(a, i)), 0);
        if (cov > 0) taps.push([i, f32(cov / f)]);
        i += 1;
      }
      at.push(taps.length);
    }
    return [at, taps];
  };
  const [ax, wx] = weights(w, tw);
  const [ay, wy] = weights(h, th);
  const tmp = new Float32Array(h * tw);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < tw; x++) {
      let s = 0;
      for (let t = ax[x]; t < ax[x + 1]; t++) s = f32(s + f32(g[y * w + wx[t][0]] * wx[t][1]));
      tmp[y * tw + x] = s;
    }
  }
  // columns: the same per-output sums in the same tap order, accumulated a row at a time
  const out = new Uint8Array(th * tw);
  const acc = new Float32Array(tw);
  for (let y = 0; y < th; y++) {
    acc.fill(0);
    for (let t = ay[y]; t < ay[y + 1]; t++) {
      const [i, c] = wy[t];
      for (let x = 0; x < tw; x++) acc[x] = f32(acc[x] + f32(tmp[i * tw + x] * c));
    }
    for (let x = 0; x < tw; x++) out[y * tw + x] = Math.min(Math.max(roundF32(acc[x]), 0), 255);
  }
  return out;
}

/**
 * The render in grey (row-major, `w * h`): OpenCV's integer RGB2GRAY weights on PDFium's BGR(x)
 * channel order, as the training renders were made.
 */
export function rasterGrey(raw: RawRaster): Uint8Array {
  const { w, h, bpp, stride, buf } = raw;
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = y * stride;
    for (let x = 0; x < w; x++) {
      const p = src + x * bpp;
      g[y * w + x] =
        bpp === 1
          ? buf[p]
          : (4899 * buf[p] + 9617 * buf[p + 1] + 1868 * buf[p + 2] + (1 << 13)) >>> 14;
    }
  }
  return g;
}

/** Ruling lines and the image-branch input from a rendered page. */
export function processRaster(
  raw: RawRaster,
  withRules: boolean,
  withImg: boolean
): [Rules | null, PageImage | null] {
  if (!withRules && !withImg) return [null, null];
  const { w, h } = raw;
  if (w === 0 || h === 0) return [withRules ? { h: [], v: [] } : null, null];
  // one grey image serves both: the image branch's input and the ink mask
  const gray = rasterGrey(raw);
  let img: PageImage | null = null;
  if (withImg) {
    const s = f32(IMG_SIDE / Math.max(w, h));
    const tw = Math.max(asUsize(roundF32(f32(w * s))), 8);
    const th = Math.max(asUsize(roundF32(f32(h * s))), 8);
    img = {
      w: tw,
      h: th,
      px: resampleArea(gray, w, h, tw, th),
      k: f32(f32(f32(RULES_DPI / 72) * s)),
    };
  }
  const rules = withRules ? detectRules(gray, w, h, f32(RULES_DPI / 72)) : null;
  return [rules, img];
}
