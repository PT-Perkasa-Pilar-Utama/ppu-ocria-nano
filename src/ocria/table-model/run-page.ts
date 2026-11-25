// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs `run_page` and `run_page_framed` (crates-v2.21.2, Apache-2.0): the page-level entry.

// `run_page_framed` is split at the golden checkpoints (units, features, logits,
// model) into `framedUnits`, `framedFeatures` and `pageModelFromLogits`, so each
// step can be tested on upstream's recorded input. The network runs through ONNX
// Runtime (`net-onnx.ts`), so `runPage` is async.

import { charCount, f32 } from "../rust.js";
import type { ProjSignals } from "../projection/signals.js";
import type { DecodeOptions } from "./decode.js";
import type { FUnit, Proj, Rules } from "./features.js";
import { pairRuleFeatures, unitFeatures } from "./features.js";
import type { PageImage } from "./features-raster.js";
import { pageImageInput } from "./features-raster.js";
import type { ImgInput, Logits } from "./net.js";
import type { TableNet } from "./net-onnx.js";
import { hasImg } from "./net-onnx.js";
import { pageModelFromLogits } from "./page-model.js";
import type { PageInput } from "./page-input.js";
import { MAX_UNITS, pageInputRaster } from "./page-input.js";
import { mainRotation, modelToPage, uprightInput } from "./rotate.js";
import { joinSignals, ocrUnits } from "./signals.js";
import type { PageModel } from "./types.js";
import type { Unit } from "./units.js";

/** The units a framed page is read from, with each one's projection signals and `FUnit`. */
export type FramedUnits = { units: Unit[]; fu: FUnit[] };

/** `PageModel::default()`. */
export function emptyPageModel(): PageModel {
  return { tables: [], classes: [], blocks: [] };
}

/**
 * The page's units (from the input, or from the OCR items of an OCR page) with the features'
 * view of them. Null when the page has too few or too many units, or too little text, for the
 * model (or is an OCR page without projection signals): the page model is then empty.
 */
export function framedUnits(input: PageInput, sig: ProjSignals | null): FramedUnits | null {
  let units: Unit[];
  let proj: Array<Proj | null>;
  if (input.ocr) {
    if (sig === null) return null;
    [units, proj] = ocrUnits(input, sig);
  } else {
    proj = sig === null ? input.units.map(() => null) : joinSignals(input, sig);
    units = input.units;
  }
  const n = units.length;
  if (n < 2 || n > MAX_UNITS || units.reduce((s, u) => s + charCount(u.text), 0) < 20) return null;
  const f32x4 = (b: readonly number[]): [number, number, number, number] => [
    f32(b[0]),
    f32(b[1]),
    f32(b[2]),
    f32(b[3]),
  ];
  const fu = units.map((u, i): FUnit => ({
    bx: f32x4(u.bx),
    pbox: f32x4(u.pbox),
    text: u.text,
    h: f32(u.h),
    bold: u.bold,
    proj: proj[i],
  }));
  return { units, fu };
}

/** The network's inputs: unit features, rule pair features, and the image input when the model reads one. */
export type FramedFeatures = { feats: Float32Array; pairf: Float32Array; img: ImgInput | null };

/** `unit_features`, `pair_rule_features` and the image input of a framed page. */
export function framedFeatures(
  fu: readonly FUnit[],
  wh: readonly [number, number],
  rules: Rules | null,
  pageImg: PageImage | null,
  modelReadsImg: boolean
): FramedFeatures {
  const n = fu.length;
  const feats = unitFeatures(fu, [f32(wh[0]), f32(wh[1])], rules);
  const pairf = rules
    ? pairRuleFeatures(
        fu.map((u) => u.pbox),
        rules
      )
    : new Float32Array(n * n * 2);
  const img =
    pageImg !== null && modelReadsImg
      ? pageImageInput(
          pageImg,
          fu.map((u) => u.pbox)
        )
      : null;
  return { feats, pairf, img };
}

/** The page's tables: features, model, decoding. */
export async function runPageFramed(
  net: TableNet,
  layoutNet: TableNet | null,
  input: PageInput,
  sig: ProjSignals | null,
  opt: DecodeOptions
): Promise<PageModel> {
  const framed = framedUnits(input, sig);
  if (framed === null) return emptyPageModel();
  const { units, fu } = framed;
  const [deferredRules, deferredImg] = pageInputRaster(input);
  const rules = input.rules ?? deferredRules;
  const pageImg = input.img ?? deferredImg;
  const f = framedFeatures(
    fu,
    input.wh,
    rules,
    pageImg,
    hasImg(net) || (layoutNet !== null && hasImg(layoutNet))
  );
  const n = units.length;
  const logits: Logits = await net.forward(f.feats, f.pairf, n, f.img);
  const layoutLogits =
    layoutNet !== null && layoutNet.feat_dim === net.feat_dim
      ? await layoutNet.forward(f.feats, f.pairf, n, f.img)
      : null;
  return pageModelFromLogits(units, logits, layoutLogits, layoutNet !== null, opt);
}

/**
 * Run the model on one page. A page whose text mostly runs in one rotated direction (a table
 * set sideways) is turned upright first: units, ruling lines and the page image all go into that
 * reading frame, which is how the model saw tables in training, and every box it returns comes
 * back to the page. Left as is, the units' reading-frame geometry and the sideways render
 * disagree and the model finds a fragment of the table.
 */
export async function runPage(
  net: TableNet,
  layoutNet: TableNet | null,
  input: PageInput,
  sig: ProjSignals | null,
  opt: DecodeOptions
): Promise<PageModel> {
  const q = mainRotation(input);
  if (q === null) return runPageFramed(net, layoutNet, input, sig, opt);
  const [w, h] = input.wh;
  const deferred = pageInputRaster(input);
  const upright = uprightInput(input, input.rules ?? deferred[0], input.img ?? deferred[1], q);
  const pm = await runPageFramed(net, layoutNet, upright, sig, opt);
  return modelToPage(pm, q, w, h);
}
