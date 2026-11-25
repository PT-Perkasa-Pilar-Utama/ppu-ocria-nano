// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/net.rs `OnnxBackend` and `from_onnx` (crates-v2.21.2, Apache-2.0): LayoutNet through ONNX Runtime.

import type { InferenceSession } from "onnxruntime-common";

import type { Model } from "../ocr/model.js";
import { floats, output } from "../util.js";
import type { ImgInput, Logits, NetConfig } from "./net.js";
import { IMG_SIDE, neutralLogits } from "./net.js";
import { readOnnxMetadata } from "./onnx-header.js";

/** ONNX metadata key holding the model's header (`{"cfg": .., "feat_dim": ..}`, as in the `.bin`). */
export const ONNX_HEADER_KEY = "liteparse.tablenet";

/**
 * The model on one page: feats [n, feat_dim] row-major; pairf [n, n, 2] rule pair inputs (zeros
 * when unknown); img: the page image (null: the image branch has nothing to read).
 */
export type Forward = (
  feats: Float32Array,
  pairf: Float32Array,
  n: number,
  img: ImgInput | null
) => Promise<Logits>;

/** LayoutNet: its header and the function that runs it. */
export type TableNet = { cfg: NetConfig; feat_dim: number; forward: Forward };

/** `TableNet::has_img`: whether the model has an image branch (it then wants `ImgInput`). */
export function hasImg(net: TableNet): boolean {
  return net.cfg.img != null;
}

type Header = { cfg: NetConfig; feat_dim: number };

function parseHeader(json: string): Header {
  const v: unknown = JSON.parse(json);
  if (typeof v !== "object" || v === null || !("cfg" in v) || !("feat_dim" in v)) {
    throw new Error(`the ONNX metadata "${ONNX_HEADER_KEY}" has no cfg and feat_dim`);
  }
  const { cfg, feat_dim } = v;
  if (typeof feat_dim !== "number" || typeof cfg !== "object" || cfg === null) {
    throw new Error(`the ONNX metadata "${ONNX_HEADER_KEY}" is malformed`);
  }
  // SAFETY: the header is written by the model's exporter with NetConfig's fields; `cfg` is an object.
  return { cfg: cfg as NetConfig, feat_dim };
}

/** A float32 model output: its data and dims. */
type FloatOutput = { data: Float32Array; dims: readonly number[] };

function floatOutput(res: InferenceSession.OnnxValueMapType, name: string): FloatOutput {
  const t = output(res, name);
  return { data: floats(t), dims: t.dims };
}

/**
 * The model from its ONNX export: the header comes from the ONNX metadata and every page runs
 * through ONNX Runtime. Throws when the file has no header or no image branch (a model without
 * the image branch ships as `.bin` upstream, which is not ported).
 */
export function tableNetFromOnnx(model: Model, onnxBytes: Uint8Array): TableNet {
  const json = readOnnxMetadata(onnxBytes, ONNX_HEADER_KEY);
  if (json === null) throw new Error(`the ONNX model has no "${ONNX_HEADER_KEY}" metadata`);
  const { cfg, feat_dim } = parseHeader(json);
  if (cfg.img == null) throw new Error("the ONNX model has no image branch");
  const forward: Forward = async (feats, pairf, n, img) => {
    // no image: the ONNX export cannot run (the Rust falls back to neutral logits)
    if (img === null) return neutralLogits(n);
    const fd = Math.floor(feats.length / Math.max(n, 1));
    const { Tensor } = model;
    const boxes = new Float32Array(n * 4);
    img.boxes.forEach((b, i) => boxes.set(b, i * 4));
    const res = await model.session.run({
      feats: new Tensor("float32", feats, [1, n, fd]),
      mask: new Tensor("bool", new Uint8Array(n).fill(1), [1, n]),
      pairf: new Tensor("float32", pairf, [1, n, n, 2]),
      image: new Tensor("float32", img.canvas, [1, 1, IMG_SIDE, IMG_SIDE]),
      boxes: new Tensor("float32", boxes, [1, n, 4]),
      valid: new Tensor("float32", Float32Array.from(img.valid), [1, 2]),
    });
    const node = floatOutput(res, "node");
    const pair = floatOutput(res, "pair");
    const cls = floatOutput(res, "cls");
    return {
      n,
      node: node.data,
      pair: pair.data,
      cls: cls.data,
      n_cls: cls.dims[2],
      n_pair: pair.dims[1],
    };
  };
  return { cfg, feat_dim, forward };
}
