// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * @module
 *
 * OCRia-nano-1 for Node.js and Bun: OCR, tables, layout blocks and markdown,
 * ported from LiteParse, on ONNX Runtime.
 *
 * @example
 * ```ts
 * import { OcriaNanoService } from "ppu-ocria-nano";
 *
 * const service = new OcriaNanoService();
 * await service.initialize();
 * const page = await service.convert(imageBytes);
 * console.log(page.markdown);
 * ```
 *
 * The OCRia-nano-1 model files are LlamaIndex's, under the OCRia-nano-1
 * license with use restrictions; they are downloaded at run time. See
 * https://huggingface.co/llamaindex/OCRia-nano-1.
 */

import type { Detection } from "./ocria/ocr/det.js";
import type { ImageInput } from "./core/ocria-nano.service.js";
import { runOneShot } from "./core/one-shot.js";
import type { Page } from "./core/page.js";
import type { OcriaNanoOptions } from "./interface.js";
import { OcriaNanoService } from "./processor/ocria-nano.service.js";

export * from "./exports.js";
export { OcriaNanoService };
export { downloadModels } from "./processor/download-models.js";

/** Parse one image without managing a service: load the models, convert, release. */
export function ocr(image: ImageInput, options?: OcriaNanoOptions): Promise<Page> {
  return runOneShot(
    () => new OcriaNanoService(options),
    (service) => service.convert(image)
  );
}

/** Detect the text lines of one image without managing a service. */
export function detect(image: ImageInput, options?: OcriaNanoOptions): Promise<Detection> {
  return runOneShot(
    () => new OcriaNanoService(options),
    (service) => service.detect(image)
  );
}
