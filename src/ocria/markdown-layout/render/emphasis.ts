// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0): wrap_emphasis.

import { trim } from "../../rust.js";

/**
 * Wrap `text` in markdown emphasis markers based on `bold`/`italic`. Both ->
 * `***text***`. Headings deliberately skip this (the `#` is the emphasis).
 */
export function wrapEmphasis(text: string, bold: boolean, italic: boolean): string {
  if (trim(text) === "") return text;
  if (bold && italic) return `***${text}***`;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}
