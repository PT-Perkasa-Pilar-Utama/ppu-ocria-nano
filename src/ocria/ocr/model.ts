// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// One ONNX session and the Tensor constructor of the runtime that made it. The
// pipeline takes these as arguments, so it runs on onnxruntime-node, -web and
// -react-native alike (stands in for liteparse's ocr/ocria/pool.rs).

import type { InferenceSession, Tensor } from "onnxruntime-common";

import { output } from "../util.js";

export type TensorCtor = typeof Tensor;

export type Model = { session: InferenceSession; Tensor: TensorCtor };

/** Run a model whose one input is the float32 tensor `x`, and return the named outputs. */
export async function infer(
  model: Model,
  shape: readonly number[],
  x: Float32Array,
  outputs: readonly string[]
): Promise<Record<string, Tensor>> {
  const res = await model.session.run({ x: new model.Tensor("float32", x, shape) });
  const out: Record<string, Tensor> = {};
  for (const name of outputs) out[name] = output(res, name);
  return out;
}
