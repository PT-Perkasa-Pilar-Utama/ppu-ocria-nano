// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `raster_identity` test of liteparse crates/liteparse/src/table_model/features.rs
// (crates-v2.21.2), ported: the previous raster path, kept as the reference the bitset path
// must match bit for bit, on synthetic renders.

import { describe, expect, test } from "bun:test";

import type { RawRaster } from "../../src/ocria/image-page.js";
import { roundF32 } from "../../src/ocria/rust-extra.js";
import { asUsize, f32 } from "../../src/ocria/rust.js";
import type { PageImage } from "../../src/ocria/table-model/features-raster.js";
import { processRaster, RULES_DPI } from "../../src/ocria/table-model/features-raster.js";
import type { Rules } from "../../src/ocria/table-model/features.js";
import { IMG_SIDE } from "../../src/ocria/table-model/net.js";

const DARK = 170;

/** `resample_area_ref`: the weights as one list per output, sums with `iter().sum()`. */
function resampleAreaRef(
  g: Float32Array,
  w: number,
  h: number,
  tw: number,
  th: number
): Uint8Array {
  const weights = (nIn: number, nOut: number): Array<Array<[number, number]>> => {
    const f = f32(nIn / nOut);
    return Array.from({ length: nOut }, (_, o) => {
      const [a, b] = [f32(o * f), f32(f32(o + 1) * f)];
      const v: Array<[number, number]> = [];
      let i = Math.floor(a);
      while (i < b && i < nIn) {
        const cov = Math.max(f32(Math.min(b, f32(i + 1)) - Math.max(a, i)), 0);
        if (cov > 0) v.push([i, f32(cov / f)]);
        i += 1;
      }
      return v;
    });
  };
  const [wx, wy] = [weights(w, tw), weights(h, th)];
  const tmp = new Float32Array(h * tw);
  for (let y = 0; y < h; y++) {
    wx.forEach((ws, x) => {
      let s = 0;
      for (const [i, c] of ws) s = f32(s + f32(g[y * w + i] * c));
      tmp[y * tw + x] = s;
    });
  }
  const out = new Uint8Array(th * tw);
  wy.forEach((ws, y) => {
    for (let x = 0; x < tw; x++) {
      let v = 0;
      for (const [i, c] of ws) v = f32(v + f32(tmp[i * tw + x] * c));
      out[y * tw + x] = Math.min(Math.max(roundF32(v), 0), 255);
    }
  });
  return out;
}

type Run = [number, number];

function root(p: number[], k: number): number {
  while (p[k] !== k) {
    p[k] = p[p[k]];
    k = p[k];
  }
  return k;
}

/** `detect_rules_mask_ref`: runs found by a pixel scan of the ink mask. */
function detectRulesMaskRef(dark: Uint8Array, w: number, h: number, scale: number): Rules {
  const lh = Math.max(15, asUsize(f32(w * f32(0.03))));
  const lv = Math.max(15, asUsize(f32(h * f32(0.03))));
  const hruns: Run[][] = Array.from({ length: h }, () => []);
  const vruns: Run[][] = Array.from({ length: w }, () => []);
  const NONE = -1;
  const open = Array.from({ length: w }, () => NONE);
  for (let y = 0; y < h; y++) {
    let start = NONE;
    for (let x = 0; x < w; x++) {
      if (dark[y * w + x] === 1) {
        if (start === NONE) start = x;
        if (open[x] === NONE) open[x] = y;
      } else {
        if (start !== NONE) {
          if (x - start >= lh) hruns[y].push([start, x - 1]);
          start = NONE;
        }
        const o = open[x];
        if (o !== NONE) {
          if (y - o >= lv) vruns[x].push([o, y - 1]);
          open[x] = NONE;
        }
      }
    }
    if (start !== NONE && w - start >= lh) hruns[y].push([start, w - 1]);
  }
  open.forEach((o, x) => {
    if (o !== NONE && h - o >= lv) vruns[x].push([o, h - 1]);
  });
  const out: Rules = { h: [], v: [] };
  for (const [axis, runs] of [
    [0, hruns],
    [1, vruns],
  ] as const) {
    const ids: Array<[number, number, number]> = [];
    const first = Array.from({ length: runs.length + 1 }, () => 0);
    runs.forEach((rs, line) => {
      first[line] = ids.length;
      for (const [s, e] of rs) ids.push([line, s, e]);
    });
    first[runs.length] = ids.length;
    const parent = ids.map((_, i) => i);
    for (let line = 1; line < runs.length; line++) {
      for (let a = first[line - 1]; a < first[line]; a++) {
        for (let b = first[line]; b < first[line + 1]; b++) {
          const [, s0, e0] = ids[a];
          const [, s1, e1] = ids[b];
          if (s1 <= e0 + 1 && e1 + 1 >= s0) {
            const [ra, rb] = [root(parent, a), root(parent, b)];
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
    }
    const comp: Array<[number, number, number, number] | null> = ids.map(() => null);
    ids.forEach(([line, s, e], k) => {
      const r = root(parent, k);
      const c = (comp[r] ??= [Infinity, 0, Infinity, 0]);
      c[0] = Math.min(c[0], line);
      c[1] = Math.max(c[1], line);
      c[2] = Math.min(c[2], s);
      c[3] = Math.max(c[3], e);
    });
    const round1 = (v: number): number => f32(roundF32(f32(v * 10)) / 10);
    for (const c of comp) {
      if (c === null) continue;
      const [l0, l1, s, e] = c;
      const thick = f32(l1 - l0 + 1);
      if (thick > f32(f32(2.5) * scale)) continue;
      const along = f32(e - s + 1);
      const mid = f32(f32(l0 + f32(thick / 2)) / scale);
      const rule: [number, number, number] = [
        round1(mid),
        round1(f32(s / scale)),
        round1(f32(f32(s + along) / scale)),
      ];
      (axis === 0 ? out.h : out.v).push(rule);
    }
  }
  return out;
}

/** `process_raster_ref`: the previous raster path. */
function processRasterRef(
  raw: RawRaster,
  withRules: boolean,
  withImg: boolean
): [Rules | null, PageImage | null] {
  const { w, h, stride, bpp, buf } = raw;
  const lum = (p: number): number =>
    bpp === 1 ? buf[p] : (4899 * buf[p] + 9617 * buf[p + 1] + 1868 * buf[p + 2] + (1 << 13)) >>> 14;
  let img: PageImage | null = null;
  if (withImg && w > 0 && h > 0) {
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) g[y * w + x] = lum(y * stride + x * bpp);
    }
    const s = f32(IMG_SIDE / Math.max(w, h));
    const tw = Math.max(asUsize(roundF32(f32(w * s))), 8);
    const th = Math.max(asUsize(roundF32(f32(h * s))), 8);
    img = { w: tw, h: th, px: resampleAreaRef(g, w, h, tw, th), k: f32(f32(RULES_DPI / 72) * s) };
  }
  if (!withRules) return [null, img];
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) dark[y * w + x] = lum(y * stride + x * bpp) < DARK ? 1 : 0;
  }
  return [detectRulesMaskRef(dark, w, h, f32(RULES_DPI / 72)), img];
}

/** A synthetic render with ruled rows and columns, thick bars and speckle (xorshift64 on 32-bit halves). */
function synthetic(w: number, h: number, bpp: number, seed: number): RawRaster {
  const stride = w * bpp + 7;
  let hi = 0;
  let lo = seed >>> 0;
  const rnd = (m: number): number => {
    hi = (hi ^ ((hi << 13) | (lo >>> 19))) >>> 0;
    lo = (lo ^ (lo << 13)) >>> 0;
    lo = (lo ^ ((lo >>> 7) | (hi << 25))) >>> 0;
    hi = (hi ^ (hi >>> 7)) >>> 0;
    hi = (hi ^ ((hi << 17) | (lo >>> 15))) >>> 0;
    lo = (lo ^ (lo << 17)) >>> 0;
    return ((((hi % m) * (2 ** 32 % m)) % m) + (lo % m)) % m;
  };
  const buf = new Uint8Array(stride * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ink =
        (y % 37 < 2 && x > Math.floor(w / 10)) ||
        (x % 53 < 2 && y > Math.floor(h / 7)) ||
        (x % 211 < 120 && y % 300 < 6) ||
        rnd(9) === 0;
      const v = ink ? rnd(160) : 170 + rnd(86);
      for (let c = 0; c < bpp; c++) buf[y * stride + x * bpp + c] = (v + c * 3) & 0xff;
    }
  }
  return { w, h, stride, bpp, buf };
}

describe("features.rs raster_identity", () => {
  const shapes: Array<[number, number, number]> = [
    [1275, 1650, 4],
    [130, 97, 4],
    [64, 64, 1],
    [65, 300, 3],
    [1650, 1275, 4],
    [1, 40, 4],
  ];
  test.each(shapes.map((s, k) => [...s, k] as const))(
    "%ix%i, %i bytes per pixel",
    (w, h, bpp, k) => {
      const r = synthetic(w, h, bpp, 0x9e3779b9 + k);
      for (const [rules, img] of [
        [true, true],
        [true, false],
        [false, true],
      ] as const) {
        const got = processRaster(r, rules, img);
        const want = processRasterRef(r, rules, img);
        expect(got[0], `rules ${w}x${h}x${bpp}`).toEqual(want[0]);
        expect(got[1], `image ${w}x${h}x${bpp}`).toEqual(want[1]);
      }
    }
  );

  test("a render of no pixels has no image and empty rules", () => {
    const empty: RawRaster = { w: 0, h: 0, stride: 0, bpp: 4, buf: new Uint8Array(0) };
    expect(processRaster(empty, true, true)).toEqual([{ h: [], v: [] }, null]);
    expect(processRaster(empty, false, false)).toEqual([null, null]);
  });
});
