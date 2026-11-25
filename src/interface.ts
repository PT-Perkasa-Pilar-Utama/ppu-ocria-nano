// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession } from "onnxruntime-common";

import type { ModelFile } from "./model-catalogue.js";

/**
 * Where to read each model file from: a URL, a file path (Node), or the bytes.
 * Files left out come from the pinned OCRia-nano-1 release, checked
 * against their SHA-256; files given here are used as they are.
 */
export type ModelSources = Partial<Record<ModelFile, string | ArrayBuffer>>;

/** ONNX Runtime session options, plus a hook for a silent provider fallback. */
export type SessionOptions = InferenceSession.SessionOptions & {
  /**
   * Execution providers to use (for example "cpu", "cuda", "webgpu", "wasm").
   * @default ['cpu']
   */
  executionProviders?: InferenceSession.SessionOptions["executionProviders"];

  /**
   * Called when session creation with the requested execution providers fails
   * and the service retries with a safe provider (`cpu` or `wasm`). Receives
   * the original error. Never forwarded to ONNX Runtime.
   */
  onSessionFallback?: (error: unknown) => void;
};

/** Options of an OcriaNanoService. */
export type OcriaNanoOptions = {
  /** Per-file model sources. Default: LlamaIndex's repository at the pinned v1.0.0 commit. */
  models?: ModelSources;
  /**
   * Run LayoutNet (tablenet.onnx, 17 MB) for tables, headings and layout
   * blocks. False uses LiteParse's heuristic tables and blocks. Default true.
   */
  layout?: boolean;
  /** Keep page headers and footers in the markdown. Default false. */
  keepHeadersFooters?: boolean;
  /** ONNX Runtime session options for every model. */
  session?: SessionOptions;
  /** Log loading and stage steps to the console. Default false. */
  verbose?: boolean;
};

/** Options of convertBatch and convertStream. */
export type BatchOptions = {
  /**
   * Pages in flight at once. Default 1: each page allocates large tensors,
   * so more pages at once mostly add memory.
   */
  concurrency?: number;
  /** Report a failed image as a rejected item instead of failing the whole batch. Default false. */
  settle?: boolean;
  /** Stops scheduling further images; the batch rejects with an AbortError. */
  signal?: AbortSignal;
  /** Called after each image settles, with the done count and the total when known. */
  onProgress?: (done: number, total: number | undefined) => void;
};
