// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import type { Block } from "../block-types.js";
import { escapeInline } from "../inline/index.js";
import type { ParaAccum } from "../paragraphs/index.js";

/**
 * Resolve a `ParaAccum` to a `Block::Paragraph`. When the paragraph was
 * uniformly styled across all lines, return the raw text with block-level
 * `bold`/`italic` flags set so the renderer wraps it once. Otherwise return
 * the per-line inline-styled text with the flags cleared.
 */
export function paragraphFromAccum(accum: ParaAccum): Block {
  if (accum.uniform == null) {
    return { Paragraph: { text: accum.inline, bold: false, italic: false } };
  }
  const [bold, italic] = accum.uniform;
  // Uniformly plain: no emphasis markers anywhere, so the raw text (with markdown specials
  // escaped) is the right rendering.
  return { Paragraph: { text: escapeInline(accum.raw), bold, italic } };
}
