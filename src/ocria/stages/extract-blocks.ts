// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): BlockOptions, extract_blocks and dedupe_rules.

import type { PositionedBlock } from "../markdown-layout/block-types.js";
import {
  rejoinParagraphsAroundFigures,
  spliceSoftHyphens,
  splitRepeatedHeaderTables,
} from "../markdown-layout/blocks/index.js";
import { classifyPageWithFilters } from "../markdown-layout/classify/index.js";
import type { ImageMode } from "../markdown-layout/constants.js";
import {
  detectSinglePageChrome,
  modelFurnitureLines,
} from "../markdown-layout/repetition/index.js";
import type { OutlineTarget } from "../types/document.js";
import type { ParsedPage } from "../types/page.js";
import type { DocumentSignals } from "./document-signals.js";

/** Per-document inputs to `extractBlocks` other than the signals. */
export type BlockOptions = {
  /** Document outline; entries for the page act as a high-priority heading source on untagged PDFs. */
  outline: readonly OutlineTarget[];
  /** Whether and how figures appear in the block list. */
  image_mode: ImageMode;
  /**
   * Disable running-chrome suppression (the cross-page set in the signals, the
   * single-page detector and the layout model's page header / footer blocks).
   */
  keep_headers_footers: boolean;
};

function isRule(b: PositionedBlock): boolean {
  return b.block === "HorizontalRule";
}

/**
 * Collapse cosmetic horizontal-rule noise on a single page's block stream:
 * drop leading/trailing rules (which would otherwise abut the `-----` page
 * separator) and collapse runs of consecutive rules to one. Rules come from
 * two sources, vector-graphics detection and decorative divider text, and
 * doubling up reads as sloppy output to a human while carrying no extra
 * structure for an LLM.
 */
export function dedupeRules(blocks: PositionedBlock[]): void {
  while (blocks.length > 0 && isRule(blocks[0])) blocks.shift();
  while (blocks.length > 0 && isRule(blocks[blocks.length - 1])) blocks.pop();
  // `Vec::dedup_by`: a rule that follows a retained rule is dropped.
  let kept = 0;
  for (let i = 1; i < blocks.length; i++) {
    const cur = blocks[i];
    const prev = blocks[kept];
    if (isRule(cur) && isRule(prev)) {
      // The survivor stands for the run, so it keeps the dropped rule's source
      // items (a text divider folded into a stroke).
      prev.text_item_indices.push(...cur.text_item_indices);
    } else {
      kept++;
      blocks[kept] = cur;
    }
  }
  if (blocks.length > 0) blocks.length = kept + 1;
}

/**
 * Classify one projected page into its final block sequence: headings,
 * paragraphs, lists, code, tables, rules, figures, after chrome suppression,
 * rule dedup and soft-hyphen splicing. Null for a page with no projected
 * lines (blank, or fully OCR without font metadata): there is no structure to
 * report, and rendering falls back to the projection text in a fence.
 */
export function extractBlocks(
  page: ParsedPage,
  signals: DocumentSignals,
  options: BlockOptions
): PositionedBlock[] | null {
  if (page.projected_lines.length === 0) return null;

  // Filter outline entries to this page so the classifier's y/title match is
  // an O(entries_on_page) scan per line, not O(whole doc).
  const targetIndex = page.page_number - 1;
  const pageOutline = options.outline.filter((e) => e.page_index === targetIndex);
  // Running chrome on this page alone: the single-page heuristics plus the
  // layout model's page header / footer blocks (the cross-page repetition set
  // cannot see one-page documents).
  const chromeIndices = options.keep_headers_footers
    ? new Set<number>()
    : new Set([...detectSinglePageChrome(page, signals.body_size), ...modelFurnitureLines(page)]);
  let blocks = classifyPageWithFilters(
    page,
    signals.heading_map,
    signals.header_footer,
    pageOutline,
    options.image_mode,
    chromeIndices
  );
  // A page whose only surviving blocks are horizontal rules (all its text was
  // stripped as chrome) should render empty, not as a stack of bare `---`
  // separators.
  const hasContent = blocks.some(
    (b) => !isRule(b) && !(typeof b.block === "object" && "Figure" in b.block)
  );
  if (!hasContent) blocks = blocks.filter((b) => !isRule(b));
  dedupeRules(blocks);
  blocks = splitRepeatedHeaderTables(blocks);
  blocks = rejoinParagraphsAroundFigures(blocks);
  return spliceSoftHyphens(blocks);
}
