// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { BatchOptions, OcriaNanoOptions } from "../interface.js";
import { readImageDpi } from "../ocria/image-page.js";
import type { Detection } from "../ocria/ocr/det.js";
import { OcriaEngine } from "../ocria/ocr/engine.js";
import type { Img } from "../ocria/ocr/img.js";
import { rgbaToRgb } from "../ocria/ocr/pixels.js";
import type { OcrResult } from "../ocria/ocr/types.js";
import type { ParseModels } from "../ocria/pipeline/parse-image.js";
import { parseImage } from "../ocria/pipeline/parse-image.js";
import { tableNetFromOnnx } from "../ocria/table-model/index.js";
import type { BatchItemResult, RunPoolOptions } from "./batch.js";
import { createAsyncQueue, runPool } from "./batch.js";
import { ModelLoader } from "./model-loader.js";
import type { Page } from "./page.js";
import { toPage } from "./page.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";

/**
 * Raw pixels, row-major: 4 bytes per pixel (RGBA), 3 (RGB) or 1 (grey),
 * told apart by the length of `data`.
 */
export type Pixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

/** An image to read: encoded bytes (PNG, JPEG, ...), a platform canvas, or raw pixels. */
export type ImageInput<TCanvas = CoreCanvas> = ArrayBuffer | Uint8Array | TCanvas | Pixels;

/** An image as the pipeline reads it: RGB pixels and the resolution its file states (else 150 dpi). */
export type PageImage = { rgb: Img; dpi: [number, number] };

const DEFAULT_DPI: [number, number] = [150, 150];

function isPixels<T>(image: ImageInput<T>): image is Pixels {
  return (
    typeof image === "object" &&
    image !== null &&
    "data" in image &&
    "width" in image &&
    "height" in image &&
    (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
  );
}

/** RGB pixels from RGBA, RGB or grey data. */
function rgbOf(data: ArrayLike<number>, w: number, h: number): Img {
  const n = w * h;
  if (data.length === n * 4) return { w, h, ch: 3, data: rgbaToRgb(data) };
  if (data.length === n * 3) return { w, h, ch: 3, data: Uint8Array.from(data) };
  if (data.length === n) {
    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) rgb.fill(data[i], i * 3, i * 3 + 3);
    return { w, h, ch: 3, data: rgb };
  }
  throw new TypeError(
    `pixel data of ${data.length} bytes fits no ${w}x${h} RGBA, RGB or grey image`
  );
}

/**
 * OCRia-nano-1 on one platform. Call `initialize()` once, then `convert()` an
 * image, or run a stage yourself: `detect`, `recognize`. The later stages
 * (merge, projection, LayoutNet, blocks, markdown) are exported functions over
 * `Page.parsed`. Call `destroy()` to release the models.
 */
export abstract class BaseOcriaNanoService<TCanvas = CoreCanvas> {
  protected readonly options: OcriaNanoOptions;
  private loader: ModelLoader<TCanvas> | null = null;
  private loaded: ParseModels | null = null;

  protected constructor(
    protected readonly platform: PlatformProvider<TCanvas>,
    options: OcriaNanoOptions = {}
  ) {
    this.options = { ...options };
  }

  protected log(message: string): void {
    if (this.options.verbose) console.log(`[OcriaNanoService] ${message}`);
  }

  /** Whether page headers and footers stay in the markdown (the `keepHeadersFooters` option). */
  public get keepHeadersFooters(): boolean {
    return this.options.keepHeadersFooters ?? false;
  }

  public isInitialized(): boolean {
    return this.loaded !== null;
  }

  /** The loaded models: the OCR engine and LayoutNet (null with `layout: false`). Throws before initialize(). */
  public get models(): ParseModels {
    if (!this.loaded)
      throw new Error("OcriaNanoService is not initialized: call initialize() first");
    return this.loaded;
  }

  /**
   * Load the detector, the router, the Latin recognizer and LayoutNet. The
   * CJK, RTL and world recognizers load on the first line that needs one.
   * Safe to call twice.
   */
  public async initialize(): Promise<void> {
    if (this.loaded) return;
    const loader = new ModelLoader(this.platform, this.options, (m) => this.log(m));
    try {
      const [ocr, layout] = await Promise.all([
        loader.ocrModels(),
        this.options.layout === false ? Promise.resolve(null) : loader.modelAndBytes("layout"),
      ]);
      this.loaded = {
        engine: new OcriaEngine(ocr),
        layout: layout ? tableNetFromOnnx(layout.model, layout.bytes) : null,
      };
      this.loader = loader;
    } catch (err) {
      await loader.release();
      throw err;
    }
    this.log(`ready${this.loaded.layout ? "" : " (LayoutNet off)"}`);
  }

  /** Release the models. The service can be initialized again. */
  public async destroy(): Promise<void> {
    const loader = this.loader;
    this.loader = null;
    this.loaded = null;
    await loader?.release();
  }

  /** An image's RGB pixels and the resolution its file states (150 dpi when it states none). */
  public async toImage(image: ImageInput<TCanvas>): Promise<PageImage> {
    if (image instanceof ArrayBuffer || image instanceof Uint8Array) {
      const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
      // SAFETY: slice() of a Uint8Array's buffer is an ArrayBuffer, never shared.
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      const px = this.platform.pixels(await this.platform.decodeImage(buf));
      return { rgb: rgbOf(px.data, px.width, px.height), dpi: readImageDpi(bytes) };
    }
    if (this.platform.isCanvas(image)) {
      const px = this.platform.pixels(image);
      return { rgb: rgbOf(px.data, px.width, px.height), dpi: DEFAULT_DPI };
    }
    if (isPixels(image))
      return { rgb: rgbOf(image.data, image.width, image.height), dpi: DEFAULT_DPI };
    throw new TypeError("image must be encoded bytes, a canvas, or { data, width, height } pixels");
  }

  /** Parse one image: OCR, tables and layout, markdown. */
  public async convert(image: ImageInput<TCanvas>): Promise<Page> {
    // read first: before initialize() the error names initialize(), not the image
    const models = this.models;
    const { rgb, dpi } = await this.toImage(image);
    const r = await parseImage(models, rgb, {
      dpi,
      keepHeadersFooters: this.keepHeadersFooters,
    });
    return toPage(r.page, r.markdown, r.dpi);
  }

  /** Text lines of one image (the OCR stage): text, confidence and boxes in image pixels. */
  public async recognize(image: ImageInput<TCanvas>): Promise<OcrResult[]> {
    const { engine } = this.models;
    const { rgb } = await this.toImage(image);
    return engine.run(rgb.data, rgb.w, rgb.h);
  }

  /** Line quads (and faint short-token candidates) of one image, from the detector alone. */
  public async detect(image: ImageInput<TCanvas>): Promise<Detection> {
    const { engine } = this.models;
    const { rgb } = await this.toImage(image);
    return engine.det.detectWithFaint(rgb);
  }

  /** Convert many images. Results keep the input order. */
  public async convertBatch(
    images: Iterable<ImageInput<TCanvas>> | AsyncIterable<ImageInput<TCanvas>>,
    options: BatchOptions & { settle: true }
  ): Promise<BatchItemResult<Page>[]>;
  public async convertBatch(
    images: Iterable<ImageInput<TCanvas>> | AsyncIterable<ImageInput<TCanvas>>,
    options?: BatchOptions
  ): Promise<Page[]>;
  public async convertBatch(
    images: Iterable<ImageInput<TCanvas>> | AsyncIterable<ImageInput<TCanvas>>,
    options: BatchOptions = {}
  ): Promise<Page[] | BatchItemResult<Page>[]> {
    const collected: BatchItemResult<Page>[] = [];
    await runPool(
      images,
      this.poolOptions(images, options),
      (image) => this.convert(image),
      (r) => {
        collected[r.index] = r;
      }
    );
    if (options.settle) return collected;
    // Without settle, runPool rethrows the first failure, so every item here is fulfilled.
    return collected.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  }

  /** Convert many images, yielding each result as it finishes (completion order). */
  public async *convertStream(
    images: Iterable<ImageInput<TCanvas>> | AsyncIterable<ImageInput<TCanvas>>,
    options: BatchOptions = {}
  ): AsyncGenerator<BatchItemResult<Page>> {
    const queue = createAsyncQueue<BatchItemResult<Page>>();
    const pump = (async (): Promise<void> => {
      try {
        await runPool(
          images,
          this.poolOptions(images, options),
          (image) => this.convert(image),
          (r) => queue.push(r)
        );
        queue.close();
      } catch (error) {
        queue.fail(error);
      }
    })();
    yield* queue.drain();
    await pump;
  }

  private poolOptions(images: unknown, options: BatchOptions): RunPoolOptions {
    return {
      concurrency: options.concurrency ?? 1,
      settle: options.settle ?? false,
      signal: options.signal,
      onProgress: options.onProgress,
      total: Array.isArray(images) ? images.length : undefined,
    };
  }
}
