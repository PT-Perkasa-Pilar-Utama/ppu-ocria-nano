// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { BaseOcriaNanoService } from "../core/ocria-nano.service.js";
import type { CoreCanvas } from "../core/platform.js";
import type { OcriaNanoOptions } from "../interface.js";
import { downloadModels } from "./download-models.js";
import { NodePlatformProvider } from "./platform.node.js";

/**
 * OCRia-nano-1 for Node.js and Bun.
 *
 * @example
 * ```ts
 * import { OcriaNanoService } from "ppu-ocria-nano";
 *
 * const service = new OcriaNanoService();
 * await service.initialize();
 * const page = await service.convert(await Bun.file("scan.png").arrayBuffer());
 * console.log(page.markdown);
 * await service.destroy();
 * ```
 */
export class OcriaNanoService extends BaseOcriaNanoService<CoreCanvas> {
  public constructor(options: OcriaNanoOptions = {}) {
    super(new NodePlatformProvider(options.verbose), options);
  }

  /**
   * Download the model files into the disk cache (~/.cache/ppu-ocria-nano)
   * and check them against their pins, without loading them, so later runs
   * need no network. `layout: false` leaves out LayoutNet.
   */
  public static downloadModels(
    options: { layout?: boolean; verbose?: boolean } = {}
  ): Promise<void> {
    return downloadModels(options);
  }
}
