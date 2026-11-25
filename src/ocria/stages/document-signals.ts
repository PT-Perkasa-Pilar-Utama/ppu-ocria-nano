// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): DocumentSignals and document_signals.

import { buildHeadingMap, computeBodySize } from "../markdown-layout/headings/index.js";
import { computeHeaderFooterSet } from "../markdown-layout/repetition/index.js";
import type { ParsedPage } from "../types/page.js";

/**
 * Whole-document signals the block classifier needs: computed once over every
 * page, then applied per page by `extractBlocks`. Heading levels are ranked
 * against the document's body font size, and running headers/footers are the
 * lines that repeat across pages; neither is knowable from one page alone. A
 * caller that classifies pages in batches must compute this over the whole
 * document first, or heading levels drift between batches.
 */
export type DocumentSignals = {
  /** Dominant body font size in points; 0 when no page has sized lines. */
  body_size: number;
  /** `(font_size, heading_level)` pairs, largest size first, levels 1..=6. */
  heading_map: Array<[number, number]>;
  /**
   * Normalized texts of running headers/footers to suppress. Empty when
   * `keep_headers_footers` was set or the document is too short to tell.
   */
  header_footer: Set<string>;
};

/** `DocumentSignals::default()`. */
export function defaultDocumentSignals(): DocumentSignals {
  return { body_size: 0, heading_map: [], header_footer: new Set() };
}

/** Compute `DocumentSignals` over every page of the document. */
export function documentSignals(
  pages: readonly ParsedPage[],
  keepHeadersFooters: boolean
): DocumentSignals {
  if (pages.length === 0) return defaultDocumentSignals();
  const bodySize = computeBodySize(pages);
  const headingMap = buildHeadingMap(pages, bodySize);
  const headerFooter = keepHeadersFooters ? new Set<string>() : computeHeaderFooterSet(pages);
  return { body_size: bodySize, heading_map: headingMap, header_footer: headerFooter };
}
