// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): layout_blocks.

import { blocksForPage } from "../layout/index.js";
import type { LayoutBlock } from "../layout/types.js";
import type { PositionedBlock } from "../markdown-layout/block-types.js";
import type { ParsedPage } from "../types/page.js";

/**
 * The public, flat view of a page's blocks (`ParsedPage::blocks`), with
 * block boxes mapped back from the projected frame into viewport space.
 */
export function layoutBlocks(page: ParsedPage, blocks: readonly PositionedBlock[]): LayoutBlock[] {
  return blocksForPage(page, blocks);
}
