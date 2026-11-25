// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): render_page_markdown.

import type { PositionedBlock } from "../markdown-layout/block-types.js";
import { renderBlocks } from "../markdown-layout/render/index.js";
import type { ParsedPage } from "../types/page.js";

/**
 * Render one page's markdown from its blocks. A page that classified to
 * `null` renders its projection text inside a ```` ```text ```` fence so
 * nothing is silently dropped.
 */
export function renderPageMarkdown(
  page: ParsedPage,
  blocks: readonly PositionedBlock[] | null
): string {
  if (blocks !== null) return renderBlocks(blocks);
  const trailingNewline = page.text.endsWith("\n") ? "" : "\n";
  return `\`\`\`text\n${page.text}${trailingNewline}\`\`\``;
}
