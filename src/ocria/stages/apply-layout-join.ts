// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/parser.rs (crates-v2.21.2, Apache-2.0): apply_layout, the part after block classification.

import { withModelBlocks } from "../layout/index.js";
import type { PositionedBlock } from "../markdown-layout/block-types.js";
import type { ParsedPage } from "../types/page.js";
import { layoutBlocks } from "./layout-blocks.js";
import { renderPageMarkdown } from "./render-page-markdown.js";

/** Separator `apply_layout` puts between pages in the joined document markdown. */
const PAGE_SEPARATOR = "\n\n-----\n\n";

/** What `apply_layout` reads from `LiteParseConfig`. */
export type ApplyLayoutConfig = {
  /** `output_format == OutputFormat::Markdown`. */
  wantsMarkdown: boolean;
  extractBlocks: boolean;
};

/**
 * One page of `apply_layout` after `extract_blocks`: sets `page.blocks` when block extraction is
 * on and returns the page's markdown when markdown is wanted (else `null`).
 */
export function applyLayoutPage(
  page: ParsedPage,
  blocks: readonly PositionedBlock[] | null,
  config: ApplyLayoutConfig
): string | null {
  if (config.extractBlocks) {
    // A page with no structural decomposition reports an empty list,
    // not `null`: extraction *was* enabled, there was just nothing to
    // decompose.
    const heuristic = layoutBlocks(page, blocks ?? []);
    page.blocks = page.model_blocks.length === 0 ? heuristic : withModelBlocks(page, heuristic);
  }
  return config.wantsMarkdown ? renderPageMarkdown(page, blocks) : null;
}

/**
 * The end of `apply_layout`: the joined document markdown, with each page's `markdown` set to
 * its own part.
 */
export function joinPageMarkdown(pages: ParsedPage[], pageMarkdown: readonly string[]): string {
  const md = pageMarkdown.join(PAGE_SEPARATOR);
  pages.forEach((page, i) => {
    if (i < pageMarkdown.length) page.markdown = pageMarkdown[i];
  });
  return md;
}

/**
 * `apply_layout` with the classified blocks of every page supplied (`blocksPerPage[i]` is
 * `extract_blocks` for page `i`): returns the joined markdown, or `null` when markdown is not
 * the output format or no layout work is wanted.
 */
export function applyLayoutBlocks(
  pages: ParsedPage[],
  blocksPerPage: ReadonlyArray<readonly PositionedBlock[] | null>,
  config: ApplyLayoutConfig
): string | null {
  if (!config.wantsMarkdown && !config.extractBlocks) return null;
  const pageMarkdown: string[] = [];
  pages.forEach((page, i) => {
    const md = applyLayoutPage(page, blocksPerPage[i] ?? null, config);
    if (md !== null) pageMarkdown.push(md);
  });
  if (!config.wantsMarkdown) return null;
  return joinPageMarkdown(pages, pageMarkdown);
}
