// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The model's header in the ONNX file's metadata, and the net's inputs and outputs
// (liteparse crates/liteparse/src/table_model/net.rs, crates-v2.21.2): tablenet.onnx on
// ONNX Runtime stands in for the plain-Rust forward pass.

import { describe, expect, test } from "bun:test";

import { ModelLoader } from "../../src/core/model-loader.js";
import type { Model } from "../../src/ocria/ocr/model.js";
import { IMG_SIDE, logitNode, logitPair, neutralLogits } from "../../src/ocria/table-model/net.js";
import { hasImg, ONNX_HEADER_KEY, tableNetFromOnnx } from "../../src/ocria/table-model/net-onnx.js";
import { readOnnxMetadata } from "../../src/ocria/table-model/onnx-header.js";
import { NodePlatformProvider } from "../../src/processor/platform.node.js";
import { loadTableNet } from "./table-model-fixtures.js";

const enc = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

const str = (field: number, s: string): number[] => [
  (field << 3) | 2,
  ...varint(enc.encode(s).length),
  ...enc.encode(s),
];

/** A ModelProto with a `metadata_props` entry, after a fixed32, a fixed64, a varint and a graph. */
function modelBytes(key: string, value: string, other = true): Uint8Array {
  const entry = [...str(1, key), ...str(2, value)];
  const noise = other
    ? [
        (1 << 3) | 0,
        ...varint(300),
        (2 << 3) | 5,
        1,
        2,
        3,
        4,
        (3 << 3) | 1,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        ...str(7, "x".repeat(300)),
      ]
    : [];
  return Uint8Array.from([...noise, (14 << 3) | 2, ...varint(entry.length), ...entry]);
}

const stub = {} as unknown as Model;

describe("ONNX metadata", () => {
  test("the entry is found after other fields", () => {
    expect(readOnnxMetadata(modelBytes("a", "b"), "a")).toBe("b");
    expect(readOnnxMetadata(modelBytes("a", "b"), "other")).toBeNull();
    expect(readOnnxMetadata(new Uint8Array(0), "a")).toBeNull();
  });

  test("a field of an unknown wire type or a cut varint is an error", () => {
    expect(() => readOnnxMetadata(Uint8Array.from([(1 << 3) | 3]), "a")).toThrow("wire type");
    expect(() => readOnnxMetadata(Uint8Array.from([0x80]), "a")).toThrow("varint");
  });

  test("a header needs cfg, feat_dim and an image branch", () => {
    const img = { cfg: { img: { c: 64, xattn: 2 } }, feat_dim: 68 };
    const net = tableNetFromOnnx(stub, modelBytes(ONNX_HEADER_KEY, JSON.stringify(img)));
    expect(net.feat_dim).toBe(68);
    expect(hasImg(net)).toBe(true);
    const none = tableNetFromOnnx.bind(null, stub);
    expect(() => none(modelBytes("other", "{}"))).toThrow("metadata");
    expect(() => none(modelBytes(ONNX_HEADER_KEY, "{}"))).toThrow("cfg and feat_dim");
    expect(() => none(modelBytes(ONNX_HEADER_KEY, '{"cfg":1,"feat_dim":68}'))).toThrow("malformed");
    expect(() => none(modelBytes(ONNX_HEADER_KEY, '{"cfg":{},"feat_dim":68}'))).toThrow(
      "image branch"
    );
    expect(() => none(modelBytes(ONNX_HEADER_KEY, "3"))).toThrow("cfg and feat_dim");
  });
});

describe("tablenet.onnx", () => {
  test("its header says what the model reads", async () => {
    const loader = new ModelLoader(new NodePlatformProvider(), {}, () => {});
    const json = readOnnxMetadata(new Uint8Array(await loader.bytes("layout")), ONNX_HEADER_KEY);
    const header = JSON.parse(json ?? "null") as {
      feat_dim: number;
      cfg: { n_cls: number; layout: boolean; img: unknown };
    };
    expect([header.feat_dim, header.cfg.n_cls, header.cfg.layout]).toEqual([68, 13, true]);
    expect(header.cfg.img).toBeDefined();
    const net = await loadTableNet();
    expect(net.feat_dim).toBe(68);
    expect(hasImg(net)).toBe(true);
  });

  test("without a page image it answers neutral logits", async () => {
    const net = await loadTableNet();
    const l = await net.forward(new Float32Array(3 * 68), new Float32Array(3 * 3 * 2), 3, null);
    expect(l).toEqual(neutralLogits(3));
    expect([l.n_pair, l.n_cls, l.node.length, l.pair.length]).toEqual([4, 0, 6, 36]);
  });

  test("logits are read by unit, head and pair", () => {
    const n = 3;
    const l = neutralLogits(n);
    l.node[2 * 2 + 1] = 7;
    l.pair[(2 * n + 1) * n + 2] = 9;
    expect(logitNode(l, 2, 1)).toBe(7);
    expect(logitPair(l, 2, 1, 2)).toBe(9);
    expect(IMG_SIDE).toBe(1024);
  });
});
