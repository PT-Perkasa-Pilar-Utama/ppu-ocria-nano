// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// LayoutNet's pipeline (src/ocria/table-model) against the parse goldens, one
// step at a time, each fed upstream's recorded input for that step: raster,
// units, features, ONNX logits, decoding.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imagePage, imageRaster, readImageDpi } from "../../src/ocria/image-page.js";
import { defaultDecodeOptions } from "../../src/ocria/table-model/decode.js";
import type { PageImage } from "../../src/ocria/table-model/features-raster.js";
import { pageImageInput, processRaster } from "../../src/ocria/table-model/features-raster.js";
import { FEAT_DIM } from "../../src/ocria/table-model/features.js";
import type { PageInput } from "../../src/ocria/table-model/page-input.js";
import type { PageModel } from "../../src/ocria/table-model/types.js";
import { pageModelFromLogits } from "../../src/ocria/table-model/page-model.js";
import { mainRotation, modelToPage, uprightInput } from "../../src/ocria/table-model/rotate.js";
import { framedFeatures, framedUnits, runPage } from "../../src/ocria/table-model/run-page.js";
import { PAGES_DIR, pagePixels, sha } from "./ocr-golden.js";
import { canon, loadParseGolden, stage } from "./parse-golden.js";
import type { TableCase } from "./table-model-fixtures.js";
import {
  copyLogits,
  IS_IMAGE,
  loadTableNet,
  recordedModel,
  tableCases,
} from "./table-model-fixtures.js";

const cases = tableCases();
const opt = defaultDecodeOptions();

/** The page as the model reads it: upright in its main reading direction (null: already upright). */
function rotationOf(c: TableCase): number | null {
  return mainRotation(c.input);
}

/** The framed page: `input` itself, or turned upright with the recorded raster (rotated pages). */
function framedInput(
  c: TableCase,
  raster: { rules: PageInput["rules"]; img: PageImage | null }
): PageInput {
  const q = rotationOf(c);
  const input = { ...c.input, rules: raster.rules, img: raster.img };
  // the recorded raster of a rotated page is already upright
  return q === null
    ? input
    : {
        ...c.input,
        units: uprightInput(c.input, null, null, q).units,
        wh: uprightInput(c.input, null, null, q).wh,
        rules: raster.rules,
        img: raster.img,
      };
}

/** The recorded image as a `PageImage`; the pixels are only a hash, so a PDF's are zeros. */
function recordedImage(c: TableCase): PageImage | null {
  const im = c.raster.img;
  return im === null ? null : { w: im.w, h: im.h, px: new Uint8Array(im.w * im.h), k: im.k };
}

const bits = new Int32Array(2);
const bitsF = new Float32Array(bits.buffer);

/** The distance in f32 steps between two f32 values of the same sign. */
function ulps(a: number, b: number): number {
  bitsF[0] = a;
  bitsF[1] = b;
  return Math.abs(bits[0] - bits[1]);
}

/** The indices where two number arrays differ (+0 and -0 are one value). */
function diffs(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  if (a.length !== b.length) throw new Error(`lengths ${a.length} and ${b.length}`);
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i] === 0 ? 0 : a[i], b[i] === 0 ? 0 : b[i])) out.push(i);
  }
  return out;
}

/**
 * `got` with each class probability replaced by the recorded one when the two are within `tol`
 * (relative): the probabilities come from `exp`, which Rust takes from the platform's libm
 * (Apple's `expf` here, which is not correctly rounded; JavaScript's `Math.exp` rounds once).
 */
function withRecordedProbs(got: PageModel, want: PageModel, tol: number): PageModel {
  return {
    ...got,
    classes: got.classes.map((c, i) => {
      const w = want.classes[i]?.probs;
      if (w === undefined || w.length !== c.probs.length) return c;
      const close = c.probs.every(
        (p, k) => Math.abs(p - w[k]) <= tol * Math.max(Math.abs(w[k]), 1e-30)
      );
      return close ? { ...c, probs: w } : c;
    }),
  };
}

/** The PNG page's raster, from the image as LiteParse reads it. */
async function pngRaster(c: TableCase): Promise<ReturnType<typeof imageRaster>> {
  const bytes = new Uint8Array(readFileSync(join(PAGES_DIR, c.image)));
  const img = await pagePixels(c.image);
  return imageRaster(img, imagePage(img.w, img.h, readImageDpi(bytes)));
}

describe.each(cases)("$name", (c) => {
  const q = rotationOf(c);

  test.if(IS_IMAGE(c.image))("raster: the image's render gives table.raster", async () => {
    const g = loadParseGolden(c.name);
    const raw = await pngRaster(c);
    const want = stage(g, "table.raw") as { w: number; h: number; sha: string };
    expect({ w: raw.w, h: raw.h, sha: sha(raw.buf) }).toEqual(want);
    const [rules, img] = processRaster(raw, true, true);
    expect(canon(rules)).toEqual(canon(c.raster.rules));
    const wantImg = c.raster.img;
    if (img === null || wantImg === null) throw new Error("the raster has no image");
    expect({ w: img.w, h: img.h, k: img.k, px: sha(img.px) }).toEqual(wantImg);
  });

  test("units: input and signals give table.units", () => {
    const upright = q === null ? c.input : uprightInput(c.input, null, null, q);
    const framed = framedUnits(upright, c.sig);
    expect(framed).not.toBeNull();
    // units are f64: compared without rounding, apart from the dropped defaults
    expect(JSON.parse(JSON.stringify(framed?.units))).toEqual(JSON.parse(JSON.stringify(c.units)));
    expect(canon(framed?.fu)).toEqual(canon(c.fu));
  });

  test("features: units and raster give table.feats exactly", async () => {
    const upright = framedInput(c, { rules: c.raster.rules, img: null });
    let im = recordedImage(c);
    if (IS_IMAGE(c.image)) im = processRaster(await pngRaster(c), true, true)[1];
    const f = framedFeatures(c.fu, upright.wh, c.raster.rules, im, true);
    expect(f.feats.length).toBe(c.feats.n * FEAT_DIM);
    // The Fourier columns (21 to 52) are sinf / cosf of the platform's libm; JavaScript rounds
    // the f64 result once, which differs from it by one f32 step in a few values.
    const bad = diffs(f.feats, Float32Array.from(c.feats.feats));
    const fourier = (i: number): boolean => i % FEAT_DIM >= 21 && i % FEAT_DIM < 53;
    const other = bad.filter((i) => !fourier(i));
    expect(
      other.map(
        (i) =>
          `feats[${i}] (row ${Math.floor(i / FEAT_DIM)}, col ${i % FEAT_DIM}): ${f.feats[i]} vs ${c.feats.feats[i]}`
      )
    ).toEqual([]);
    expect(bad.filter((i) => ulps(f.feats[i], c.feats.feats[i]) > 1)).toEqual([]);
    if (bad.length > 0)
      console.log(`${c.name}: ${bad.length} Fourier values differ by one f32 step`);
    expect(diffs(f.pairf, Float32Array.from(c.feats.pairf))).toEqual([]);
    const want = c.feats.img;
    expect(f.img === null).toBe(want === null);
    if (f.img !== null && want !== null) {
      expect(canon(f.img.boxes)).toEqual(canon(want.boxes));
      expect(canon(f.img.valid)).toEqual(canon(want.valid));
      // a PDF's pixels are only recorded as a hash: its canvas cannot be rebuilt
      if (IS_IMAGE(c.image)) {
        expect(sha(new Uint8Array(f.img.canvas.buffer))).toBe(want.canvas_sha);
      }
    }
  });

  test.if(IS_IMAGE(c.image))("logits: ONNX Runtime on the recorded features", async () => {
    const net = await loadTableNet();
    const im = (await (async () =>
      processRaster(await pngRaster(c), true, true)[1])()) as PageImage;
    const input = pageImageInput(
      im,
      c.fu.map((u) => u.pbox)
    );
    const l = await net.forward(
      Float32Array.from(c.feats.feats),
      Float32Array.from(c.feats.pairf),
      c.feats.n,
      input
    );
    expect([l.n, l.n_cls, l.n_pair]).toEqual([c.logits.n, c.logits.n_cls, c.logits.n_pair]);
    let max = 0;
    for (const k of ["node", "pair", "cls"] as const) {
      expect(l[k].length).toBe(c.logits[k].length);
      for (let i = 0; i < l[k].length; i++) max = Math.max(max, Math.abs(l[k][i] - c.logits[k][i]));
    }
    console.log(`${c.name}: max |logit diff| ${max}`);
    expect(max).toBeLessThan(1e-3);
  });

  test("decode: recorded logits give table.model", () => {
    const upright = q === null ? c.input : uprightInput(c.input, null, null, q);
    const framed = framedUnits(upright, c.sig);
    if (framed === null) throw new Error("no framed units");
    const pm = pageModelFromLogits(framed.units, copyLogits(c.logits), null, false, opt);
    const [w, h] = c.input.wh;
    const got = q === null ? pm : modelToPage(pm, q, w, h);
    const want = recordedModel(c);
    expect(canon(withRecordedProbs(got, want, 1e-6))).toEqual(canon(want));
  });

  test.if(IS_IMAGE(c.image))(
    "runPage: raster, features, ONNX and decoding end to end",
    async () => {
      const net = await loadTableNet();
      const raw = await pngRaster(c);
      const input: PageInput = { ...c.input, raw: { raw, rules: true, img: true } };
      const pm = await runPage(net, null, input, c.sig, opt);
      const want = recordedModel(c);
      // ONNX Runtime's logits differ from the recorded ones by up to 2e-5, so the probabilities do too
      expect(canon(withRecordedProbs(pm, want, 1e-3))).toEqual(canon(want));
    }
  );
});
