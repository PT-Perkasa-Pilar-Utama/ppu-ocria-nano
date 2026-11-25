// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/output/text.rs (crates-v2.21.2, Apache-2.0).

import type { ParsedPage } from "../types/page.js";

/** Format parsed pages as plain text with page headers. */
export function formatText(pages: readonly ParsedPage[]): string {
  return pages.map((page) => `\n--- Page ${page.page_number} ---\n${page.text}`).join("\n\n");
}
