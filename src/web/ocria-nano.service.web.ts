// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { BaseOcriaNanoService } from "../core/ocria-nano.service.js";
import type { CoreCanvas } from "../core/platform.js";
import type { OcriaNanoOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

/**
 * OCRia-nano-1 for browsers, web workers and browser extensions. Models are
 * fetched from the pinned release (or `models`); images may be encoded bytes,
 * an HTML or Offscreen canvas, or raw pixels. ONNX Runtime runs on wasm
 * unless `session.executionProviders` asks for more.
 */
export class OcriaNanoService extends BaseOcriaNanoService<CoreCanvas> {
  public constructor(options: OcriaNanoOptions = {}) {
    super(new WebPlatformProvider(), options);
  }
}
