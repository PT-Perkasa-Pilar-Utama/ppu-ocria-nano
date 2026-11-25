// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/det.rs (crates-v2.21.2, Apache-2.0).

// Text-line detector: a segmentation map from det.onnx, then connected
// components expanded to line quads.

import { asUsize, clamp, f32, remEuclid, roundTiesEven, totalCmp } from "../rust.js";
import { floats } from "../util.js";
import type { Img, Pt, Quad } from "./img.js";
import { resizeArea } from "./img.js";
import { boxPoints, components4, minAreaRect } from "./geometry.js";
import { faintBoxes } from "./det-faint.js";
import { mergeCollinear } from "./det-merge.js";
import { minX, minY, norm, orderQuad } from "./quad.js";
import type { Model } from "./model.js";
import { infer } from "./model.js";

/** Kernel shrink ratio the detector targets were built with. */
const SHRINK = f32(0.3);
const MIN_SCORE = f32(0.6);

/**
 * Short tokens the detector scores under its threshold (a lone "1" in a table
 * cell looks like a rule fragment). Regions of the probability map above
 * `thresh` that touch no detected line become candidate boxes when they sit in
 * the middle of a detected line's row; at most `max` per page, strongest first.
 */
export type Faint = { thresh: number; max: number };

/**
 * A second detection pass for small print: when the median line height at the
 * first pass's scale is under `minH` input pixels (and the page has at least 8
 * lines), detect again with the long side scaled to bring lines to `targetH`,
 * at most `maxSide`.
 */
export type Adaptive = { minH: number; targetH: number; maxSide: number };

export type DetectorOptions = {
  longSide: number;
  /** Probability threshold (f32). */
  thresh: number;
  /** Join collinear boxes with gaps under this many line heights (0 = off). */
  merge: number;
  adaptive?: Adaptive;
  faint?: Faint;
};

/** Line quads and the faint short-token candidates of the same pass. */
export type Detection = { boxes: Quad[]; faint: Quad[] };

export class Detector {
  private readonly thresh: number;
  private readonly merge: number;

  public constructor(
    private readonly model: Model,
    private readonly opts: DetectorOptions
  ) {
    this.thresh = f32(opts.thresh);
    this.merge = f32(opts.merge);
  }

  /** Line quads (TL, TR, BR, BL along the line) in `img` pixels, in reading-ish order. */
  public async detect(img: Img): Promise<Quad[]> {
    return (await this.detectWithFaint(img)).boxes;
  }

  /** Line quads as `detect`, and the faint short-token candidates of the same pass. */
  public async detectWithFaint(img: Img): Promise<Detection> {
    const first = await this.detectAt(img, this.opts.longSide);
    const a = this.opts.adaptive;
    if (!a || first.boxes.length < 8) return first;
    const hs = first.boxes
      .map((q) => f32(norm(f32(q[3][0] - q[0][0]), f32(q[3][1] - q[0][1])) * f32(first.scale)))
      .sort(totalCmp);
    const med = Math.max(hs[hs.length >> 1], 1);
    if (med >= f32(a.minH)) return first;
    const side =
      Math.floor(
        Math.min(asUsize(f32(f32(f32(this.opts.longSide) * f32(a.targetH)) / med)), a.maxSide) / 32
      ) * 32;
    if (side <= this.opts.longSide) return first;
    return this.detectAt(img, side);
  }

  /**
   * One detection pass with the page's long side resized to `longSide` (never
   * enlarged); also returns the resize scale.
   */
  private async detectAt(img: Img, longSide: number): Promise<Detection & { scale: number }> {
    const bigH = img.h;
    const bigW = img.w;
    const s = Math.min(longSide / Math.max(bigH, bigW), 1);
    const h = Math.max(32, asUsize(roundTiesEven((bigH * s) / 32)) * 32);
    const w = Math.max(32, asUsize(roundTiesEven((bigW * s) / 32)) * 32);
    const sx = w / bigW;
    const sy = h / bigH;
    const small = resizeArea(img, w, h);
    const hw = h * w;
    const x = new Float32Array(3 * hw);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < hw; i++) x[c * hw + i] = f32(small.data[i * 3 + c] / 127.5) - 1;
    }
    const res = await infer(this.model, [1, 3, h, w], x, ["prob"]);
    // SAFETY: infer returns every output it was asked for.
    const probT = res.prob;
    const ph = Number(probT.dims[2]);
    const pw = Number(probT.dims[3]);
    const prob = floats(probT);
    const stride = Math.floor(h / ph);
    const mask = new Uint8Array(prob.length);
    for (let i = 0; i < prob.length; i++) mask[i] = prob[i] > this.thresh ? 1 : 0;
    let boxes: Quad[] = [];
    for (const comp of components4(mask, pw, ph)) {
      if (comp.pixels.length < 2) continue;
      let sum = 0;
      for (const p of comp.pixels) sum += prob[p];
      if (f32(sum / comp.pixels.length) < MIN_SCORE) continue;
      // the hull of the component's pixel cells: each row's leftmost and rightmost cell
      const rows = comp.y1 - comp.y0 + 1;
      const lo = Array.from({ length: rows }, (): number => Infinity);
      const hi = Array.from({ length: rows }, (): number => 0);
      for (const p of comp.pixels) {
        const px = p % pw;
        const r = (p - px) / pw - comp.y0;
        if (px < lo[r]) lo[r] = px;
        if (px > hi[r]) hi[r] = px;
      }
      const pts: Pt[] = [];
      for (let i = 0; i < rows; i++) {
        const x0 = lo[i];
        if (x0 === Infinity) continue;
        const x1 = hi[i];
        const y = comp.y0 + i;
        for (const [qx, qy] of [
          [x0, y],
          [x0, y + 1],
          [x1 + 1, y],
          [x1 + 1, y + 1],
        ] as const) {
          pts.push([f32(qx * stride), f32(qy * stride)]);
        }
      }
      const r = minAreaRect(pts);
      // line height is the side nearer vertical, not the shorter side: a
      // single digit's kernel is taller than it is wide
      const wIsHorizontal = Math.abs(f32(remEuclid(f32(r.angle + 90), 180) - 90)) < 45;
      const kernelH = wIsHorizontal ? r.h : r.w;
      const lineH = f32(kernelH / f32(1 - f32(2 * SHRINK)));
      const d = f32(SHRINK * lineH);
      r.w = f32(r.w + f32(2 * d));
      r.h = f32(r.h + f32(2 * d));
      const quad = boxPoints(r);
      for (const p of quad) {
        p[0] = clamp(f32(p[0] / sx), 0, img.w);
        p[1] = clamp(f32(p[1] / sy), 0, img.h);
      }
      boxes.push(orderQuad(quad));
    }
    if (this.merge > 0) boxes = mergeCollinear(boxes, this.merge);
    // (row band of 8 px, then left edge); a stable sort
    boxes.sort(
      (a, b) =>
        totalCmp(roundTiesEven(minY(a) / 8), roundTiesEven(minY(b) / 8)) ||
        totalCmp(minX(a), minX(b))
    );
    const f = this.opts.faint;
    const faint = f
      ? faintBoxes(
          prob,
          mask,
          pw,
          ph,
          (cx, cy) => [f32(f32(cx * stride) / sx), f32(f32(cy * stride) / sy)],
          boxes,
          f,
          img
        )
      : [];
    return { boxes, faint, scale: s };
  }
}
