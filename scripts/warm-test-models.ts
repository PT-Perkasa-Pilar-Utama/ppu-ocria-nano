// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Warm the on-disk model cache before the test suite runs (CI). Bun caps
 * hook timeouts, and a cold-cache download inside a hook blows them.
 */

import { downloadModels } from "../src/processor/download-models.js";

await downloadModels();
console.log("Model cache warmed (OCRia-nano-1 v1.0.0).");
