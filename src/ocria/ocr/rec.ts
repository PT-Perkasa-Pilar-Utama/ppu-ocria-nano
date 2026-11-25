// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/rec.rs (crates-v2.21.2, Apache-2.0).

// Line recognizers (CTC, decoded in-graph) and the script router.

import { asUsize, clamp, cp, f32, roundTiesEven } from "../rust.js";
import { floats, ints } from "../util.js";
import { visualToLogical } from "./bidi-visual.js";
import type { Img } from "./img.js";
import { resizeArea, resizeLinear, toGray } from "./img.js";
import type { Model } from "./model.js";
import { infer } from "./model.js";

/** Recognizer input height. */
export const H = 32;
const STRIDE = 4;
const MAX_W = 1280;
const BUCKET_W = 128;
const BATCH = 32;

/** The script groups, in the order of the router's `group` output. */
export const GROUPS = ["latin", "cjk", "rtl", "world"] as const;
export type ScriptGroup = (typeof GROUPS)[number];

/** A line's text and mean character confidence (f32). */
export type Reading = { text: string; conf: number };

/** Grey line image at height `H`, width scaled with the aspect ratio. */
function prep(crop: Img, minW: number, maxW: number): Img {
  const g = toGray(crop);
  const nw = clamp(asUsize(roundTiesEven((g.w * H) / Math.max(g.h, 1))), minW, maxW);
  return g.h > H ? resizeArea(g, nw, H) : resizeLinear(g, nw, H);
}

function isRtlChar(c: string): boolean {
  const u = cp(c);
  return (u >= 0x0590 && u <= 0x08ff) || (u >= 0xfb1d && u <= 0xfeff);
}

export class Recognizer {
  private constructor(
    public readonly model: Model,
    private readonly charset: readonly string[],
    /** Exported in visual order: RTL readings are reordered to logical order. */
    private readonly visualRtl: boolean,
    /** Input pixels per output timestep (4 or 8). */
    private readonly stride: number
  ) {}

  /** A recognizer, with its timestep stride measured by one probe run. */
  public static async create(
    model: Model,
    charset: readonly string[],
    visualRtl: boolean
  ): Promise<Recognizer> {
    const res = await infer(model, [1, 1, H, 64], new Float32Array(H * 64).fill(1), ["ids"]);
    // SAFETY: infer returns every output it was asked for.
    const steps = Number(res.ids.dims[1]);
    return new Recognizer(model, charset, visualRtl, Math.floor(64 / Math.max(steps, 1)));
  }

  /**
   * (text, confidence) per crop. Lines are batched by width (sorted, 32 per
   * batch, padded to a multiple of 128 px) exactly as the reference does: a
   * line's output depends on the padded width it was run at.
   */
  public async read(crops: readonly Img[]): Promise<Reading[]> {
    const lines = crops.map((c) => prep(c, STRIDE * 2, MAX_W));
    const order = lines.map((_, i) => i).sort((a, b) => lines[a].w - lines[b].w);
    const out: Reading[] = lines.map(() => ({ text: "", conf: 0 }));
    for (let start = 0; start < order.length; start += BATCH) {
      const idx = order.slice(start, start + BATCH);
      let maxw = 1;
      for (const i of idx) maxw = Math.max(maxw, lines[i].w);
      const w = Math.ceil(maxw / BUCKET_W) * BUCKET_W;
      const x = new Float32Array(idx.length * H * w).fill(1);
      idx.forEach((i, j) => {
        const l = lines[i];
        for (let y = 0; y < H; y++) {
          for (let xx = 0; xx < l.w; xx++) {
            x[(j * H + y) * w + xx] = l.data[y * l.w + xx] / 127.5 - 1;
          }
        }
      });
      const res = await infer(this.model, [idx.length, 1, H, w], x, ["ids", "conf"]);
      // SAFETY: infer returns every output it was asked for.
      const ids = ints(res.ids);
      const conf = floats(res.conf);
      const tAll = Number(res.ids.dims[1]);
      idx.forEach((i, j) => {
        const t = Math.min(Math.floor(lines[i].w / this.stride), tAll);
        let text = "";
        let sum = 0;
        let n = 0;
        let prev = 0;
        for (let k = 0; k < t; k++) {
          const c = ids[j * tAll + k];
          if (c !== 0 && c !== prev) {
            const s = this.charset[c - 1];
            if (s !== undefined) text += s;
            sum += conf[j * tAll + k];
            n++;
          }
          prev = c;
        }
        if (this.visualRtl && Array.from(text).some(isRtlChar)) text = visualToLogical(text);
        out[i] = { text, conf: n === 0 ? 0 : f32(sum / n) };
      });
    }
    return out;
  }
}

const ROUTER_W = 512;
const ROUTER_BATCH = 64;
const OVERRIDE = f32(0.9);
const MIN_ASPECT = 4;
const FLIP_MIN_LINES = 3;
const FLIP_VOTE = 0.7;
const OTHER_SHARE = 0.65;

/** The router's decision for a page's lines. */
export type Routing = {
  /** Group index per crop (into `GROUPS`). */
  groups: number[];
  /** Whether the page reads upside down. */
  flip: boolean;
  /** Each group's share of the line width (f64). */
  share: [number, number, number, number];
};

function softmax(z: ArrayLike<number>): number[] {
  let m = -Infinity;
  for (let i = 0; i < z.length; i++) m = Math.max(m, z[i]);
  const e: number[] = [];
  let s = 0;
  for (let i = 0; i < z.length; i++) {
    const v = f32(Math.exp(f32(z[i] - m)));
    e.push(v);
    s = f32(s + v);
  }
  return e.map((v) => f32(v / s));
}

/** np.argmax: the first maximum. */
export function argmax(v: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

export class Router {
  public constructor(public readonly model: Model) {}

  private static prep(crop: Img, x: Float32Array, at: number): void {
    const g = prep(crop, 8, Number.MAX_SAFE_INTEGER);
    // tile short lines across the router width, then cut to it
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < ROUTER_W; xx++) {
        x[at + y * ROUTER_W + xx] = f32(g.data[y * g.w + (xx % g.w)] / 127.5) - 1;
      }
    }
  }

  /** Group probabilities per crop and P(upside down). */
  private async probs(crops: readonly Img[]): Promise<{ gs: number[][]; fs: number[] }> {
    const gs: number[][] = [];
    const fs: number[] = [];
    for (let start = 0; start < crops.length; start += ROUTER_BATCH) {
      const part = crops.slice(start, start + ROUTER_BATCH);
      const x = new Float32Array(part.length * H * ROUTER_W);
      part.forEach((c, j) => Router.prep(c, x, j * H * ROUTER_W));
      const res = await infer(this.model, [part.length, 1, H, ROUTER_W], x, ["group", "flip"]);
      // SAFETY: infer returns every output it was asked for.
      const g = floats(res.group);
      const f = floats(res.flip);
      for (let j = 0; j < part.length; j++) {
        gs.push(softmax(g.subarray(j * 4, j * 4 + 4)));
        // SAFETY: a two-way softmax has two values.
        fs.push(softmax(f.subarray(j * 2, j * 2 + 2))[1]);
      }
    }
    return { gs, fs };
  }

  /**
   * Page-level routing: every line takes the page's dominant group unless it
   * is long enough to judge and confidently another; Latin unless another
   * group holds a clear majority of the line width.
   */
  public async route(crops: readonly Img[]): Promise<Routing> {
    if (crops.length === 0) return { groups: [], flip: false, share: [0, 0, 0, 0] };
    const { gs, fs } = await this.probs(crops);
    const w = crops.map((c) => c.w);
    let wsum = 0;
    for (const wi of w) wsum += wi;
    const share: [number, number, number, number] = [0, 0, 0, 0];
    gs.forEach((p, i) => {
      for (let k = 0; k < 4; k++) share[k] += p[k] * w[i];
    });
    for (let k = 0; k < 4; k++) share[k] /= wsum;
    let dom = argmax(share);
    if (dom !== 0 && share[dom] <= OTHER_SHARE) dom = 0;
    const groups = gs.map((p, i) => {
      const own = argmax(p);
      const pmax = Math.max(...p);
      const c = crops[i];
      return own !== dom && pmax > OVERRIDE && c.w >= MIN_ASPECT * c.h ? own : dom;
    });
    let vote = 0;
    fs.forEach((f, i) => {
      vote += f * w[i];
    });
    const flip = crops.length >= FLIP_MIN_LINES && vote > FLIP_VOTE * wsum;
    return { groups, flip, share };
  }
}
