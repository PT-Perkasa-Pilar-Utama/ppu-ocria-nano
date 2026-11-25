// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { BaseOcriaNanoService } from "../core/ocria-nano.service.js";
import type { CoreCanvas } from "../core/platform.js";
import type { OcriaNanoOptions } from "../interface.js";
import { MobilePlatformProvider } from "./platform.mobile.js";

/**
 * OCRia-nano-1 for React Native (Expo or bare) on iOS and Android, with
 * onnxruntime-react-native and @shopify/react-native-skia.
 */
export class OcriaNanoService extends BaseOcriaNanoService<CoreCanvas> {
  public constructor(options: OcriaNanoOptions = {}) {
    super(new MobilePlatformProvider(), options);
  }
}
