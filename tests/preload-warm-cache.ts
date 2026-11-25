// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * bun test preload: fill the model cache once, before any test file runs. A
 * cold-cache download inside a test hook times out. With a warm cache this
 * only reads and checks the files.
 */
import { setDefaultTimeout } from "bun:test";

import { downloadModels } from "../src/processor/download-models.js";

// Inference tests run past bun's 5 s default on CI's 2-core runners, and
// bun 1.4 ignores a `timeout` key in bunfig.toml.
setDefaultTimeout(30_000);

await downloadModels();
