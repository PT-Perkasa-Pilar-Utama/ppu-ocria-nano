// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): public entry points.

export { LiteParseError } from "./error.js";
export { mergeOcrResults, OcrMergeState } from "./state.js";
export type { PageOcrOutcome } from "./types.js";
export { pageOcrOutcomeFromJson } from "./types.js";
