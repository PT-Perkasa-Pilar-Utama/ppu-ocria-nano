// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { ModelLoader } from "../core/model-loader.js";
import type { ModelFile } from "../model-catalogue.js";
import { MODEL_FILES } from "../model-catalogue.js";
import { NodePlatformProvider } from "./platform.node.js";

/**
 * Download the OCRia-nano-1 files into the disk cache (~/.cache/ppu-ocria-nano)
 * and check each against its pin, without loading them, so later runs need no
 * network. `layout: false` leaves out LayoutNet (tablenet.onnx, 17 MB).
 */
export async function downloadModels(
  options: { layout?: boolean; verbose?: boolean } = {}
): Promise<void> {
  const log = (m: string): void => {
    if (options.verbose) console.log(`[OcriaNanoService] ${m}`);
  };
  const loader = new ModelLoader(new NodePlatformProvider(options.verbose), {}, log);
  // SAFETY: Object.keys of a Record<ModelFile, _> lists exactly its ModelFile keys.
  for (const file of Object.keys(MODEL_FILES) as ModelFile[]) {
    if (file === "layout" && options.layout === false) continue;
    await loader.bytes(file);
  }
}
