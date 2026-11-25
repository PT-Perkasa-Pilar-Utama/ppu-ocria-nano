// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): decorative dividers.

import { isAlphanumeric, isWhitespace } from "../../rust.js";

/**
 * Characters treated as decorative divider/ornament glyphs. Deliberately
 * conservative — excludes `.`, `=`, `~`, `+`, `#` which carry meaning elsewhere
 * (dot leaders, ellipses, setext-ish rules, headers).
 */
const DIVIDER_SYMBOLS = new Set(["*", "-", "_", "–", "—", "•", "·", "●", "▪", "■", "◦", "★", "☆"]);

export function isDividerSymbol(c: string): boolean {
  return DIVIDER_SYMBOLS.has(c);
}

/**
 * Classify a line that is *purely decorative* — no alphanumeric content, made
 * up only of divider symbols (`* * * *`, `———`, `____`). Returns:
 *   - `true`  → a section divider (≥3 symbols): emit a thematic break.
 *   - `false` → a lone 1–2 char, drop it, too small
 *   - `null`  → not decorative; classify normally.
 *
 * Without this, a `* * * *` divider line flows into the paragraph accumulator
 * and glues the ornament onto the start of the following paragraph, and a lone
 * decorative dash gets size-promoted to a `# -` heading.
 */
export function decorativeDividerKind(text: string): boolean | null {
  let symbols = 0;
  for (const c of text) {
    if (isWhitespace(c)) continue;
    if (isAlphanumeric(c) || !isDividerSymbol(c)) return null;
    symbols += 1;
  }
  if (symbols === 0) return null;
  return symbols >= 3;
}
