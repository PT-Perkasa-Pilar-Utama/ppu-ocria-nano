// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import type { Canvas } from "ppu-ocv";
import type { CanvasLike } from "ppu-ocv/web";

/** A canvas from any supported platform: node-canvas, HTML canvas, OffscreenCanvas, Skia. */
export type CoreCanvas = Canvas | CanvasLike;

/** RGBA pixels, row-major, 4 bytes per pixel. */
export type Rgba = { data: ArrayLike<number>; width: number; height: number };

/**
 * What the platform-free service needs from a runtime: ONNX Runtime, image
 * decoding and resource loading.
 */
export type PlatformProvider<TCanvas = CoreCanvas> = {
  /** The platform's ONNX Runtime (`onnxruntime-node`, `-web` or `-react-native`). */
  ort: { Tensor: typeof Tensor; InferenceSession: typeof InferenceSession };

  /** Whether a value is this platform's canvas. */
  isCanvas: (image: unknown) => image is TCanvas;

  /** Decode encoded image bytes (PNG, JPEG, WebP, ...) into a canvas. */
  decodeImage: (bytes: ArrayBuffer) => Promise<TCanvas>;

  /** The RGBA pixels of a canvas. */
  pixels: (canvas: TCanvas) => Rgba;

  /**
   * A model file's bytes: `source` itself, a path or URL to read (cached
   * where the platform can), or `defaultUrl` when `source` is undefined.
   */
  loadResource: (
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ) => Promise<ArrayBuffer>;
};
