// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Shared loading for the OCR-stage goldens in tests/fixtures/golden/ocr, which
// LiteParse crates-v2.21.2 wrote through its ocria-nano engine (see
// scripts/golden/README.md).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

import { CanvasProcessor } from "ppu-ocv/canvas";

import { ModelLoader } from "../../src/core/model-loader.js";
import type { ModelFile } from "../../src/model-catalogue.js";
import type { Img, Quad } from "../../src/ocria/ocr/img.js";
import type { Model } from "../../src/ocria/ocr/model.js";
import { rgbaToRgb } from "../../src/ocria/ocr/pixels.js";
import { NodePlatformProvider } from "../../src/processor/platform.node.js";
import type { OcrResult } from "../../src/ocria/ocr/types.js";

/**
 * Whether this host reproduces the goldens' recognizer output exactly. The
 * goldens were recorded on macOS arm64 (an Apple M1). rec_latin.onnx is int8
 * (QDQ), and ONNX Runtime's int8 kernels on x86-64 round differently, which
 * changes some characters on Linux CI (run 45590617365: 24 tests, e.g.
 * "morning" read as "moning"). LiteParse on that host reads the same way.
 * Detection, line crops, routing decisions and every stage fed a recorded
 * input stay exact on every host; the CI parity job runs the rest on macOS
 * arm64. OCRIA_EXACT_OCR=1 or 0 overrides the platform check.
 */
export const EXACT_OCR: boolean =
  process.env.OCRIA_EXACT_OCR === undefined
    ? process.platform === "darwin" && process.arch === "arm64"
    : process.env.OCRIA_EXACT_OCR === "1";

/** 1 - Levenshtein distance / longer length, over UTF-16 code units. */
export function textSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, sub));
    }
    prev = row;
  }
  return 1 - (prev[b.length] ?? 0) / Math.max(a.length, b.length);
}

export const GOLDEN_DIR: string = join(import.meta.dir, "../fixtures/golden/ocr");
export const PAGES_DIR: string = join(import.meta.dir, "../fixtures/pages");

/** One recorded stage value: `k` names the checkpoint, `v` holds what the Rust recorded. */
export type Stage = { k: string; v: unknown };

export type OcrGolden = {
  image: string;
  width: number;
  height: number;
  pixels_sha: string;
  stages: Stage[];
  results: Array<Omit<OcrResult, "polygon" | "faint"> & { polygon: Quad | null; faint?: boolean }>;
};

export type ImgFacts = { w: number; h: number; ch: number; sha: string };

export function goldenNames(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".ocr.json.gz"))
    .map((f) => f.replace(/\.ocr\.json\.gz$/, ""));
}

export function loadGolden(name: string): OcrGolden {
  return JSON.parse(
    gunzipSync(readFileSync(join(GOLDEN_DIR, `${name}.ocr.json.gz`))).toString("utf8")
  ) as OcrGolden;
}

/** Every value recorded under checkpoint `k`, in order. */
export function stages<T>(g: OcrGolden, k: string): T[] {
  return g.stages.filter((s) => s.k === k).map((s) => s.v as T);
}

export function sha(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function facts(img: Img): ImgFacts {
  return { w: img.w, h: img.h, ch: img.ch, sha: sha(img.data) };
}

/** The fixture page as the RGB buffer the engine reads. */
export async function pagePixels(image: string): Promise<Img> {
  const bytes = readFileSync(join(PAGES_DIR, image));
  const canvas = await CanvasProcessor.prepareCanvas(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return { w: rgba.width, h: rgba.height, ch: 3, data: rgbaToRgb(rgba.data) };
}

const loader = new ModelLoader(new NodePlatformProvider(), {}, () => {});

/** A model file's session, from the verified disk cache (tests/preload-warm-cache.ts fills it). */
export function loadModel(file: ModelFile): Promise<Model> {
  return loader.model(file);
}

/** A JSON model file, from the verified disk cache. */
export function readJson<T>(file: ModelFile): Promise<T> {
  return loader.json<T>(file);
}
