// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/net.rs (crates-v2.21.2, Apache-2.0): the model's config and I/O types.

// The Rust forward pass (`net.rs`'s plain-Rust layers and its `.bin` loader)
// is not ported: `net-onnx.ts` runs tablenet.onnx through ONNX Runtime
// instead, as the Rust does when its ONNX backend is attached.

/** Unit features per row: 66 fed to the encoder + block id + leaf id. */
export const N_IDS = 2;

/** Image branch (tablenet.py ImgBranch): CNN channels and cross-attention layers. */
export type ImgCfg = { c?: number; xattn?: number };

export type NetConfig = {
  d: number;
  layers: number;
  heads: number;
  pair_d: number;
  stack_feats: boolean;
  rule_feats: boolean;
  /** joint layout model: a fifth pair head (same_block) and a block class head */
  layout?: boolean;
  n_cls?: number;
  img?: ImgCfg | null;
};

/** Side of the square canvas the image branch reads (tablenet.py / train_tablenet.IMG_SIDE). */
export const IMG_SIDE = 1024;

/**
 * One page's input to the image branch: the page as grey ink in [0, 1] (white = 0) on the
 * IMG_SIDE x IMG_SIDE canvas, top-left aligned; unit boxes and the real image extent as
 * fractions of the canvas.
 */
export type ImgInput = {
  canvas: Float32Array;
  boxes: Array<[number, number, number, number]>;
  valid: [number, number];
};

/**
 * Node logits [n, 2], pair logits [n_pair, n, n] (row-major) and, from a layout model, block class
 * logits [n, n_cls] (empty otherwise). `n_pair` is 4, or 5 with same_block (layout blocks).
 */
export type Logits = {
  n: number;
  node: Float32Array;
  pair: Float32Array;
  cls: Float32Array;
  n_cls: number;
  n_pair: number;
};

/** `Logits::node`. */
export function logitNode(l: Logits, i: number, k: number): number {
  return l.node[i * 2 + k];
}

/** `Logits::pair`. */
export function logitPair(l: Logits, k: number, i: number, j: number): number {
  return l.pair[(k * l.n + i) * l.n + j];
}

/**
 * Logits that decode to nothing (no tables, links or blocks): the result for a page the model
 * could not run (no image for an image-branch model).
 */
export function neutralLogits(n: number): Logits {
  // no class head and no same_block links: block decoding skips the page
  return {
    n,
    node: new Float32Array(n * 2).fill(-1),
    pair: new Float32Array(4 * n * n).fill(-1),
    cls: new Float32Array(0),
    n_cls: 0,
    n_pair: 4,
  };
}
