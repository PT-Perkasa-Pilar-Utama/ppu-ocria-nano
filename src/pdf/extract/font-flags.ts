// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): font and codepoint heuristics.

import type { FontType } from "../pdfium/font.js";

/** `is_buggy_font`: whether a font is "buggy" by its name and type. */
export function isBuggyFont(fontName: string, fontType: FontType): boolean {
  // TrueType subset fonts: name starts with "TT" or contains "+TT"
  if (fontName.startsWith("TT") || fontName.includes("+TT")) return true;
  // Type1 fonts with a 6-char prefix + underscore: "ABCDEF_..."; the Rust checks bytes.
  if (fontType === "Type1") {
    const bytes = new TextEncoder().encode(fontName);
    if (bytes.length >= 7 && bytes[6] === 0x5f) return true;
  }
  return false;
}

/**
 * `is_buggy_codepoint`: C0 controls, DEL and C1 controls, and the private use area are never
 * legitimate rendered text; C1 controls in particular come from subset fonts that mangle ToUnicode
 * into the 0x80-0x9F range.
 */
export function isBuggyCodepoint(unicode: number): boolean {
  return (
    unicode <= 0x1f ||
    (unicode >= 0x7f && unicode <= 0x9f) ||
    (unicode > 0xe000 && unicode <= 0xf8ff)
  );
}
